import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayLedger, type LedgerEntry } from '@/utils/ledger';
import { isRegularHours, shiftDate } from '@/utils/marketTime';
import { pct, simpleReturns, timeWeightedReturns } from '@/utils/returns';

test('TWR ignores money added: doubling the position via a buy is not a return', () => {
  const r = timeWeightedReturns([
    { value: '100', flow: '0' },
    { value: '110', flow: '0' }, // +10%
    { value: '220', flow: '110' }, // bought 110 more, price flat
    { value: '242', flow: '0' }, // +10%
  ]);
  assert.deepEqual(r.map(pct), ['0.00', '10.00', '10.00', '21.00']);
});

test('TWR handles the first day of a portfolio (previous value 0)', () => {
  const r = timeWeightedReturns([
    { value: '0', flow: '0' },
    { value: '105', flow: '100' },
  ]);
  assert.equal(pct(r[1]!), '5.00');
});

test('simple returns against a base, zero base is safe', () => {
  assert.deepEqual(simpleReturns(['100', '110', '90'], '100').map(pct), ['0.00', '10.00', '-10.00']);
  assert.deepEqual(simpleReturns(['5'], '0').map(pct), ['0.00']);
});

const entry = (id: string, type: 'buy' | 'sell', quantity: string, price: string, fee = '0'): LedgerEntry => ({
  id,
  type,
  quantity,
  price,
  fee,
});

test('ledger: average cost includes buy fees; sells realize against it', () => {
  const result = replayLedger([
    entry('b1', 'buy', '10', '100', '10'), // cost 1010
    entry('b2', 'buy', '10', '120'), // cost 2210, avg 110.5
    entry('s1', 'sell', '5', '130', '2.5'), // 5 × (130 − 110.5) − 2.5 = 95
  ]);
  assert.ok(!('oversoldBy' in result));
  assert.equal(result.quantity.toString(), '15');
  assert.equal(result.averageCost.toFixed(2), '110.50');
  assert.equal(result.realized.get('s1')!.toFixed(2), '95.00');
});

test('ledger: rejects a sell larger than the position at that time', () => {
  const result = replayLedger([entry('s0', 'sell', '1', '10'), entry('b1', 'buy', '5', '10')]);
  assert.deepEqual(result, { oversoldBy: 's0' });
});

test('ledger: selling everything leaves zero quantity and zero average cost', () => {
  const result = replayLedger([entry('b1', 'buy', '3', '10'), entry('s1', 'sell', '3', '12')]);
  assert.ok(!('oversoldBy' in result));
  assert.ok(result.quantity.isZero());
  assert.ok(result.averageCost.isZero());
  assert.equal(result.realized.get('s1')!.toFixed(2), '6.00');
});

test('market time: regular hours in New York, across DST', () => {
  assert.equal(isRegularHours(new Date('2026-09-30T13:30:00Z')), true); // 09:30 EDT Wed
  assert.equal(isRegularHours(new Date('2026-09-30T20:00:00Z')), false); // 16:00 EDT
  assert.equal(isRegularHours(new Date('2026-12-02T14:30:00Z')), true); // 09:30 EST
  assert.equal(isRegularHours(new Date('2026-10-03T15:00:00Z')), false); // Saturday
  assert.equal(shiftDate('2026-03-31', { months: -1 }), '2026-02-28'); // clamped to month end
  assert.equal(shiftDate('2026-09-30', { months: -12 }), '2025-09-30');
  assert.equal(shiftDate('2026-09-30', { days: -7 }), '2026-09-23');
});
