import { Context, Telegraf, Markup, Scenes, session } from 'telegraf';
import { JSONFilePreset } from 'lowdb/node';
import type { BotCommand, Update } from 'telegraf/types';
import { getDbPath } from './db-utils';
import { dbTwitterWSStats, handleMessage } from './ws';
import {
    callTwitterAPI,
    updateWebhookRule,
    dbTwitter,
    NOT_YET_CREATED,
    dbTwitterApiStats,
    calculateCreditUsage,
} from './twitter';
import { type Intent, updateIntentWithLLM } from './llm';
import { adminUsername, usernameToFollow, maxFollowings } from '.';

const telegramToken = process.env.TELEGRAM_BOT_TOKEN!;

if (!telegramToken) {
    throw new Error('telegram bot token is absent');
}

export const dbTelegram = await JSONFilePreset(getDbPath('db_telegram.json'), {
    chatIdWithLastMessageList: {} as {
        [chatId: number | string]: {
            lastMessageUser?: { id: number; text: string };
            lastMessageBot?: { id: number; text: string };
        };
    },
    intentsByUsername: {} as Record<string, Intent[]>,
    usernameToChatId: {} as Record<string, number>,
    editingIntentByUser: {} as Record<
        string,
        { intentId: string; page: number }
    >,
});

if (!dbTelegram.data.chatIdWithLastMessageList) {
    dbTelegram.data.chatIdWithLastMessageList = {};
}
if (!dbTelegram.data.intentsByUsername) {
    dbTelegram.data.intentsByUsername = {};
}
if (!dbTelegram.data.usernameToChatId) {
    dbTelegram.data.usernameToChatId = {};
}
if (!dbTelegram.data.editingIntentByUser) {
    dbTelegram.data.editingIntentByUser = {};
}

const bot = new Telegraf<Scenes.SceneContext>(telegramToken, { handlerTimeout: 200_000 });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

function countPerDayPerHour(arr: Array<{ date: number }>) {
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    let dayCount = 0;
    let hourCount = 0;

    for (let i = 0; i < arr.length; i++) {
        const { date } = arr[i]!;

        if (date >= now - day) {
            dayCount++;
        }

        if (date >= now - hour) {
            hourCount++;
        }
    }

    return { dayCount, hourCount };
}

const INTENTS_PER_PAGE = 5;

function createIntentsListKeyboard(intents: Intent[], page: number) {
    const startIndex = page * INTENTS_PER_PAGE;
    const pageIntents = intents.slice(
        startIndex,
        startIndex + INTENTS_PER_PAGE,
    );

    const buttons = pageIntents.map((intent) => [
        Markup.button.callback(intent.id, `intent_select:${intent.id}`),
    ]);

    const navigationButtons = [];
    if (page > 0) {
        navigationButtons.push(
            Markup.button.callback('◀ Previous', `intent_list:${page - 1}`),
        );
    }
    if (startIndex + INTENTS_PER_PAGE < intents.length) {
        navigationButtons.push(
            Markup.button.callback('Next ▶', `intent_list:${page + 1}`),
        );
    }

    if (navigationButtons.length > 0) {
        buttons.push(navigationButtons);
    }

    return Markup.inlineKeyboard(buttons);
}

function createIntentEditKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('◀ Back to List', 'intent_back')],
    ]);
}

