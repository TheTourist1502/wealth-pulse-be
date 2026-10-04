// Integration: runs against the dev database + Redis and expects `npm run db:seed` to have run.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { app } from '@/app';
import { sql } from '@/config/database';
import { redisClient } from '@/config/redis';

let cookie: string[] = [];

before(async () => {
  await redisClient.connect();
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@wealthpulse.com', password: 'test' });
  assert.equal(res.status, 200);
  cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
});

after(async () => {
  await Promise.allSettled([sql.end({ timeout: 5 }), redisClient.quit()]);
});

const get = (path: string) => request(app).get(path).set('Cookie', cookie);

test('dashboard endpoints require auth', async () => {
  for (const path of ['/api/dashboard/summary', '/api/dashboard/holdings', '/api/market/indices', '/api/news']) {
    assert.equal((await request(app).get(path)).status, 401, path);
  }
});

test('summary: totals are consistent', async () => {
  const res = await get('/api/dashboard/summary');
  assert.equal(res.status, 200);
  const s = res.body.data;
  assert.ok(s.holdingsCount > 0, 'seeded holdings expected');
  const cents = (v: string) => Math.round(Number(v) * 100);
  assert.equal(cents(s.totalReturn), cents(s.marketValue) - cents(s.invested));
  assert.equal(cents(s.overallPnl), cents(s.totalReturn) + cents(s.realizedPnl));
});

test('holdings: weights sum to ~100% and default sort is by market value', async () => {
  const res = await get('/api/dashboard/holdings');
  assert.equal(res.status, 200);
  const rows: { marketValue: string; weightPct: string }[] = res.body.data;
  const weight = rows.reduce((s, r) => s + Number(r.weightPct), 0);
  assert.ok(Math.abs(weight - 100) < 0.2, `weights sum to ${weight}`);
  const values = rows.map((r) => Number(r.marketValue));
  assert.deepEqual(values, [...values].sort((a, b) => b - a));
});

test('performance: daily series starts at 0% and includes benchmarks', async () => {
  const res = await get('/api/dashboard/performance?range=3M&benchmarks=^GSPC,^IXIC');
  assert.equal(res.status, 200);
  const { portfolio, benchmarks } = res.body.data;
  assert.equal(portfolio.points[0].returnPct, '0.00');
  assert.equal(benchmarks.length, 2);
  assert.equal(benchmarks[0].points[0].t, portfolio.points[0].t, 'benchmarks share the portfolio baseline date');
});

test('IDOR: another portfolio id is 404, not 403', async () => {
  const res = await get('/api/dashboard/summary?portfolioId=00000000-0000-4000-8000-000000000000');
  assert.equal(res.status, 404);
});

test('validation: bad range and unknown benchmark are 400', async () => {
  assert.equal((await get('/api/dashboard/performance?range=5Y')).status, 400);
  assert.equal((await get('/api/dashboard/performance?range=1M&benchmarks=AAPL')).status, 400);
});
