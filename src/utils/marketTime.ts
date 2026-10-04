import { MARKET_TZ } from '@/utils/constants';

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: MARKET_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: MARKET_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// YYYY-MM-DD in New York time.
export const toNyDate = (d: Date): string => dateFmt.format(d);

// ponytail: ignores exchange holidays; the price job just runs a little more often on those days.
export const isRegularHours = (now = new Date()): boolean => {
  const parts = Object.fromEntries(clockFmt.formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
};

// Calendar arithmetic on YYYY-MM-DD strings (UTC-based, so no DST drift).
export const shiftDate = (isoDate: string, { days = 0, months = 0 }: { days?: number; months?: number }): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  // Clamp month-end: Mar 31 − 1 month = Feb 28, not Mar 3.
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay) + days);
  return d.toISOString().slice(0, 10);
};
