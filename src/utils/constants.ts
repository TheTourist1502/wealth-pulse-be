export const MARKET_TZ = 'America/New_York';

// Indices shown in Market Overview and offered as performance benchmarks.
export const BENCHMARKS = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'NASDAQ' },
  { symbol: '^DJI', label: 'Dow Jones' },
  { symbol: '^VIX', label: 'VIX' },
] as const;

export const BENCHMARK_SYMBOLS: string[] = BENCHMARKS.map((b) => b.symbol);

// Its quote time defines the current session date; its daily bars are the trading calendar.
export const CALENDAR_SYMBOL = '^GSPC';

export const PERFORMANCE_RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y'] as const;
export type PerformanceRange = (typeof PERFORMANCE_RANGES)[number];

export const SYMBOL_REGEX = /^[A-Z0-9.^=-]{1,15}$/;
