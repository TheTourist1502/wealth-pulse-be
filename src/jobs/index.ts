import { logger } from '@/config/logger';
import { getQueues } from '@/jobs/queues';
import { MARKET_TZ } from '@/utils/constants';
import { isRegularHours } from '@/utils/marketTime';
import * as dashboardService from '@/routes/dashboard/dashboardService';
import * as marketService from '@/routes/market/marketService';

const QUIET_INTERVAL_MS = 5 * 60_000;

// Registers processors and the repeatable schedules (stable jobIds, so restarts don't duplicate them).
export const startJobs = async () => {
  const q = getQueues();

  // Every 30s in regular hours, every 5 min otherwise.
  // ponytail: last-run time is per process; with several instances the quiet cadence is per instance.
  let lastQuoteRun = 0;
  void q.priceUpdate.process(async () => {
    if (!isRegularHours() && Date.now() - lastQuoteRun < QUIET_INTERVAL_MS) return;
    lastQuoteRun = Date.now();
    await marketService.refreshTrackedQuotes();
  });

  // Closes first, then snapshots built from them.
  void q.eodPrices.process(async () => {
    await marketService.refreshDailyCloses();
    await dashboardService.snapshotAll();
  });

  void q.securityProfile.process(async (job) =>
    job.data.symbol ? marketService.refreshProfile(job.data.symbol) : marketService.refreshAllProfiles(),
  );

  void q.snapshotRebuild.process(async (job) => dashboardService.rebuildSnapshots(job.data.portfolioId, job.data.fromDate));

  for (const [name, queue] of Object.entries(q)) {
    queue.on('failed', (job, err) => logger.error({ err, jobId: job.id, data: job.data }, `job ${name} failed`));
  }

  await Promise.all([
    q.priceUpdate.add({}, { repeat: { every: 30_000 }, jobId: 'price-update' }),
    q.eodPrices.add({}, { repeat: { cron: '30 16 * * 1-5', tz: MARKET_TZ }, jobId: 'eod-prices' }),
    q.securityProfile.add({}, { repeat: { cron: '0 6 * * 1', tz: MARKET_TZ }, jobId: 'profile-weekly' }),
  ]);
  logger.info('jobs started');
};
