import YahooFinance from 'yahoo-finance2';

// Single configured client; every Yahoo call goes through routes/market/marketService.
export const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
