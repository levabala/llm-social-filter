import { type } from "arktype";
import { JSONFilePreset } from "lowdb/node";
import {
    messageHandlerRef,
    startWebsocket,
    type Tweet,
    type TweetMessage,
} from "./ws";
import { initTelegramBot } from "./telegram";

const usernameToFollow = process.env.USERNAME_TO_FOLLOW!;

if (!usernameToFollow) {
    throw new Error("no username to follow");
}

const apiKey = process.env.TWITTERAPIIO_KEY!;

if (!apiKey) {
    throw new Error("no twitterapi.io api key");
}

function formatTweetForTelegram(tweet: (typeof Tweet)["infer"]): string {
    const author = tweet.author?.userName
        ? `@${tweet.author.userName}`
        : tweet.author?.name || "Unknown";
    const date = new Date(tweet.createdAt).toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

    let stats = [];
    if (tweet.likeCount) stats.push(`❤️ ${tweet.likeCount}`);
    if (tweet.retweetCount) stats.push(`🔁 ${tweet.retweetCount}`);
    if (tweet.replyCount) stats.push(`💬 ${tweet.replyCount}`);
    if (tweet.viewCount) stats.push(`👁️ ${tweet.viewCount}`);

    return (
        `👤 ${author} | ${date}\n\n` +
        `${tweet.text}\n\n` +
        (stats.length ? stats.join(" | ") + "\n" : "") +
        `🔗 [View on Twitter](${tweet.twitterUrl})`
    );
}

async function callTwitterAPIRaw({
    path,
    query,
    method,
}: {
    path: string;
    query?: Record<string, string>;
    method: "GET" | "POST";
}) {
    const baseUrl = `https://api.twitterapi.io`;
    const params = query ? new URLSearchParams(query).toString() : null;
    const url = params ? `${baseUrl}/${path}?${params}` : path;

    const options = {
        method,
        headers: { "X-API-Key": apiKey },
        body: undefined,
    };

    try {
        const response = await fetch(url, options);
        const data = await response.json();

        return data;
    } catch (error) {
        console.log("twitter api call failure", error);
        throw error;
    }
}

const followingType = type({
    type: "'user'",
    userName: "string",
    url: "string",
    id: "string",
    name: "string",
    isBlueVerified: "boolean",
    verifiedType: "string",
    profilePicture: "string",
    coverPicture: "string",
    description: "string",
    location: "string",
    followers: "number",
    following: "number",
    canDm: "boolean",
    createdAt: "string",
    favouritesCount: "number",
    hasCustomTimelines: "boolean",
    isTranslator: "boolean",
    mediaCount: "number",
    statusesCount: "number",
    withheldInCountries: ["string"],
    affiliatesHighlightedLabel: "object",
    possiblySensitive: "boolean",
    pinnedTweetIds: ["string"],
    isAutomated: "boolean",
    automatedBy: "string",
    unavailable: "boolean",
    message: "string",
    unavailableReason: "string",
    profile_bio: {
        description: "string",
        entities: {
            description: {
                urls: [
                    {
                        display_url: "string",
                        expanded_url: "string",
                        indices: ["number"],
                        url: "string",
                    },
                ],
            },
            url: {
                urls: [
                    {
                        display_url: "string",
                        expanded_url: "string",
                        indices: ["number"],
                        url: "string",
                    },
                ],
            },
        },
    },
});

const API_DICTIONARY = {
    "twitter/user/followings": {
        method: "GET",
        query: type({
            userName: "string",
        }),
        response: type({
            "followings?": followingType.array(),
            "has_next_page?": "boolean",
            "next_cursor?": "string",
            "message?": "string",
            status: '"success" | "error"',
        }),
    },
    "twitter/user/info": {
        method: "GET",
        query: type({
            userName: "string",
        }),
        response: type({
            "data?": "object",
            "msg?": "string",
            status: '"success" | "error"',
        }),
    },
    "twitter/user/last_tweets": {
        method: "GET",
        query: type({
            userId: "string",
            userName: "string",
            cursor: "string",
            includeReplies: "string",
        }),
        response: type({
            tweets: "object[]",
            has_next_page: "boolean",
            next_cursor: "string",
            status: '"success" | "error"',
            message: "string",
        }),
    },
} as const;
type API_DICTIONARY = typeof API_DICTIONARY;

async function callTwitterAPI<
    PATH extends keyof API_DICTIONARY,
    RESPONSE extends API_DICTIONARY[PATH]["response"]["infer"],
    QUERY extends API_DICTIONARY[PATH]["query"]["infer"],
>(path: PATH, query: QUERY): Promise<RESPONSE> {
    console.log("callTwitterAPI", path, query);
    const apiDesc = API_DICTIONARY[path];

    const res = (await callTwitterAPIRaw({
        path,
        query,
        method: apiDesc.method,
    })) as RESPONSE;

    return res;
}

const NOT_YET_CREATED = -1;

const db = await JSONFilePreset("db_twitter.json", {
    followings: {
        createdAt: NOT_YET_CREATED,
        value: [] as (typeof followingType.infer)[],
    },
    tweets: {} as Record<string, (typeof Tweet)["infer"]>,
});

async function main() {
    let followings;
    if (db.data.followings.createdAt === NOT_YET_CREATED) {
        const res = await callTwitterAPI("twitter/user/followings", {
            userName: usernameToFollow,
        });

        if (res.status === "error") {
            console.error("failed to get the followings");
            console.log(res);

            return;
        }

        if (!res.followings) {
            console.error("no followings");
            console.log(res);

            return;
        }

        followings = { createdAt: Date.now(), value: res.followings };

        db.data.followings = followings;
        await db.write();
    } else {
        followings = db.data.followings;
    }

    console.log(followings.value.length);

    startWebsocket(apiKey);

    const { broadcastMessage } = initTelegramBot();

    async function processTweetsMsg(msg: TweetMessage) {
        if (!msg.tweets) {
            console.log("no tweets in the message");
            return;
        }

        for (const tweet of msg.tweets) {
            db.data.tweets[tweet.id] = tweet;
        }

        console.log(`updated/saved ${msg.tweets?.length || 0} tweets`);

        await db.write();

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
        console.log("handler msg");

        processTweetsMsg(msg);
    };
}

await main();
