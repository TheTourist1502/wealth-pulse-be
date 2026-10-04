export const EVENTS = {
  SUBSCRIBE_STOCK: 'subscribe:stock',
  UNSUBSCRIBE_STOCK: 'unsubscribe:stock',
  STOCK_PRICE_UPDATED: 'stock:price:updated',
} as const;

export const stockRoom = (symbol: string) => `stock:${symbol}`;

export type StockPricePayload = {
  symbol: string;
  price: string;
  previousClose: string;
  change: string;
  changePercent: string;
  marketState: string;
  timestamp: string;
};
