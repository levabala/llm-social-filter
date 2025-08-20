import { dbTwitterWSStats } from './ws';
import { calculateCreditUsage, dbTwitter, dbTwitterApiStats } from './twitter';

export function countPerDayPerHour(arr: Array<{ date: number }>) {
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
