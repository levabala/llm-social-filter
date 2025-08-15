import { type } from "arktype";
import WebSocket, { type RawData } from "ws";

type EventType = "connected" | "ping" | "tweet" | string;

export const TweetAuthorType = type({
    type: "'user'",
    userName: "string",
    url: "string",
    twitterUrl: "string",
    id: "string",
    name: "string",
    isVerified: "boolean",
    isBlueVerified: "boolean",
    verifiedType: "string | null",
    profilePicture: "string",
    coverPicture: "string",
    description: "string",
    location: "string",
    followers: "number",
    following: "number",
    status: "string",
    canDm: "boolean",
    canMediaTag: "boolean",
    createdAt: "string",
    entities: {
        description: { urls: "unknown[]" },
        url: "Record<string, unknown>",
    },
    fastFollowersCount: "number",
    favouritesCount: "number",
    hasCustomTimelines: "boolean",
    isTranslator: "boolean",
    mediaCount: "number",
    statusesCount: "number",
    withheldInCountries: "string[]",
    "affiliatesHighlightedLabel?": {
        label: {
            badge: { url: "string" },
            description: "string",
            url: {
                url: "string",
                url_type: "'DeepLink' | string",
            },
            user_label_type: "'BusinessLabel' | string",
            user_label_display_type: "'Badge' | string",
        },
    },
    possiblySensitive: "boolean",
    pinnedTweetIds: "string[]",
    profile_bio: {
        description: "string",
        entities: { description: "Record<string, unknown>" },
    },
    isAutomated: "boolean",
    automatedBy: "string | null",
});

export const TweetType = type({
    type: "'tweet'",
    id: "string",
    url: "string",
    twitterUrl: "string",
    text: "string",
    source: "string",
    retweetCount: "number",
    replyCount: "number",
    likeCount: "number",
    quoteCount: "number",
    viewCount: "number",
    createdAt: "string",
    lang: "string",
    bookmarkCount: "number",
    isReply: "boolean",
    inReplyToId: "string | null",
    conversationId: "string | null",
    inReplyToUserId: "string | null",
    inReplyToUsername: "string | null",
    author: TweetAuthorType,
    extendedEntities: "Record<string, unknown>",
    card: "unknown | null",
    place: "Record<string, unknown>",
    entities: {
        user_mentions: [
            {
                id_str: "string",
                indices: ["number", "number"],
                name: "string",
                screen_name: "string",
            },
        ],
    },
    quoted_tweet: "this | null",
    retweeted_tweet: "this | null",
    article: "unknown | null",
});

interface BaseMessage {
    event_type?: EventType;
    timestamp?: number; // milliseconds
    [k: string]: unknown;
}

export interface TweetMessage extends BaseMessage {
    event_type: "tweet";
    rule_id?: string;
    rule_tag?: string;
    tweets?: (typeof TweetType)["infer"][];
}

interface PingMessage extends BaseMessage {
    event_type: "ping";
    timestamp: number;
}

