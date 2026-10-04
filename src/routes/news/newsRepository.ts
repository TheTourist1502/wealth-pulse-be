import { sql } from 'drizzle-orm';
import { db } from '@/config/database';
import { toDbError } from '@/utils/appError';

// The user's largest positions by market value (cost basis until a quote exists).
export const findTopHeldSymbols = async (userId: string, limit: number) => {
  try {
    const rows = await db.execute<{ symbol: string }>(sql`
      select h.symbol
      from holdings h
      join portfolios p on p.id = h.portfolio_id
      join securities s on s.symbol = h.symbol
      left join security_quotes q on q.symbol = h.symbol
      where p.user_id = ${userId} and h.quantity > 0 and s.quote_type = 'EQUITY'
      group by h.symbol
      order by sum(h.quantity * coalesce(q.price, h.average_cost)) desc
      limit ${limit}`);
    return rows.map((r) => r.symbol);
  } catch (err) {
    throw toDbError(err);
  }
};
