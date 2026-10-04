import Decimal from 'decimal.js';

export type LedgerEntry = { id: string; type: 'buy' | 'sell'; quantity: string; price: string; fee: string };

export type LedgerResult = {
  quantity: Decimal;
  averageCost: Decimal; // includes buy fees
  realized: Map<string, Decimal>; // sell id → realized P&L
};

// Replays one symbol's ledger (already ordered by execution time) with the average-cost method.
// Returns the id of the first sell that exceeds the position, so the caller can reject it.
export const replayLedger = (entries: LedgerEntry[]): LedgerResult | { oversoldBy: string } => {
  let quantity = new Decimal(0);
  let cost = new Decimal(0);
  const realized = new Map<string, Decimal>();

  for (const e of entries) {
    const qty = new Decimal(e.quantity);
    const price = new Decimal(e.price);
    const fee = new Decimal(e.fee);
    if (e.type === 'buy') {
      quantity = quantity.plus(qty);
      cost = cost.plus(qty.times(price)).plus(fee);
      continue;
    }
    if (qty.greaterThan(quantity)) return { oversoldBy: e.id };
    const avg = cost.div(quantity);
    realized.set(e.id, qty.times(price.minus(avg)).minus(fee));
    cost = cost.minus(qty.times(avg));
    quantity = quantity.minus(qty);
  }

  return { quantity, averageCost: quantity.isZero() ? new Decimal(0) : cost.div(quantity), realized };
};
