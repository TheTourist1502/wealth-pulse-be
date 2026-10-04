import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '@/config/database';
import { portfolios } from '@/db/schema';
import { toDbError } from '@/utils/appError';
import { CALENDAR_SYMBOL, MARKET_TZ } from '@/utils/constants';

// Every query below filters through `portfolios p` with this predicate (IDOR rule).
export type Scope = { userId: string; portfolioId?: string };
const owned = ({ userId, portfolioId }: Scope): SQL =>
  portfolioId ? sql`p.user_id = ${userId} and p.id = ${portfolioId}` : sql`p.user_id = ${userId}`;

const nyDate = (column: SQL) => sql`(${column} at time zone ${MARKET_TZ})::date`;

// Open positions merged by symbol, with live quote and session-aware today's P&L:
// qty_now × price − qty_before_session × previous_close − net cash flow of this session's trades.
const holdingsCte = (scope: Scope, sessionDate: string) => sql`
  agg as (
    select h.symbol, sum(h.quantity) as qty, sum(h.quantity * h.average_cost) as cost_basis
    from holdings h join portfolios p on p.id = h.portfolio_id
    where ${owned(scope)} and h.quantity > 0
    group by h.symbol
  ),
  session_tx as (
    select t.symbol,
      sum(case when t.type = 'buy' then t.quantity else -t.quantity end) as qty_delta,
      sum(case when t.type = 'buy' then t.quantity * t.price + t.fee else -(t.quantity * t.price - t.fee) end) as net_flow
    from transactions t join portfolios p on p.id = t.portfolio_id
    where ${owned(scope)} and ${nyDate(sql`t.executed_at`)} = ${sessionDate}::date
    group by t.symbol
  ),
  rows as (
    select a.symbol, s.name, s.sector, s.quote_type, a.qty, a.cost_basis,
      q.price, q.previous_close, q.change, q.change_percent, q.quoted_at,
      a.qty * q.price as market_value,
      a.qty * q.price - (a.qty - coalesce(st.qty_delta, 0)) * q.previous_close - coalesce(st.net_flow, 0) as today_pnl
    from agg a
    join securities s on s.symbol = a.symbol
    left join security_quotes q on q.symbol = a.symbol
    left join session_tx st on st.symbol = a.symbol
  )`;

// Qualified with `rows.` so ORDER BY uses the numeric columns, not the formatted text aliases.
const HOLDING_SORTS = {
  marketValue: 'rows.market_value',
  todayPnl: 'rows.today_pnl',
  totalPnl: '(rows.market_value - rows.cost_basis)',
  symbol: 'rows.symbol',
} as const;
export type HoldingSort = keyof typeof HOLDING_SORTS;

export type HoldingRow = {
  symbol: string;
  name: string | null;
  sector: string | null;
  quote_type: string;
  quantity: string;
  average_cost: string;
  cost_basis: string;
  price: string | null;
  previous_close: string | null;
  today_change: string | null;
  today_change_pct: string | null;
  today_pnl: string | null;
  market_value: string | null;
  total_pnl: string | null;
  total_return_pct: string | null;
  weight_pct: string | null;
  quote_as_of: string | null;
};

