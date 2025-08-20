import { JSONFilePreset } from 'lowdb/node';
import { getDbPath } from './db-utils';
import { type Intent } from './llm';
import { Bot, Context } from 'grammy';
import { adminUsername, maxFollowings, usernameToFollow } from '.';
import {
    patchMessageStatusText,
    removeMessageStatusText,
} from './telegram.utils';
import { handleMessage } from './ws';
import type { BotCommand, InlineKeyboardMarkup } from 'grammy/types';
import {
    callTwitterAPI,
    dbTwitter,
    NOT_YET_CREATED,
    updateWebhookRule,
} from './twitter';
import {
    type Conversation,
    type ConversationFlavor,
    conversations,
    createConversation,
} from '@grammyjs/conversations';

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

const messageIdToReplyMarkup: Record<string, InlineKeyboardMarkup> = {};

export const sendMessage: typeof bot.api.sendMessage = async (
    chatId,
    textRaw: string,
    extra,
) => {
    const text = patchMessageStatusText(textRaw);

    const msg = await bot.api.sendMessage(chatId, text, extra);

    const lastMessageBot =
        dbTelegram.data.chatIdWithLastMessageList[chatId]?.lastMessageBot;

    if (lastMessageBot) {
        const textNew = removeMessageStatusText(lastMessageBot.text);
        if (lastMessageBot.text !== textNew) {
            bot.api.editMessageText(chatId, lastMessageBot.id, textNew);
        }
    }

    dbTelegram.data.chatIdWithLastMessageList[chatId] = {
        ...dbTelegram.data.chatIdWithLastMessageList[chatId],
        lastMessageBot: {
            id: msg.message_id,
            text: msg.text,
        },
    };
    messageIdToReplyMarkup[msg.message_id] =
        extra?.reply_markup as InlineKeyboardMarkup;

    dbTelegram.write();

    // setTimeout(updateMessageStatus, 1000);

    return msg;
};

const reply = async (
    ctx: Context,
    ...replyArgs: Parameters<Context['reply']>
) => {
    if (!ctx.chat) {
        console.warn('no chat id - reject');
        return;
    }

    const [text, extra] = replyArgs;

    let finalText = text;
    if (typeof text === 'string') {
        finalText = patchMessageStatusText(text);
    }

    const msg = await ctx.reply(finalText, extra);

    const lastMessageBot =
        dbTelegram.data.chatIdWithLastMessageList[ctx.chat.id]?.lastMessageBot;

    if (lastMessageBot) {
        const textNew = removeMessageStatusText(lastMessageBot.text);
        if (lastMessageBot.text !== textNew) {
            bot.api.editMessageText(ctx.chat.id, lastMessageBot.id, textNew);
        }
    }

    dbTelegram.data.chatIdWithLastMessageList[ctx.chat.id] = {
        ...dbTelegram.data.chatIdWithLastMessageList[ctx.chat.id],
        lastMessageBot: {
            id: msg.message_id,
            text: msg.text,
        },
    };
    messageIdToReplyMarkup[msg.message_id] =
        extra?.reply_markup as InlineKeyboardMarkup;

    dbTelegram.write();

    return msg;
};

const updateMessageStatus = async () => {
    await Promise.all(
        Object.entries(dbTelegram.data.chatIdWithLastMessageList).map(
            async ([chatId, { lastMessageBot }]) => {
                if (!lastMessageBot) {
                    return;
                }

                const { id, text } = lastMessageBot;
                // const replyMarkup = messageIdToReplyMarkup[id];

                const textNew = patchMessageStatusText(text);
                console.log('edit message text to update status');

                if (text !== textNew) {
                    const res = await bot.api.editMessageText(
                        chatId,
                        id,
                        textNew,
                        // { reply_markup: replyMarkup },
                    );

                    // if (res === true) {
                    //     return true;
                    // }

                    // await bot.api.editMessageReplyMarkup(chatId, res.message_id, {
                    //     reply_markup: replyMarkup,
                    // });

                    return res;
                }
            },
        ),
    );
};

const bot = new Bot<ConversationFlavor<Context>>(telegramToken);

