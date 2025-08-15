import {
    messageHandlerRef,
    startWebsocket,
    type TweetType,
    type TweetMessage,
} from './ws';
import { dbTelegram, initTelegramBot, sendMessage } from './telegram';
import {
    callTwitterAPI,
    dbTwitter,
    NOT_YET_CREATED,
    twitterApiKey,
} from './twitter';
import { checkIfPostIsImportant } from './llm';

const usernameToFollow = process.env.USERNAME_TO_FOLLOW!;

if (!usernameToFollow) {
    throw new Error('no username to follow');
}

export const adminUsername = process.env.ADMIN_USERNAME!;

if (!adminUsername) {
    throw new Error('admin username is absent');
}

function formatTweetForTelegram(tweet: (typeof TweetType)['infer']): string {
    const date = new Date(tweet.createdAt).toLocaleString('en-US', {
        dateStyle: 'short',
        timeStyle: 'short',
    });

    return `${date}\n` + `${tweet.twitterUrl}`;
}

async function main() {
    let followings;
    if (dbTwitter.data.followings.createdAt === NOT_YET_CREATED) {
        const res = await callTwitterAPI('twitter/user/followings', {
            userName: usernameToFollow,
        });

        if (res.status === 'error') {
            console.error('failed to get the followings');
            console.log(res);

            return;
        }

        if (!res.followings) {
            console.error('no followings');
            console.log(res);

            return;
        }

        followings = { createdAt: Date.now(), value: res.followings };

        dbTwitter.data.followings = followings;
        await dbTwitter.write();
    } else {
        followings = dbTwitter.data.followings;
    }

    console.log(followings.value.length);

    startWebsocket(twitterApiKey);

    const {} = initTelegramBot();

    async function processTweetsMsg(msg: TweetMessage) {
        if (!msg.tweets) {
            console.log('no tweets in the message');
            return;
        }

        for (const tweet of msg.tweets) {
            dbTwitter.data.tweets[tweet.id] = tweet;
        }

        console.log(`updated/saved ${msg.tweets?.length || 0} tweets`);

        await dbTwitter.write();

        const intents = dbTelegram.data.intentsByUsername[adminUsername];

        if (!intents?.length) {
            console.warn('no intents for the admin username');
            return;
        }

        const chatId = dbTelegram.data.usernameToChatId[adminUsername];

        if (!chatId) {
            console.warn('no chat id for the admin username');
            return;
        }

        const maxTweetsCount = 30;
        const list = Array.from(msg.tweets.slice(0, maxTweetsCount).entries());
        for (const [id, tweet] of list) {
            console.log(`processing tweet ${id}/${msg.tweets.length}`);
            const checkRes = await checkIfPostIsImportant(tweet.text, intents);

            console.log(JSON.stringify(checkRes, undefined, 2));

            if (!checkRes.result.overall_match) {
                console.log('not matched - skipping');
                continue;
            }

            const messageToUser = [
                formatTweetForTelegram(tweet),
                'match rationale:',
                ...checkRes.result.matches
                    .filter((match) => match.match)
                    .map((match) => `${match.rationale}`),
            ].join('\n');

            sendMessage(chatId, messageToUser);

            // broadcastMessage(messageToUser);

            await new Promise((res) => setTimeout(res, 1000));
        }

        if (msg.tweets.length > maxTweetsCount) {
            sendMessage(
                chatId,
                `too many tweets, sent ${maxTweetsCount}/${msg.tweets.length}`,
            );
        }
    }

    messageHandlerRef.current = (msg) => {
        console.log('handler msg');

        processTweetsMsg(msg);
    };
}

await main();