const MESSAGE_STATUS_TEXT_SEPARATOR = '\n---\n';
export function patchMessageStatusText(msg: string) {
    const [before] = msg.split(MESSAGE_STATUS_TEXT_SEPARATOR);

    const nowDate = new Date().toLocaleString('en-US', {
        dateStyle: 'short',
        timeStyle: 'medium',
    });

    const { hourCount: lastHourApiCalls, dayCount: lastDayApiCalls } =
        countPerDayPerHour(dbTwitterApiStats.data.lastCalls);
    const { hourCount: lastHourWSCalls, dayCount: lastDayWSCalls } =
        countPerDayPerHour(dbTwitterWSStats.data.lastSubscriptionTweets);
    const { hourCount: lastHourPings, dayCount: lastDayPings } =
        countPerDayPerHour(dbTwitterWSStats.data.lastPings);
    const { hourUsage, dayUsage } = calculateCreditUsage();

    const balanceStr =
        dbTwitter.data.balance?.credits >= 0
            ? `balance: ${dbTwitter.data.balance.credits}`
            : 'balance: ?';

    const creditUsageStr = `usage hour/day ${hourUsage}/${dayUsage}`;

    const statsApiStr = `api hour/day ${lastHourApiCalls}/${lastDayApiCalls}`;
    const statsWSStr = `ws hour/day ${lastHourWSCalls}/${lastDayWSCalls}`;
    const statsPingsStr = `ping hour/day ${lastHourPings}/${lastDayPings}`;

    return [
        before,
        [
            [nowDate, balanceStr, creditUsageStr].join(', '),
            [statsApiStr, statsWSStr, statsPingsStr].join(', '),
        ].join('\n'),
    ].join(MESSAGE_STATUS_TEXT_SEPARATOR);
}

export function removeMessageStatusText(msg: string) {
    const [before] = msg.split(MESSAGE_STATUS_TEXT_SEPARATOR);

    return before || '';
}

export const sendMessage: typeof bot.telegram.sendMessage = async (
    chatId,
    textRaw: string,
    extra,
) => {
    const text = patchMessageStatusText(textRaw);

    const msg = await bot.telegram.sendMessage(chatId, text, extra);

    const lastMessageBot =
        dbTelegram.data.chatIdWithLastMessageList[chatId]?.lastMessageBot;

    if (lastMessageBot) {
        const textNew = removeMessageStatusText(lastMessageBot.text);
        if (lastMessageBot.text !== textNew) {
            bot.telegram.editMessageText(
                chatId,
                lastMessageBot.id,
                undefined,
                textNew,
            );
        }
    }

    dbTelegram.data.chatIdWithLastMessageList[chatId] = {
        ...dbTelegram.data.chatIdWithLastMessageList[chatId],
        lastMessageBot: {
            id: msg.message_id,
            text: msg.text,
        },
    };

    dbTelegram.write();

    return msg;
};

const reply = async (
    ctx: Context<Update>,
    ...replyArgs: Parameters<Context['reply']>
) => {
    if (!ctx.chat) {
        console.warn('no chat id - reject');
        return;
    }

    const [text, extra] = replyArgs;
    const hasInlineKeyboard = extra && 'reply_markup' in extra;

    let finalText = text;
    if (typeof text === 'string' && !hasInlineKeyboard) {
        finalText = patchMessageStatusText(text);
    }

    const msg = await ctx.reply(finalText, extra);

    if (!hasInlineKeyboard) {
        const lastMessageBot =
            dbTelegram.data.chatIdWithLastMessageList[ctx.chat.id]
                ?.lastMessageBot;

        if (lastMessageBot) {
            const textNew = removeMessageStatusText(lastMessageBot.text);
            if (lastMessageBot.text !== textNew) {
                bot.telegram.editMessageText(
                    ctx.chat.id,
                    lastMessageBot.id,
                    undefined,
                    textNew,
                );
            }
        }

        dbTelegram.data.chatIdWithLastMessageList[ctx.chat.id] = {
            ...dbTelegram.data.chatIdWithLastMessageList[ctx.chat.id],
            lastMessageBot: {
                id: msg.message_id,
                text: msg.text,
            },
        };
    }

    dbTelegram.write();

    return msg;
};

// Scene action constants  
const INTENT_BACK_ACTION = 'intent_back';

// INTENTS_LIST_SCENE - Shows paginated list of user intents
const intentsListScene = new Scenes.BaseScene<Scenes.SceneContext>('INTENTS_LIST_SCENE');

