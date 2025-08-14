import { type } from 'arktype';
import { JSONFilePreset } from 'lowdb/node';
import { TweetType as TweetType } from './ws';

export const twitterApiKey = process.env.TWITTERAPIIO_KEY!;

if (!twitterApiKey) {
    throw new Error('no twitterapi.io api key');
}

async function callTwitterAPIRaw({
    path,
    query,
    method,
}: {
    path: string;
    query?: Record<string, string>;
    method: 'GET' | 'POST';
}) {
    console.warn('------- actual call');
    const baseUrl = `https://api.twitterapi.io`;
    const params = query ? new URLSearchParams(query).toString() : null;
    const url = params ? `${baseUrl}/${path}?${params}` : path;

    const options = {
        method,
        headers: { 'X-API-Key': twitterApiKey },
        body: undefined,
    };

    try {
        const response = await fetch(url, options);
        const data = await response.json();

        return data;
    } catch (error) {
        console.log('twitter api call failure', error);
        throw error;
    }
}

const FollowingType = type({
    type: "'user'",
    userName: 'string',
    url: 'string',
    id: 'string',
    name: 'string',
    isBlueVerified: 'boolean',
    verifiedType: 'string',
    profilePicture: 'string',
    coverPicture: 'string',
    description: 'string',
    location: 'string',
    followers: 'number',
    following: 'number',
    canDm: 'boolean',
    createdAt: 'string',
    favouritesCount: 'number',
    hasCustomTimelines: 'boolean',
    isTranslator: 'boolean',
    mediaCount: 'number',
    statusesCount: 'number',
    withheldInCountries: ['string'],
    affiliatesHighlightedLabel: 'object',
    possiblySensitive: 'boolean',
    pinnedTweetIds: ['string'],
    isAutomated: 'boolean',
    automatedBy: 'string',
    unavailable: 'boolean',
    message: 'string',
    unavailableReason: 'string',
    profile_bio: {
        description: 'string',
        entities: {
            description: {
                urls: [
                    {
                        display_url: 'string',
                        expanded_url: 'string',
                        indices: ['number'],
                        url: 'string',
                    },
                ],
            },
            url: {
                urls: [
                    {
                        display_url: 'string',
                        expanded_url: 'string',
                        indices: ['number'],
                        url: 'string',
                    },
                ],
            },
        },
    },
});

const API_DICTIONARY = {
    'twitter/user/followings': {
        method: 'GET',
        query: type({
            userName: 'string',
        }),
        response: type({
            'followings?': FollowingType.array(),
            'has_next_page?': 'boolean',
            'next_cursor?': 'string',
            'message?': 'string',
            status: '"success" | "error"',
        }),
    },
    'twitter/user/info': {
        method: 'GET',
        query: type({
            userName: 'string',
        }),
        response: type({
            'data?': 'object',
            'msg?': 'string',
            status: '"success" | "error"',
        }),
    },
    'twitter/user/last_tweets': {
        method: 'GET',
        query: type({
            userId: 'string',
            userName: 'string',
            cursor: 'string',
            includeReplies: 'string',
        }),
        response: type({
            tweets: TweetType.array(),
            has_next_page: 'boolean',
            next_cursor: 'string',
            status: '"success" | "error"',
            message: 'string',
        }),
    },
    'twitter/tweets': {
        method: 'GET',
        query: type({
            tweet_ids: 'string',
        }),
        response: type({
            tweets: TweetType.array(),
            status: '"success" | "error"',
            message: 'string',
        }),
    },
} as const;
type API_DICTIONARY = typeof API_DICTIONARY;

const middlewares: {
    [key in keyof API_DICTIONARY]:
        | ((
              response: API_DICTIONARY[key]['response']['infer'],
          ) => Promise<void>)
        | null;
} = {
    'twitter/tweets': async (res) => {
        await Promise.all(
            res.tweets.map(
                (tweet) => (dbTwitter.data.tweets[tweet.id] = tweet),
            ),
        );
        await dbTwitter.write();
    },
    'twitter/user/followings': null,
    'twitter/user/info': null,
    'twitter/user/last_tweets': null,
};

const cacheGetters: {
    [key in keyof API_DICTIONARY]:
        | ((query: API_DICTIONARY[key]['query']['infer']) => Promise<
              | {
                    cached: true;
                    response: API_DICTIONARY[key]['response']['infer'];
                }
              | {
                    cached: false;
                    response: undefined;
                }
          >)
        | null;
} = {
    'twitter/tweets': async (req) => {
        const ids = req.tweet_ids.split(',');
        const tweets = ids
            .map((id) => dbTwitter.data.tweets[id]!)
            .filter(Boolean);

        if (tweets.length !== ids.length) {
            return {
                cached: false,
                response: undefined,
            };
        }

        return {
            cached: true,
            response: {
                message: 'from cache',
                tweets: tweets,
                status: 'success',
            },
        };
    },
    'twitter/user/followings': null,
    'twitter/user/info': null,
    'twitter/user/last_tweets': null,
};

export async function callTwitterAPI<
    PATH extends keyof API_DICTIONARY,
    RESPONSE extends API_DICTIONARY[PATH]['response']['infer'],
    QUERY extends API_DICTIONARY[PATH]['query']['infer'],
>(path: PATH, query: QUERY): Promise<RESPONSE> {
    console.log('callTwitterAPI', path, query);
    const apiDesc = API_DICTIONARY[path];

    const cachedRes = await cacheGetters[path]?.(query);

    if (cachedRes?.cached) {
        console.log('cache hit');
        return cachedRes.response as RESPONSE;
    }

    console.log('cache missed');

    const res = (await callTwitterAPIRaw({
        path,
        query,
        method: apiDesc.method,
    })) as RESPONSE;

    if (middlewares[path]) {
        console.log('calling middleware');
        await middlewares[path](res);
    }

    return res;
}

export const NOT_YET_CREATED = -1;

export const dbTwitter = await JSONFilePreset('db_twitter.json', {
    followings: {
        createdAt: NOT_YET_CREATED,
        value: [] as (typeof FollowingType.infer)[],
    },
    tweets: {} as Record<string, (typeof TweetType)['infer']>,
});
