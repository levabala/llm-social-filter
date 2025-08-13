import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { JSONFilePreset } from "lowdb/node";

const telegramToken = process.env.TELEGRAM_BOT_TOKEN!;

if (!telegramToken) {
    throw new Error("telegram bot token is absent");
}

const db = await JSONFilePreset("db_telegram.json", {
    chatIds: [] as number[],
});

const bot = new Telegraf(telegramToken);

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

export function initTelegramBot() {
    console.log("initTelegramBot");

    bot.start((ctx) => {
        db.data.chatIds.push(ctx.chat.id);
        ctx.reply("Welcome!");
    });

    bot.command("quit", async (ctx) => {
        // Explicit usage
        await ctx.telegram.leaveChat(ctx.message.chat.id);

        // Using context shortcut
        await ctx.leaveChat();
    });

    bot.on(message("text"), async (ctx) => {
        // Explicit usage
        await ctx.telegram.sendMessage(
            ctx.message.chat.id,
            `Hello ${ctx.state.role}`,
        );

        // Using context shortcut
        await ctx.reply(`Hello ${ctx.state.role}`);
    });

    bot.on("callback_query", async (ctx) => {
        // Explicit usage
        await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);

        // Using context shortcut
        await ctx.answerCbQuery();
    });

    bot.on("inline_query", async (ctx) => {
        const result = [] as any[];
        // Explicit usage
        await ctx.telegram.answerInlineQuery(ctx.inlineQuery.id, result);

        // Using context shortcut
        await ctx.answerInlineQuery(result);
    });

    bot.launch();

    return {
        broadcastMessage: async (msg: string) => {
            await Promise.all(
                db.data.chatIds.map((chatId) =>
                    bot.telegram.sendMessage(chatId, msg).catch((err) =>
                        console.error("error broadcasting", {
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
