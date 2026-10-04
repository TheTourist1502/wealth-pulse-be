import Decimal from 'decimal.js';

export type FlowPoint = { value: string; flow: string };

// Cumulative time-weighted return (as a fraction) at each point; the first point is the baseline (0).
// Daily r = (V_d − V_{d−1} − F_d) ÷ (V_{d−1} + F_d): money added isn't counted as performance.
export const timeWeightedReturns = (points: FlowPoint[]): Decimal[] => {
  let growth = new Decimal(1);
  return points.map((p, i) => {
    if (i === 0) return new Decimal(0);
    const prev = new Decimal(points[i - 1]!.value);
    const flow = new Decimal(p.flow);
    const base = prev.plus(flow);
    if (!base.isZero()) growth = growth.times(new Decimal(1).plus(new Decimal(p.value).minus(prev).minus(flow).div(base)));
    return growth.minus(1);
  });
};

// value ÷ base − 1 for each value (benchmarks, intraday series).
export const simpleReturns = (values: string[], base: string): Decimal[] =>
  values.map((v) => (new Decimal(base).isZero() ? new Decimal(0) : new Decimal(v).div(base).minus(1)));

// Fraction → percent string with 2 dp.
export const pct = (fraction: Decimal): string => fraction.times(100).toFixed(2);
