import {
    messageHandlerRef,
    startWebsocket,
    type TweetType,
    type TweetMessage,
} from './ws';
import { initTelegramBot } from './telegram';
import {
    callTwitterAPI,
    dbTwitter,
    NOT_YET_CREATED,
    twitterApiKey,
} from './twitter';

const usernameToFollow = process.env.USERNAME_TO_FOLLOW!;

if (!usernameToFollow) {
    throw new Error('no username to follow');
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

    const { broadcastMessage } = initTelegramBot();

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

        const maxTweetsCount = 5;
        for (const tweet of msg.tweets.slice(0, maxTweetsCount)) {
            broadcastMessage(formatTweetForTelegram(tweet));
            await new Promise((res) => setTimeout(res, 1000));
        }

        if (msg.tweets.length > maxTweetsCount) {
            broadcastMessage(
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
