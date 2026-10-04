import type { Server } from 'socket.io';
import { EVENTS, stockRoom, type StockPricePayload } from '@/websocket/events';

// Set once the HTTP server boots; jobs call emit* and it's a no-op in scripts/tests.
let io: Server | undefined;

export const setIo = (server: Server | undefined) => {
  io = server;
};

export const emitStockPrices = (prices: StockPricePayload[]) => {
  if (!io) return;
  for (const p of prices) io.to(stockRoom(p.symbol)).emit(EVENTS.STOCK_PRICE_UPDATED, p);
};
