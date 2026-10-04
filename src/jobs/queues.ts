import Queue from 'bull';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

export type SecurityProfileJob = { symbol?: string }; // no symbol = weekly refresh of all
export type SnapshotRebuildJob = { portfolioId: string; fromDate: string };

const defaultJobOptions: Queue.JobOptions = {
  removeOnComplete: 1000,
  removeOnFail: 5000,
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

const make = <T>(name: string) => new Queue<T>(name, env.REDIS_URL, { defaultJobOptions });

// Created lazily so importing a service (tests, seed) doesn't open Redis connections.
let queues:
  | {
      priceUpdate: Queue.Queue<Record<string, never>>;
      eodPrices: Queue.Queue<Record<string, never>>;
      securityProfile: Queue.Queue<SecurityProfileJob>;
      snapshotRebuild: Queue.Queue<SnapshotRebuildJob>;
    }
  | undefined;

export const getQueues = () =>
  (queues ??= {
    priceUpdate: make('price-update'),
    eodPrices: make('eod-prices'),
    securityProfile: make('security-profile'),
    snapshotRebuild: make('snapshot-rebuild'),
  });

// Enqueueing happens after the DB commit; a Redis hiccup must not fail the request.
const safeAdd = async (fn: () => Promise<unknown>, what: string) => {
  try {
    await fn();
  } catch (err) {
    logger.error({ err }, `failed to enqueue ${what}`);
  }
};

export const enqueueSecurityProfile = (symbol: string) =>
  safeAdd(() => getQueues().securityProfile.add({ symbol }), `security-profile ${symbol}`);

// ponytail: no dedupe — rebuilds are idempotent upserts; add a debounce if trade bursts make them pile up.
export const enqueueSnapshotRebuild = (job: SnapshotRebuildJob) =>
  safeAdd(() => getQueues().snapshotRebuild.add(job), `snapshot-rebuild ${job.portfolioId}`);

export const closeQueues = async () => {
  if (queues) await Promise.allSettled(Object.values(queues).map((q) => q.close()));
};
