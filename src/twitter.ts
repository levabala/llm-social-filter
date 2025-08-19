import { type } from 'arktype';
import { JSONFilePreset } from 'lowdb/node';
import { getDbPath } from './db-utils';
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
    query?: Record<string, any>;
    method: 'GET' | 'POST' | 'DELETE';
}) {
    console.warn('------- actual call');
    const baseUrl = `https://api.twitterapi.io`;

    let url: string;
    let options: RequestInit;

    if (method === 'GET') {
        const stringQuery = query
            ? Object.fromEntries(
                  Object.entries(query).map(([k, v]) => [k, String(v)]),
              )
            : {};
        const params = Object.keys(stringQuery).length
            ? new URLSearchParams(stringQuery).toString()
            : null;
        url = params ? `${baseUrl}/${path}?${params}` : `${baseUrl}/${path}`;
        options = {
            method,
            headers: { 'X-API-Key': twitterApiKey },
        };
    } else {
        // POST and DELETE methods
        url = `${baseUrl}/${path}`;
        options = {
            method,
            headers: {
                'X-API-Key': twitterApiKey,
                'Content-Type': 'application/json',
            },
            body: query ? JSON.stringify(query) : undefined,
        };
    }

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
    'oapi/tweet_filter/get_rules': {
        method: 'GET',
        query: type({}),
        response: type({
            status: '"success" | "error"',
            'msg?': 'string',
            'rules?': type({
                rule_id: 'string',
                tag: 'string',
                value: 'string',
                interval_seconds: 'number',
            }).array(),
        }),
    },
    'oapi/tweet_filter/update_rule': {
        method: 'POST',
        query: type({
            rule_id: 'string',
            tag: 'string',
            value: 'string',
            interval_seconds: 'number',
            'is_effect?': '0 | 1',
        }),
        response: type({
            status: '"success" | "error"',
            'msg?': 'string',
        }),
    },
    'oapi/tweet_filter/add_rule': {
        method: 'POST',
        query: type({
            tag: 'string',
            value: 'string',
            interval_seconds: 'number',
        }),
        response: type({
            status: '"success" | "error"',
            'msg?': 'string',
            'rule_id?': 'string',
        }),
    },
    'oapi/tweet_filter/delete_rule': {
        method: 'DELETE',
        query: type({
            rule_id: 'string',
        }),
        response: type({
            status: '"success" | "error"',
            'msg?': 'string',
        }),
    },
    'oapi/my/info': {
        method: 'GET',
        query: type({}),
        response: type({
            recharge_credits: 'number',
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
    'oapi/tweet_filter/get_rules': null,
    'oapi/tweet_filter/update_rule': null,
    'oapi/tweet_filter/add_rule': null,
    'oapi/tweet_filter/delete_rule': null,
    'oapi/my/info': null,
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
    'oapi/tweet_filter/get_rules': null,
    'oapi/tweet_filter/update_rule': null,
    'oapi/tweet_filter/add_rule': null,
    'oapi/tweet_filter/delete_rule': null,
    'oapi/my/info': null,
};

export const dbTwitterApiStats = await JSONFilePreset(
    getDbPath('db_twitter_api_stats.json'),
    {
        lastCalls: [] as Array<{ date: number; path: string }>,
    },
);

export const dbTwitterBalanceStats = await JSONFilePreset(
    getDbPath('db_twitter_balance_stats.json'),
    {
        lastBalanceChecks: [] as Array<{ date: number; credits: number }>,
    },
);

const LAST_CALLS_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const LAST_BALANCE_CHECKS_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

function logTwitterApiCall(path: string) {
    const arr = dbTwitterApiStats.data.lastCalls;

    arr.push({ date: Date.now(), path });

    while (arr[0] && arr[0].date < Date.now() - LAST_CALLS_MAX_AGE) {
        arr.shift();
    }

    dbTwitterApiStats.write();
}

function logBalanceCheck(credits: number) {
    const arr = dbTwitterBalanceStats.data.lastBalanceChecks;

    arr.push({ date: Date.now(), credits });

    while (arr[0] && arr[0].date < Date.now() - LAST_BALANCE_CHECKS_MAX_AGE) {
        arr.shift();
    }

    dbTwitterBalanceStats.write();
}

export async function callTwitterAPI<
    PATH extends keyof API_DICTIONARY,
    RESPONSE extends API_DICTIONARY[PATH]['response']['infer'],
    QUERY extends API_DICTIONARY[PATH]['query']['infer'],
>(path: PATH, query: QUERY, disableBalanceCheck = false): Promise<RESPONSE> {
    console.log('callTwitterAPI', path, query);

    logTwitterApiCall(path);

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

    if (!disableBalanceCheck) {
        updateBalance().catch((error) =>
            console.error('Balance update failed after API call:', error),
        );
    }

    return res;
}

export const NOT_YET_CREATED = -1;

export const dbTwitter = await JSONFilePreset(getDbPath('db_twitter.json'), {
    followings: {
        createdAt: NOT_YET_CREATED,
        value: [] as (typeof FollowingType.infer)[],
    },
    tweets: {} as Record<string, (typeof TweetType)['infer']>,
    balance: {
        lastUpdated: NOT_YET_CREATED,
        credits: -1,
    },
});

if (!dbTwitter.data.balance) {
    dbTwitter.data.balance = {
        lastUpdated: NOT_YET_CREATED,
        credits: -1,
    };
    await dbTwitter.write();
}

function chunkFollowingsIntoRules(
    followings: { userName: string }[],
    maxChars = 240,
): string[] {
    const rules: string[] = [];
    let currentRule = '';

    for (const following of followings) {
        const userPart = `from:${following.userName}`;
        const separator = currentRule ? ' OR ' : '';
        const testRule = currentRule + separator + userPart;

        if (testRule.length <= maxChars) {
            currentRule = testRule;
        } else {
            if (currentRule) {
                rules.push(currentRule);
                currentRule = userPart;
            } else {
                rules.push(userPart);
            }
        }
    }

    if (currentRule) {
        rules.push(currentRule);
    }

    return rules;
}

export async function getWebhookRules() {
    const res = await callTwitterAPI('oapi/tweet_filter/get_rules', {});

    if (res.status === 'error') {
        throw new Error(`Failed to get webhook rules: ${res.msg}`);
    }

    return res.rules || [];
}

export async function createWebhookRule(
    tag: string,
    value: string,
    intervalSeconds = 3600,
) {
    const res = await callTwitterAPI('oapi/tweet_filter/add_rule', {
        tag,
        value,
        interval_seconds: intervalSeconds,
    });

    if (res.status === 'error') {
        throw new Error(`Failed to create webhook rule: ${res.msg}`);
    }

    return {
        rule_id: res.rule_id!,
        tag,
        value,
        interval_seconds: intervalSeconds,
    };
}

export async function updateWebhookRuleSingle(
    ruleId: string,
    tag: string,
    value: string,
    intervalSeconds = 3600,
) {
    const res = await callTwitterAPI('oapi/tweet_filter/update_rule', {
        rule_id: ruleId,
        tag,
        value,
        interval_seconds: intervalSeconds,
        is_effect: 1,
    });

    if (res.status === 'error') {
        throw new Error(`Failed to update webhook rule: ${res.msg}`);
    }

    return res;
}

export async function deleteWebhookRule(ruleId: string) {
    const res = await callTwitterAPI('oapi/tweet_filter/delete_rule', {
        rule_id: ruleId,
    });

    if (res.status === 'error') {
        throw new Error(`Failed to delete webhook rule: ${res.msg}`);
    }

    return res;
}

export async function updateWebhookRule(followings: { userName: string }[]) {
    const ruleChunks = chunkFollowingsIntoRules(followings);
    const existingRules = await getWebhookRules();

    const followingRules = existingRules.filter(
        (rule) => rule.tag === 'followings',
    );

    const results = {
        updated: 0,
        created: 0,
        deleted: 0,
        total: ruleChunks.length,
    };

    for (
        let i = 0;
        i < Math.max(ruleChunks.length, followingRules.length);
        i++
    ) {
        const chunk = ruleChunks[i];
        const existingRule = followingRules[i];

        if (chunk && existingRule) {
            await updateWebhookRuleSingle(
                existingRule.rule_id,
                'followings',
                chunk,
            );
            results.updated++;
        } else if (chunk && !existingRule) {
            await createWebhookRule('followings', chunk);
            results.created++;
        } else if (!chunk && existingRule) {
            await deleteWebhookRule(existingRule.rule_id);
            results.deleted++;
        }
    }

    return results;
}

export async function getMyAccountInfo() {
    const res = await callTwitterAPI('oapi/my/info', {}, true);
    return res;
}

export function calculateCreditUsage() {
    const checks = dbTwitterBalanceStats.data.lastBalanceChecks;
    if (checks.length < 2) {
        return { hourUsage: 0, dayUsage: 0 };
    }

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    const latestCheck = checks[checks.length - 1]!;

    let hourCheck = null;
    let dayCheck = null;

    for (let i = checks.length - 2; i >= 0; i--) {
        const check = checks[i];
        if (!check) continue;

        const timeDiff = now - check.date;

        if (timeDiff <= hour) {
            hourCheck = check;
        }
        if (timeDiff <= day) {
            dayCheck = check;
        }
    }

    const hourUsage = hourCheck
        ? Math.max(0, hourCheck.credits - latestCheck.credits)
        : 0;
    const dayUsage = dayCheck
        ? Math.max(0, dayCheck.credits - latestCheck.credits)
        : 0;

    return { hourUsage, dayUsage };
}

export async function updateBalance() {
    try {
        const accountInfo = await getMyAccountInfo();
        dbTwitter.data.balance = {
            lastUpdated: Date.now(),
            credits: accountInfo.recharge_credits,
        };
        await dbTwitter.write();
        logBalanceCheck(accountInfo.recharge_credits);
        console.log(`Balance updated: ${accountInfo.recharge_credits} credits`);
        return accountInfo.recharge_credits;
    } catch (error) {
        console.error('Failed to update balance:', error);
        return dbTwitter.data.balance?.credits || -1;
    }
}