intentsListScene.enter((ctx) => {
    const username = ctx.from?.username;
    if (!username) {
        ctx.reply('Username not found');
        return ctx.scene.leave();
    }

    const userIntents = dbTelegram.data.intentsByUsername[username] || [];

    if (userIntents.length === 0) {
        ctx.reply('No intents found for your account.');
        return ctx.scene.leave();
    }

    (ctx.scene.state as any).userIntents = userIntents;
    (ctx.scene.state as any).currentPage = 0;
    (ctx.scene.state as any).username = username;

    const keyboard = createIntentsListKeyboard(userIntents, 0);
    const intentsList = userIntents
        .slice(0, INTENTS_PER_PAGE)
        .map(
            (intent: Intent, index: number) =>
                `${index + 1}. ${intent.id}: ${intent.value.substring(0, 80)}${intent.value.length > 80 ? '...' : ''}`,
        )
        .join('\n');

    const message = `Your intents (${userIntents.length} total):\n\n${intentsList}\n\nSelect an intent to edit:`;

    ctx.reply(message, keyboard);
});

intentsListScene.action(/intent_list:(.+)/, (ctx) => {
    const page = parseInt(ctx.match![1]!);
    const userIntents = (ctx.scene.state as any).userIntents;
    
    (ctx.scene.state as any).currentPage = page;
    
    const keyboard = createIntentsListKeyboard(userIntents, page);
    const startIndex = page * INTENTS_PER_PAGE;
    const pageIntents = userIntents.slice(startIndex, startIndex + INTENTS_PER_PAGE);
    const intentsList = pageIntents
        .map(
            (intent: Intent, index: number) =>
                `${startIndex + index + 1}. ${intent.id}: ${intent.value.substring(0, 80)}${intent.value.length > 80 ? '...' : ''}`,
        )
        .join('\n');

    const message = `Your intents (${userIntents.length} total):\n\n${intentsList}\n\nSelect an intent to edit:`;
    ctx.editMessageText(message, keyboard);
});

intentsListScene.action(/intent_select:(.+)/, (ctx) => {
    const intentId = ctx.match![1]!;
    const userIntents = (ctx.scene.state as any).userIntents;
    const intent = userIntents.find((i: Intent) => i.id === intentId);
    
    if (!intent) {
        ctx.editMessageText('Intent not found');
        return ctx.scene.leave();
    }

    (ctx.scene.state as any).selectedIntent = intent;
    return ctx.scene.enter('INTENT_DETAIL_SCENE');
});

intentsListScene.use((ctx) => ctx.reply('Please select an intent from the list above.'));

// INTENT_DETAIL_SCENE - Shows intent details and editing interface  
const intentDetailScene = new Scenes.BaseScene<Scenes.SceneContext>('INTENT_DETAIL_SCENE');

intentDetailScene.enter((ctx) => {
    const intent = (ctx.scene.state as any).selectedIntent;
    
    if (!intent) {
        ctx.reply('Intent not found');
        return ctx.scene.leave();
    }
    
    const keyboard = createIntentEditKeyboard();
    const message =
        `Editing intent: ${intent.id}\n\n` +
        `Description: ${intent.value}\n\n` +
        `Positive examples:\n${intent.examplesPositive.map((e: string) => `- ${e}`).join('\n')}\n\n` +
        `Negative examples:\n${intent.examplesNegative.map((e: string) => `- ${e}`).join('\n')}\n\n` +
        `Send a message describing how you want to update this intent.`;

    ctx.reply(message, keyboard);
});

intentDetailScene.action(INTENT_BACK_ACTION, (ctx) => {
    return ctx.scene.enter('INTENTS_LIST_SCENE');
});

intentDetailScene.hears(/.+/, (ctx) => {
    (ctx.scene.state as any).updateMessage = ctx.message.text;
    return ctx.scene.enter('INTENT_EDIT_SCENE');
});

intentDetailScene.use((ctx) => ctx.reply('Please send a text message describing how you want to update the intent, or use the back button.'));