function formatMsDiff(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}min${secs}sec`;
}

function formatEpochMs(ms: number): string {
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

export const messageHandlerRef = {
    current: (msg: TweetMessage) => {
        void msg;
    },
};

export function handleMessage(message: string): void {
    try {
        console.log(`\nReceived message: ${message}`);
        const parsed = JSON.parse(message) as BaseMessage;

        const eventType = parsed.event_type;

        if (eventType === "connected") {
            console.log("Connection successful!");
            return;
        }

        if (eventType === "ping") {
            const m = parsed as PingMessage;
            console.log("ping!");
            const nowMs = Date.now();
            const currentTimeStr = formatEpochMs(nowMs);
            const ts = m.timestamp;
            const diffMs = nowMs - ts;

            console.log(`Current time: ${currentTimeStr}`);
            console.log(`Message timestamp: ${formatEpochMs(ts)}`);
            console.log(
                `Time difference: ${formatMsDiff(diffMs)} (${diffMs.toFixed(0)} milliseconds)`,
            );
            return;
        }

        if (eventType === "tweet") {
            const m = parsed as TweetMessage;
            console.log("tweet!");

            const ruleId = m.rule_id;
            const ruleTag = m.rule_tag;
            const tweets = Array.isArray(m.tweets) ? m.tweets : [];
            const ts =
                typeof m.timestamp === "number" ? m.timestamp : undefined;

            console.log(`rule_id: ${ruleId}`);
            console.log(`rule_tag: ${ruleTag}`);
            console.log(`event_type: ${eventType}`);
            console.log(`Number of tweets: ${tweets.length}`);
            console.log(`timestamp: ${ts}`);

            if (typeof ts === "number") {
                const nowMs = Date.now();
                const diffMs = nowMs - ts;
                const currentTimeStr = formatEpochMs(nowMs);

                console.log(`Current time: ${currentTimeStr}`);
                console.log(`Message timestamp: ${formatEpochMs(ts)}`);
                console.log(
                    `Time difference: ${formatMsDiff(diffMs)} (${diffMs.toFixed(0)} milliseconds)`,
                );
            }

            messageHandlerRef.current(m);

            return;
        }

        console.log('unknown event type', eventType);
    } catch (e) {
        if (e instanceof SyntaxError) {
            console.error(
                `JSON parsing error: ${(e as Error).message}. stack: ${(e as Error).stack}`,
            );
        } else {
            console.error(
                `Error occurred while processing message: ${(e as Error).message}. stack: ${
                    (e as Error).stack
                }`,
            );
        }
    }
}

type ConnectOptions = {
    url: string;
    apiKey: string;
    // Ping configuration (client pings)
    pingIntervalMs?: number; // how often to send pings
    pingTimeoutMs?: number; // if no pong within this, consider connection stale
    // Reconnect configuration
    reconnectDelayMs?: number; // delay before reconnect attempt
    maxReconnectDelayMs?: number; // optional backoff cap
    // Headers
    headers?: Record<string, string>;
};

export class TwitterWsClient {
    private ws: WebSocket | null = null;
    private opts: Required<Omit<ConnectOptions, "headers">> & {
        headers: Record<string, string>;
    };
    private pingTimer: NodeJS.Timeout | null = null;
    private pongTimer: NodeJS.Timeout | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor(options: ConnectOptions) {
        this.opts = {
            url: options.url,
            apiKey: options.apiKey,
            pingIntervalMs: options.pingIntervalMs ?? 40_000,
            pingTimeoutMs: options.pingTimeoutMs ?? 30_000,
            reconnectDelayMs: options.reconnectDelayMs ?? 90_000,
            maxReconnectDelayMs: options.maxReconnectDelayMs ?? 90_000,
            headers: {
                "x-api-key": options.apiKey,
                ...(options.headers ?? {}),
            },
        };
    }

    start() {
        this.connect();
    }

    stop() {
        this.clearTimers();
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close(1000, "Client closing");
        }
        this.ws = null;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private connect() {
        this.clearTimers();

        this.ws = new WebSocket(this.opts.url, {
            headers: this.opts.headers,
        });

        this.ws.on("open", () => {
            console.log("\nConnection established!");
            this.startPings();
        });

        this.ws.on("message", (data: RawData) => {
            const msg = typeof data === "string" ? data : data.toString("utf8");
            handleMessage(msg);
        });

        this.ws.on("error", (err: Error) => {
            console.error(
                `\nError occurred: ${err}, stack: ${err.stack ?? ""}`,
            );

            // Inspect common error types/messages
            const msg = String(err?.message ?? "");
            if (msg.includes("ETIMEDOUT")) {
                console.error(
                    "Connection timeout. Please check if server is running or network connection.",
                );
            } else if (msg.includes("401") || msg.includes("403")) {
                console.error(
                    `Server returned error status code (auth): ${msg}. Please check if API key and endpoint path are correct.`,
                );
            } else if (msg.includes("ECONNREFUSED")) {
                console.error(
                    "Connection refused. Please confirm server address and port are correct.",
                );
            }
        });

        this.ws.on("close", (code: number, reasonBuf: Buffer) => {
            const reason =
                reasonBuf && reasonBuf.length > 0
                    ? reasonBuf.toString("utf8")
                    : undefined;
            console.log(
                `\nConnection closed: status_code=${code}, message=${reason}`,
            );

            switch (code) {
                case 1000:
                    console.log("Normal connection closure");
                    break;
                case 1001:
                    console.log(
                        "Server is shutting down or client navigating away",
                    );
                    break;
                case 1002:
                    console.log("Protocol error");
                    break;
                case 1003:
                    console.log("Received unacceptable data type");
                    break;
                case 1006:
                    console.log(
                        "Abnormal connection closure, possibly network issues",
                    );
                    break;
                case 1008:
                    console.log("Policy violation");
                    break;
                case 1011:
                    console.log("Server internal error");
                    break;
                case 1013:
                    console.log("Server overloaded");
                    break;
                default:
                    // Other status codes possible
                    break;
            }

            this.scheduleReconnect();
        });

        this.ws.on("pong", () => {
            // Got pong, clear pong timeout
            if (this.pongTimer) {
                clearTimeout(this.pongTimer);
                this.pongTimer = null;
            }
        });
    }

    private startPings() {
        // Send periodic pings and wait for pong within pingTimeoutMs
        if (this.pingTimer) clearInterval(this.pingTimer as unknown as number);

        const sendPing = () => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

            try {
                this.ws.ping();
                // If no pong within timeout, terminate and reconnect
                if (this.pongTimer) clearTimeout(this.pongTimer);
                this.pongTimer = setTimeout(() => {
                    console.warn("Pong timeout, terminating socket...");
                    try {
                        this.ws?.terminate();
                    } finally {
                        this.scheduleReconnect(true);
                    }
                }, this.opts.pingTimeoutMs);
            } catch (e) {
                console.warn(
                    `Failed to send ping: ${(e as Error).message}. Will reconnect.`,
                );
                this.scheduleReconnect(true);
            }
        };

        // Immediately send first ping soon after open, then at interval
        this.pingTimer = setInterval(sendPing, this.opts.pingIntervalMs);
    }

    private scheduleReconnect(immediate = false) {
        this.clearTimers();

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        const delay = immediate
            ? 0
            : Math.min(
                  this.opts.reconnectDelayMs,
                  this.opts.maxReconnectDelayMs,
              );

        this.reconnectTimer = setTimeout(() => {
            console.log("Reconnecting...");
            this.connect();
        }, delay);
    }

    private clearTimers() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer as unknown as number);
            this.pingTimer = null;
        }
        if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
        }
    }
}

export function startWebsocket(apiKey: string) {
    const url = "wss://ws.twitterapi.io/twitter/tweet/websocket";

    const client = new TwitterWsClient({
        url,
        apiKey,
        pingIntervalMs: 60_000,
        pingTimeoutMs: 30_000,
        reconnectDelayMs: 90_000,
    });

    client.start();

    // Optional graceful shutdown
    process.on("SIGINT", () => {
        console.log("Shutting down...");
        client.stop();
        process.exit(0);
    });
}