export function initTelegramBot() {
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

    bot.use(conversations());

    bot.command('start', (ctx) => {
        if (!ctx.from?.username) {
            ctx.reply('no username');
            return;
        }

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
            if (!ctx.message) {
                reply(ctx, 'no message');
                return;
            }

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

    /*

    menu with pagination example

    const bot = new Bot(BOT_TOKEN);

const data = [
  ['a', 'b', 'c'],
  ['d', 'e', 'f'],
  ['g', 'h', 'i'],
];

async function getData(opts: { page: number } = { page: 1 }) { 
  return { items: data[opts.page - 1], pagesCount: data.length };
}

const buildRange = async (pageInfo: string, ctx: Context, range: MenuRange<Context>) => {
  console.log(pageInfo);
  const [ currentS, nextS, selection ] = pageInfo.split('_');
  ctx.match = `${nextS}_${nextS}_${selection}`;

  const [ current, next ] = [ currentS, nextS ].map(Number);

  const { items, pagesCount } = await getData({ page: current })

  for (const item of items) {
    range.submenu({ text: item, payload: `${current}_${current}_${item}`}, 'specific_item', async ctx => {
      await ctx.editMessageText(`You have seleceted ${item}`);
    }).row()
  }

  if (current > 1) {
    range.submenu({ text: 'Previous page', payload: `${current}_${current - 1}_` }, 'items_page')
  }

  if (current < pagesCount) {
    range.submenu({ text: 'Next page', payload: `${current}_${current + 1}_` }, 'items_page').row()
  }

  range.back('Back')
}

const items = new Menu<Context>('items').dynamic((ctx, range) => buildRange(ctx.has('callback_query:data') ? ctx.match as string : '1_1_', ctx, range))

const itemsPage = new Menu<Context>('items_page').dynamic((ctx, range) => buildRange(ctx.has('callback_query:data') ? ctx.match as string : '1_1_', ctx, range))

const specificItem = new Menu<Context>('specific_item').back('Back');

items.register([itemsPage, specificItem])

bot.use(items);
bot.command('start', async ctx => {
  await ctx.reply('Here', { reply_markup: items });
});

await bot.start();
        
    */

    async function intentUpdateConversation(conv: Conversation, ctx: Context) {
        await conv.log('intentUpdateConversation');

        const userIntents = dbTelegram.data.intentsByUsername[adminUsername];

        if (!userIntents || userIntents.length === 0) {
            await reply(ctx, 'No intents found for your account.');
            return conv.halt();
        }

        const intentsMenu = conv.menu().dynamic((ctx, range) => {
            ctx.match = '';

            for (const intent of userIntents) {
                range.text(intent.id, (ctx) => {
                    ctx.match = intent.id;
                });
            }
        });

        await reply(ctx, 'Please select an intent:', {
            reply_markup: intentsMenu,
        });

        const chosenIntent = userIntents.find(
            (intent) => intent.id === ctx.match,
        );

        conv.log('chosenIntent', chosenIntent);

        if (!chosenIntent) {
            return await conv.waitUntil(() => Boolean(chosenIntent), {
                otherwise: (ctx) => reply(ctx, 'Please use the menu above!'),
            });
        }

        await conv.log('chosenIntent', chosenIntent);

        await reply(ctx, `Updating intent: ${chosenIntent.id}`);
    }

    const INTENT_UPDATE_CONVERSATION_ID = 'intent_update';

    bot.use(
        createConversation(
            intentUpdateConversation,
            INTENT_UPDATE_CONVERSATION_ID,
        ),
    );

    registerBotCommand(
        'intents',
        'manage your current intents',
        async (ctx) => {
            await ctx.conversation.enter(INTENT_UPDATE_CONVERSATION_ID);
        },
    );

    bot.api.setMyCommands(commandsList);

    bot.on('message', async (ctx) => {
        if ('text' in ctx.message && ctx.message.text) {
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

    // setInterval(updateMessageStatus, 10000);
    // updateMessageStatus();

    bot.start({
        onStart: () => console.log('tg bot started'),
        timeout: 90_000,
    });
}