// INTENT_EDIT_SCENE - Handles LLM-powered intent updates
const intentEditScene = new Scenes.BaseScene<Scenes.SceneContext>('INTENT_EDIT_SCENE');

intentEditScene.enter(async (ctx) => {
    const selectedIntent = (ctx.scene.state as any).selectedIntent;
    const username = (ctx.scene.state as any).username;
    const updateMessage = (ctx.scene.state as any).updateMessage;
    
    if (!selectedIntent || !username || !updateMessage) {
        ctx.reply('Missing required data for intent update');
        return ctx.scene.leave();
    }

    try {
        const processingMsg = await ctx.reply('Processing your intent update...');
        
        const { result: updatedIntent } = await updateIntentWithLLM(selectedIntent, updateMessage);
        
        const userIntents = dbTelegram.data.intentsByUsername[username] || [];
        const intentIndex = userIntents.findIndex((i: Intent) => i.id === selectedIntent.id);
        
        if (intentIndex >= 0) {
            if (!dbTelegram.data.intentsByUsername[username]) {
                dbTelegram.data.intentsByUsername[username] = [];
            }
            dbTelegram.data.intentsByUsername[username]![intentIndex] = updatedIntent;
            await dbTelegram.write();
            
            const message = `✅ Intent updated successfully!\n\n${'```json'}\n${JSON.stringify(updatedIntent, undefined, 2)}\n${'```'}`;
            const keyboard = createIntentEditKeyboard();
            
            if (ctx.chat) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    processingMsg.message_id,
                    undefined,
                    message,
                    { ...keyboard, parse_mode: undefined }
                );
            }
            
            ctx.reply('Intent updated! Use /intents to edit another intent.');
            return ctx.scene.leave();
        } else {
            if (ctx.chat) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    processingMsg.message_id,
                    undefined,
                    '❌ Error: Intent not found in your list'
                );
            }
            return ctx.scene.leave();
        }
    } catch (error) {
        console.error('Error updating intent:', error);
        ctx.reply(`❌ Error updating intent: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return ctx.scene.leave();
    }
});

intentEditScene.action(INTENT_BACK_ACTION, (ctx) => {
    return ctx.scene.enter('INTENT_DETAIL_SCENE');
});

intentEditScene.leave((ctx) => {
    // Clean up session data
    delete (ctx.scene.state as any).userIntents;
    delete (ctx.scene.state as any).selectedIntent;
    delete (ctx.scene.state as any).updateMessage;
    delete (ctx.scene.state as any).currentPage;
    delete (ctx.scene.state as any).username;
});

intentEditScene.use((ctx) => ctx.reply('Processing complete. Use the back button or /intents to manage intents.'));

// Create stage for scenes
const stage = new Scenes.Stage([intentsListScene, intentDetailScene, intentEditScene]);

/**
 * @deprecated
 */
export function initTelegramBot() {
    console.log('initTelegramBot');

    // Enable scenes
    bot.use(session());
    bot.use(stage.middleware());

    bot.use((ctx, next) => {
        if (!ctx.from) {
            console.warn('no from - reject');
            return;
        }

        if (ctx.from.username !== adminUsername) {
            console.warn('no from - reject');

            ctx.reply('not authorized');

            return;
        }

        return next();
    });

    bot.start((ctx) => {
        console.log('start');

        dbTelegram.data.chatIdWithLastMessageList[ctx.chat.id] = {};

        if (ctx.from.username) {
            dbTelegram.data.usernameToChatId[ctx.from.username] = ctx.chat.id;
        }

        reply(ctx, 'Welcome!');

        dbTelegram.write();
    });

    const commandsList: BotCommand[] = [];
    type PBC = Parameters<typeof bot.command>;
    const registerBotCommand = (
        command: string,
        description: string,
        handler: PBC[1],
    ) => {
        bot.command(command, handler);
        commandsList.push({ command, description });
    };

    registerBotCommand('test', 'test', async () => {
        handleMessage(
            `{"tweets": [{"type": "tweet", "id": "1955896617057574986", "url": "https://x.com/elonmusk/status/1955896617057574986", "twitterUrl": "https://twitter.com/elonmusk/status/1955896617057574986", "text": "@veggie_eric \ud83d\udcaf", "source": "Twitter for iPhone", "retweetCount": 9, "replyCount": 53, "likeCount": 116, "quoteCount": 4, "viewCount": 3407, "createdAt": "Thu Aug 14 07:37:46 +0000 2025", "lang": "qme", "bookmarkCount": 6, "isReply": true, "inReplyToId": "1955857894790095084", "conversationId": "1955857894790095084", "inReplyToUserId": "1219282049070063617", "inReplyToUsername": "veggie_eric", "author": {"type": "user", "userName": "elonmusk", "url": "https://x.com/elonmusk", "twitterUrl": "https://twitter.com/elonmusk", "id": "44196397", "name": "Elon Musk", "isVerified": false, "isBlueVerified": true, "verifiedType": null, "profilePicture": "https://pbs.twimg.com/profile_images/1936002956333080576/kqqe2iWO_normal.jpg", "coverPicture": "https://pbs.twimg.com/profile_banners/44196397/1739948056", "description": "", "location": "", "followers": 224221577, "following": 1184, "status": "", "canDm": false, "canMediaTag": false, "createdAt": "Tue Jun 02 20:12:29 +0000 2009", "entities": {"description": {"urls": []}, "url": {}}, "fastFollowersCount": 0, "favouritesCount": 163938, "hasCustomTimelines": true, "isTranslator": false, "mediaCount": 4073, "statusesCount": 83648, "withheldInCountries": [], "affiliatesHighlightedLabel": {"label": {"badge": {"url": "https://pbs.twimg.com/profile_images/1955359038532653056/OSHY3ewP_bigger.jpg"}, "description": "X", "url": {"url": "https://twitter.com/X", "url_type": "DeepLink"}, "user_label_type": "BusinessLabel", "user_label_display_type": "Badge"}}, "possiblySensitive": false, "pinnedTweetIds": ["1955347126160065016"], "profile_bio": {"description": "", "entities": {"description": {}}}, "isAutomated": false, "automatedBy": null}, "extendedEntities": {}, "card": null, "place": {}, "entities": {"user_mentions": [{"id_str": "1219282049070063617", "indices": [0, 12], "name": "Eric Jiang", "screen_name": "veggie_eric"}]}, "quoted_tweet": null, "retweeted_tweet": null, "article": null}], "rule_id": "bf6776a1f5074bf68267d9fbdfc7e5a6", "rule_tag": "followings", "rule_value": "from:msvetov OR from:elonmusk", "event_type": "tweet", "timestamp": 1755158107100}`,
        );
    });

    registerBotCommand(
        'check',
        'checks if a tweet is important',
        async (ctx) => {
            console.log(ctx.message.text);

            const id = ctx.message.text.replace('/check', '').trim();

            const res = await callTwitterAPI('twitter/tweets', {
                tweet_ids: id,
            });

            if (res.status !== 'success') {
                console.error('failed to get a tweet', { id });
                reply(ctx, 'failed to get the tweet');

                return;
            }

            if (!res.tweets[0]) {
                console.error('no such tweet', { id });
                reply(ctx, 'no such tweet');

                return;
            }

            (res as any).event_type = 'tweet';
            handleMessage(JSON.stringify(res));
        },
    );

    registerBotCommand(
        'update_watching',
        'updates watching list',
        async (ctx) => {
            console.log('update_watching command received');

            try {
                let followings;

                if (dbTwitter.data.followings.createdAt === NOT_YET_CREATED) {
                    reply(
                        ctx,
                        `Fetching current followings for @${usernameToFollow}...`,
                    );

                    const res = await callTwitterAPI(
                        'twitter/user/followings',
                        {
                            userName: usernameToFollow,
                        },
                    );

                    if (res.status === 'error') {
                        throw new Error(
                            `Failed to get followings: ${res.message || 'Unknown error'}`,
                        );
                    }

                    if (!res.followings) {
                        throw new Error('No followings returned');
                    }

                    followings = {
                        createdAt: Date.now(),
                        value: res.followings,
                    };
                    dbTwitter.data.followings = followings;
                    await dbTwitter.write();
                } else {
                    followings = dbTwitter.data.followings;
                    reply(
                        ctx,
                        `Using cached followings for @${usernameToFollow}...`,
                    );
                }

                const limitedFollowings = followings.value.slice(
                    0,
                    maxFollowings,
                );

                reply(
                    ctx,
                    `Found ${followings.value.length} followings, limiting to ${limitedFollowings.length}. Updating webhook rules...`,
                );

                const results = await updateWebhookRule(limitedFollowings);

                reply(
                    ctx,
                    `✅ Successfully managed webhook rules:\n• Updated: ${results.updated}\n• Created: ${results.created}\n• Deleted: ${results.deleted}\n• Total rules: ${results.total}\n\nNow watching ${limitedFollowings.length} accounts across ${results.total} rule${results.total > 1 ? 's' : ''}`,
                );
            } catch (error) {
                console.error('Error updating watching list:', error);
                reply(
                    ctx,
                    `❌ Error updating watching list: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
            }
        },
    );

    registerBotCommand(
        'intents',
        'manage your current intents',
        (ctx) => (ctx as any).scene.enter('INTENTS_LIST_SCENE')
    );

    bot.telegram.setMyCommands(commandsList);

    bot.on('message', async (ctx) => {
        if ('text' in ctx.message) {
            const {
                text,
                from: { username },
            } = ctx.message;

            console.log('incoming message', { username, text });
            dbTelegram.data.chatIdWithLastMessageList[ctx.chat.id] = {
                ...dbTelegram.data.chatIdWithLastMessageList[ctx.chat.id],
                lastMessageUser: {
                    id: ctx.message.message_id,
                    text: ctx.message.text,
                },
            };

            reply(ctx, 'received as a text');
        } else {
            reply(ctx, 'received, ingored as a non-text');
        }

        dbTelegram.write();
    });

    bot.command('quit', async (ctx) => {
        // Explicit usage
        await ctx.telegram.leaveChat(ctx.message.chat.id);

        // Using context shortcut
        await ctx.leaveChat();
    });

    // Global callback query handler for non-scene callbacks
    bot.on('callback_query', async (ctx) => {
        await ctx.answerCbQuery();
        // Handle any global callback queries here if needed
    });

    bot.on('inline_query', async (ctx) => {
        const result = [] as any[];
        // Explicit usage
        await ctx.telegram.answerInlineQuery(ctx.inlineQuery.id, result);

        // Using context shortcut
        await ctx.answerInlineQuery(result);
    });

    bot.launch(() => console.log('tg bot started'));

    const updateMessageStatus = async () => {
        await Promise.all(
            Object.entries(dbTelegram.data.chatIdWithLastMessageList).map(
                async ([chatId, { lastMessageBot }]) => {
                    if (!lastMessageBot) {
                        return;
                    }

                    const { id, text } = lastMessageBot;

                    const textNew = patchMessageStatusText(text);
                    console.log('edit message text to update status');

                    if (text !== textNew) {
                        const res = await bot.telegram.editMessageText(
                            chatId,
                            id,
                            undefined,
                            textNew,
                        );

                        return res;
                    }
                },
            ),
        );
    };
    setInterval(updateMessageStatus, 10000);
    updateMessageStatus();

    return {
        broadcastMessage: async (msg: string) => {
            const entries = Object.entries(
                dbTelegram.data.chatIdWithLastMessageList,
            );
            await Promise.all(
                entries.map(([chatId]) =>
                    sendMessage(chatId, msg).catch((err) =>
                        console.error('error broadcasting', {
                            chatId,
                            msg,
                            err,
                        }),
                    ),
                ),
            );
        },
    };
}
