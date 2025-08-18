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
import { initializeDbDirectory } from './db-utils';

const usernameToFollow = process.env.USERNAME_TO_FOLLOW!;

if (!usernameToFollow) {
    throw new Error('no username to follow');
}

export const adminUsername = process.env.ADMIN_USERNAME!;

if (!adminUsername) {
    throw new Error('admin username is absent');
}

const filterRuleId = process.env.TWITTERAPIIO_FILTER_RULE_ID!;

if (!filterRuleId) {
    throw new Error(
        'TWITTERAPIIO_FILTER_RULE_ID environment variable is required',
    );
}

const maxFollowings = parseInt(process.env.MAX_FOLLOWINGS || '20', 10);

if (isNaN(maxFollowings) || maxFollowings <= 0) {
    throw new Error('MAX_FOLLOWINGS must be a positive number');
}

export { filterRuleId, usernameToFollow, maxFollowings };

function formatTweetForTelegram(tweet: (typeof TweetType)['infer']): string {
    const date = new Date(tweet.createdAt).toLocaleString('en-US', {
        dateStyle: 'short',
        timeStyle: 'short',
    });

    return `${date}\n` + `${tweet.twitterUrl}`;
}

async function main() {
    // Initialize database directory
    await initializeDbDirectory();
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

        const originalCount = res.followings.length;
        followings = {
            createdAt: Date.now(),
            value: res.followings.slice(0, maxFollowings),
        };

        dbTwitter.data.followings = followings;
        await dbTwitter.write();

        console.log(
            `Using ${followings.value.length} followings (limited from ${originalCount} by MAX_FOLLOWINGS=${maxFollowings})`,
        );
    } else {
        const originalCount = dbTwitter.data.followings.value.length;
        followings = {
            ...dbTwitter.data.followings,
            value: dbTwitter.data.followings.value.slice(0, maxFollowings),
        };

        console.log(
            `Using ${followings.value.length} followings (limited from cached ${originalCount} by MAX_FOLLOWINGS=${maxFollowings})`,
        );
    }

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
