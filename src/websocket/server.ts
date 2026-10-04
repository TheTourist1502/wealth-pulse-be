import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { redisClient } from '@/config/redis';
import { ACCESS_COOKIE, readCookie, verifyAccessToken } from '@/middleware/auth';
import { symbolString } from '@/utils/parse';
import { setIo } from '@/websocket/emitter';
import { EVENTS, stockRoom } from '@/websocket/events';

const MAX_STOCK_ROOMS = 50;

type Ack = (res: { ok: true } | { ok: false; error: string }) => void;
const noopAck: Ack = () => {};

export const initSocket = async (httpServer: HttpServer) => {
  const io = new Server(httpServer, { cors: { origin: env.FRONTEND_URL, credentials: true } });

  // Pub/sub needs dedicated connections.
  const pub = redisClient.duplicate();
  const sub = redisClient.duplicate();
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));

  // Same access-token cookie as HTTP; rejected before `connection`.
  io.use((socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE);
      if (!token) throw new Error('missing token');
      socket.data.userId = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const stockRooms = () => [...socket.rooms].filter((r) => r.startsWith('stock:')).length;

    socket.on(EVENTS.SUBSCRIBE_STOCK, (payload: unknown, ack: Ack = noopAck) => {
      const parsed = symbolString.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'Invalid symbol' });
      if (stockRooms() >= MAX_STOCK_ROOMS) return ack({ ok: false, error: 'Too many subscriptions' });
      void socket.join(stockRoom(parsed.data));
      ack({ ok: true });
    });

    socket.on(EVENTS.UNSUBSCRIBE_STOCK, (payload: unknown, ack: Ack = noopAck) => {
      const parsed = symbolString.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'Invalid symbol' });
      void socket.leave(stockRoom(parsed.data));
      ack({ ok: true });
    });
  });

  setIo(io);
  logger.info('socket.io ready');

  return async () => {
    setIo(undefined);
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.allSettled([pub.quit(), sub.quit()]);
  };
};