// Raw execute() returns timestamptz as a server-local string; emit ISO-8601 UTC instead.
const isoUtc = (column: SQL) => sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const findOwnedPortfolio = async (userId: string, portfolioId: string) => {
  try {
    const [row] = await db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
      .limit(1);
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

export const findHoldings = async (scope: Scope, sessionDate: string, sort: HoldingSort, order: 'asc' | 'desc') => {
  try {
    // Whitelisted column + direction, so sql.raw is safe here.
    const orderBy = sql.raw(`${HOLDING_SORTS[sort]} ${order === 'asc' ? 'asc' : 'desc'} nulls last, rows.symbol asc`);
    return await db.execute<HoldingRow>(sql`
      with ${holdingsCte(scope, sessionDate)}
      select symbol, name, sector, quote_type,
        trim_scale(qty)::text as quantity,
        trim_scale(round(cost_basis / qty, 4))::text as average_cost,
        round(cost_basis, 2)::text as cost_basis,
        trim_scale(price)::text as price,
        trim_scale(previous_close)::text as previous_close,
        trim_scale(round(change, 4))::text as today_change,
        round(change_percent, 2)::text as today_change_pct,
        round(today_pnl, 2)::text as today_pnl,
        round(market_value, 2)::text as market_value,
        round(market_value - cost_basis, 2)::text as total_pnl,
        round((market_value - cost_basis) / nullif(cost_basis, 0) * 100, 2)::text as total_return_pct,
        round(market_value / nullif(sum(market_value) over (), 0) * 100, 2)::text as weight_pct,
        ${isoUtc(sql`quoted_at`)} as quote_as_of
      from rows
      order by ${orderBy}`);
  } catch (err) {
    throw toDbError(err);
  }
};

export type SummaryTotals = {
  market_value: string;
  invested: string;
  rows_today_pnl: string;
  holdings_count: number;
  as_of: string | null;
  session_flow: string;
  prev_value: string;
  prev_count: number;
  realized_pnl: string;
};

// Raw (unrounded) totals; the service does the P&L arithmetic.
export const findSummaryTotals = async (scope: Scope, sessionDate: string) => {
  try {
    const [row] = await db.execute<SummaryTotals>(sql`
      with ${holdingsCte(scope, sessionDate)},
      prev as (
        select distinct on (ps.portfolio_id) ps.market_value
        from portfolio_snapshots ps join portfolios p on p.id = ps.portfolio_id
        where ${owned(scope)} and ps.as_of_date < ${sessionDate}::date
        order by ps.portfolio_id, ps.as_of_date desc
      )
      select
        (select coalesce(sum(market_value), 0) from rows)::text as market_value,
        (select coalesce(sum(cost_basis), 0) from rows)::text as invested,
        (select coalesce(sum(today_pnl), 0) from rows)::text as rows_today_pnl,
        (select count(*) from rows)::int as holdings_count,
        (select ${isoUtc(sql`max(quoted_at)`)} from rows) as as_of,
        (select coalesce(sum(net_flow), 0) from session_tx)::text as session_flow,
        (select coalesce(sum(market_value), 0) from prev)::text as prev_value,
        (select count(*) from prev)::int as prev_count,
        (select coalesce(sum(t.realized_pnl), 0) from transactions t join portfolios p on p.id = t.portfolio_id
          where ${owned(scope)})::text as realized_pnl`);
    if (!row) throw new Error('summary query returned no row');
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

// Daily value series from the last snapshot on/before fromDate up to (not including) the session date.
export const findSnapshotSeries = async (scope: Scope, fromDate: string, sessionDate: string) => {
  try {
    return await db.execute<{ date: string; value: string; flow: string }>(sql`
      with base as (
        select coalesce(max(ps.as_of_date), ${fromDate}::date) as d
        from portfolio_snapshots ps join portfolios p on p.id = ps.portfolio_id
        where ${owned(scope)} and ps.as_of_date <= ${fromDate}::date
      )
      select ps.as_of_date::text as date, sum(ps.market_value)::text as value, sum(ps.net_flow)::text as flow
      from portfolio_snapshots ps join portfolios p on p.id = ps.portfolio_id
      where ${owned(scope)} and ps.as_of_date >= (select d from base) and ps.as_of_date < ${sessionDate}::date
      group by ps.as_of_date
      order by ps.as_of_date`);
  } catch (err) {
    throw toDbError(err);
  }
};

// Current quantity per symbol (intraday charts) with previous close as the 1D baseline.
export const findHeldPositions = async (scope: Scope) => {
  try {
    return await db.execute<{ symbol: string; qty: string; previous_close: string | null }>(sql`
      select h.symbol, sum(h.quantity)::text as qty, max(q.previous_close)::text as previous_close
      from holdings h join portfolios p on p.id = h.portfolio_id
      left join security_quotes q on q.symbol = h.symbol
      where ${owned(scope)} and h.quantity > 0
      group by h.symbol`);
  } catch (err) {
    throw toDbError(err);
  }
};

// ---------- snapshots ----------

export const findPortfolioOwner = async (portfolioId: string) => {
  try {
    const [row] = await db.select({ userId: portfolios.userId }).from(portfolios).where(eq(portfolios.id, portfolioId));
    return row?.userId;
  } catch (err) {
    throw toDbError(err);
  }
};

export const findLedgerInfo = async (portfolioId: string) => {
  try {
    const [row] = await db.execute<{ first_date: string | null; symbols: string[] | null }>(sql`
      select min(${nyDate(sql`executed_at`)})::text as first_date, array_agg(distinct symbol) as symbols
      from transactions where portfolio_id = ${portfolioId}`);
    return { firstDate: row?.first_date ?? null, symbols: row?.symbols ?? [] };
  } catch (err) {
    throw toDbError(err);
  }
};

export const findPortfolioIdsWithTransactions = async () => {
  try {
    const rows = await db.execute<{ portfolio_id: string }>(sql`select distinct portfolio_id from transactions`);
    return rows.map((r) => r.portfolio_id);
  } catch (err) {
    throw toDbError(err);
  }
};

export const deleteSnapshotsOutside = async (portfolioId: string, firstDate: string | null) => {
  try {
    await db.execute(
      firstDate
        ? sql`delete from portfolio_snapshots where portfolio_id = ${portfolioId} and as_of_date < ${firstDate}::date`
        : sql`delete from portfolio_snapshots where portfolio_id = ${portfolioId}`,
    );
  } catch (err) {
    throw toDbError(err);
  }
};

// Rebuilds daily snapshots over [fromDate, toDate] from the ledger × daily closes.
// Trading days come from the calendar index's bars, so weekends/holidays produce no rows.
export const upsertSnapshots = async (portfolioId: string, fromDate: string, toDate: string) => {
  try {
    await db.execute(sql`
      insert into portfolio_snapshots (portfolio_id, as_of_date, market_value, net_flow)
      select ${portfolioId}, d.trade_date,
        coalesce(sum(pos.qty * px.close), 0),
        coalesce(max(fl.net_flow), 0)
      from security_prices_daily d
      left join lateral (
        select t.symbol, sum(case when t.type = 'buy' then t.quantity else -t.quantity end) as qty
        from transactions t
        where t.portfolio_id = ${portfolioId} and ${nyDate(sql`t.executed_at`)} <= d.trade_date
        group by t.symbol
        having sum(case when t.type = 'buy' then t.quantity else -t.quantity end) > 0
      ) pos on true
      left join lateral (
        select p.close from security_prices_daily p
        where p.symbol = pos.symbol and p.trade_date <= d.trade_date
        order by p.trade_date desc limit 1
      ) px on true
      left join lateral (
        select sum(case when t.type = 'buy' then t.quantity * t.price + t.fee
                        else -(t.quantity * t.price - t.fee) end) as net_flow
        from transactions t
        where t.portfolio_id = ${portfolioId} and ${nyDate(sql`t.executed_at`)} = d.trade_date
      ) fl on true
      where d.symbol = ${CALENDAR_SYMBOL} and d.trade_date between ${fromDate}::date and ${toDate}::date
        and d.trade_date >= (select min(${nyDate(sql`executed_at`)}) from transactions where portfolio_id = ${portfolioId})
      group by d.trade_date
      on conflict (portfolio_id, as_of_date)
      do update set market_value = excluded.market_value, net_flow = excluded.net_flow, updated_at = now()`);
  } catch (err) {
    throw toDbError(err);
  }
};
