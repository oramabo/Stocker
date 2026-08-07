import { describe, expect, it } from 'vitest';
import { buildLots, buildPosition, buildSummary, findOverSell, replay } from '../src/portfolio';
import type { PriceRow, Transaction, TxInput } from '../src/types';

let nextId = 1;
function tx(
  type: TxInput['type'],
  quantity: number,
  price: number,
  opts: { commission?: number; date?: string; id?: number } = {},
): TxInput {
  return {
    id: opts.id ?? nextId++,
    type,
    quantity,
    price,
    commission: opts.commission ?? 0,
    trade_date: opts.date ?? '2024-01-01',
  };
}

const price = (p: number, prev: number | null = null): PriceRow => ({
  ticker: 'AAPL',
  price: p,
  prev_close: prev,
  updated_at: '2024-06-01T20:00:00.000Z',
});

const META = { name: 'Apple Inc', currency: 'USD' };

describe('average-cost replay', () => {
  it('meets the acceptance criterion: buy 10 @100 (+$5), sell 4 @120 (+$5)', () => {
    const s = replay([
      tx('buy', 10, 100, { commission: 5, date: '2024-01-01' }),
      tx('sell', 4, 120, { commission: 5, date: '2024-02-01' }),
    ]);
    expect(s.shares).toBe(6);
    expect(s.avgCost).toBe(100.5);
    expect(s.realized).toBe(73);
    expect(s.cost).toBe(603);
  });

  it('folds commissions into the cost basis of a buy', () => {
    const s = replay([tx('buy', 10, 100, { commission: 10 })]);
    expect(s.avgCost).toBe(101);
    expect(s.cost).toBe(1010);
  });

  it('averages across multiple buys at different prices', () => {
    const s = replay([
      tx('buy', 10, 100, { date: '2024-01-01' }),
      tx('buy', 10, 200, { date: '2024-02-01' }),
    ]);
    expect(s.shares).toBe(20);
    expect(s.avgCost).toBe(150);
    expect(s.cost).toBe(3000);
  });

  it('leaves the average cost per share untouched by a partial sell', () => {
    const s = replay([
      tx('buy', 10, 100, { commission: 5, date: '2024-01-01' }),
      tx('sell', 3, 500, { date: '2024-02-01' }),
      tx('sell', 2, 10, { date: '2024-03-01' }),
    ]);
    expect(s.avgCost).toBe(100.5);
    expect(s.shares).toBe(5);
    // (500-100.5)*3 + (10-100.5)*2
    expect(s.realized).toBe(1198.5 - 181);
  });

  it('resets the basis after selling out, so a re-buy starts clean', () => {
    const s = replay([
      tx('buy', 10, 100, { date: '2024-01-01' }),
      tx('sell', 10, 120, { date: '2024-02-01' }),
      tx('buy', 5, 50, { date: '2024-03-01' }),
    ]);
    expect(s.shares).toBe(5);
    expect(s.avgCost).toBe(50);
    expect(s.cost).toBe(250);
    expect(s.realized).toBe(200);
  });

  it('accumulates realised P/L across several round trips', () => {
    const s = replay([
      tx('buy', 10, 10, { date: '2024-01-01' }),
      tx('sell', 10, 20, { date: '2024-01-02' }),
      tx('buy', 10, 30, { date: '2024-01-03' }),
      tx('sell', 10, 25, { date: '2024-01-04' }),
    ]);
    expect(s.shares).toBe(0);
    expect(s.realized).toBe(100 - 50);
    expect(s.avgCost).toBe(0);
  });

  it('subtracts the sell commission from realised P/L', () => {
    const s = replay([
      tx('buy', 10, 100, { date: '2024-01-01' }),
      tx('sell', 10, 100, { commission: 7, date: '2024-02-01' }),
    ]);
    expect(s.realized).toBe(-7);
  });

  it('tracks dividends separately from cost and realised P/L', () => {
    const s = replay([
      tx('buy', 10, 100, { date: '2024-01-01' }),
      tx('dividend', 0, 23.5, { date: '2024-03-01' }),
      tx('dividend', 0, 25, { commission: 1, date: '2024-06-01' }),
    ]);
    expect(s.dividends).toBe(47.5);
    expect(s.avgCost).toBe(100);
    expect(s.cost).toBe(1000);
    expect(s.realized).toBe(0);
  });

  it('replays by trade_date, not by insertion order', () => {
    const later = tx('sell', 5, 120, { id: 1, date: '2024-05-01' });
    const earlier = tx('buy', 10, 100, { id: 2, date: '2024-01-01' });
    const s = replay([later, earlier]);
    expect(s.shares).toBe(5);
    expect(s.realized).toBe(100);
  });

  it('breaks same-day ties by id so a buy entered first funds the sell', () => {
    const s = replay([
      tx('buy', 10, 100, { id: 1, date: '2024-01-01' }),
      tx('sell', 10, 110, { id: 2, date: '2024-01-01' }),
    ]);
    expect(s.shares).toBe(0);
    expect(s.realized).toBe(100);
  });

  it('handles fractional shares without float drift', () => {
    const s = replay([
      tx('buy', 0.1, 100, { date: '2024-01-01' }),
      tx('buy', 0.2, 100, { date: '2024-01-02' }),
      tx('sell', 0.3, 100, { date: '2024-01-03' }),
    ]);
    expect(s.shares).toBe(0);
    expect(s.realized).toBe(0);
  });
});

describe('findOverSell', () => {
  it('accepts a sell covered by earlier buys', () => {
    expect(
      findOverSell([
        tx('buy', 10, 100, { date: '2024-01-01' }),
        tx('sell', 10, 110, { date: '2024-02-01' }),
      ]),
    ).toBeNull();
  });

  it('rejects selling more than is held', () => {
    const conflict = findOverSell([
      tx('buy', 10, 100, { date: '2024-01-01' }),
      tx('sell', 11, 110, { date: '2024-02-01' }),
    ]);
    expect(conflict).not.toBeNull();
    expect(conflict!.held).toBe(10);
  });

  it('rejects a sell back-dated before the buy that would cover it', () => {
    const conflict = findOverSell([
      tx('buy', 10, 100, { date: '2024-03-01' }),
      tx('sell', 5, 110, { date: '2024-01-01' }),
    ]);
    expect(conflict).not.toBeNull();
    expect(conflict!.held).toBe(0);
  });

  it('ignores dividends when checking share availability', () => {
    expect(
      findOverSell([
        tx('buy', 10, 100, { date: '2024-01-01' }),
        tx('dividend', 0, 20, { date: '2024-02-01' }),
        tx('sell', 10, 110, { date: '2024-03-01' }),
      ]),
    ).toBeNull();
  });
});

describe('buildPosition', () => {
  it('marks the position to market', () => {
    const p = buildPosition(
      'AAPL',
      META,
      [tx('buy', 10, 100, { commission: 5, date: '2024-01-01' })],
      price(110, 105),
    );
    expect(p.cost_basis).toBe(1005);
    expect(p.market_value).toBe(1100);
    expect(p.unrealized_pl).toBe(95);
    expect(p.unrealized_pl_pct).toBeCloseTo(9.4527, 3);
    expect(p.day_change).toBe(50);
    expect(p.day_change_pct).toBeCloseTo(4.7619, 3);
  });

  it('rolls unrealised, realised and dividends into total_return', () => {
    const p = buildPosition(
      'AAPL',
      META,
      [
        tx('buy', 10, 100, { date: '2024-01-01' }),
        tx('sell', 4, 120, { date: '2024-02-01' }),
        tx('dividend', 0, 15, { date: '2024-03-01' }),
      ],
      price(130),
    );
    expect(p.shares_held).toBe(6);
    expect(p.unrealized_pl).toBe(180); // 6 * (130-100)
    expect(p.realized_pl).toBe(80);
    expect(p.dividend_income).toBe(15);
    expect(p.total_return).toBe(275);
  });

  it('carries a position at cost when no quote is available', () => {
    const p = buildPosition('AAPL', META, [tx('buy', 10, 100, { date: '2024-01-01' })], null);
    expect(p.current_price).toBeNull();
    expect(p.unrealized_pl).toBe(0);
    expect(p.day_change).toBe(0);
  });

  it('reports a closed position with zero cost but intact realised P/L', () => {
    const p = buildPosition(
      'AAPL',
      META,
      [
        tx('buy', 10, 100, { date: '2024-01-01' }),
        tx('sell', 10, 150, { date: '2024-02-01' }),
      ],
      price(200),
    );
    expect(p.shares_held).toBe(0);
    expect(p.cost_basis).toBe(0);
    expect(p.market_value).toBe(0);
    expect(p.unrealized_pl).toBe(0);
    expect(p.unrealized_pl_pct).toBe(0);
    expect(p.realized_pl).toBe(500);
  });
});

describe('buildLots', () => {
  const rows = (list: TxInput[]): Transaction[] =>
    list.map((t) => ({ ...t, ticker: 'AAPL', note: null, created_at: '2024-01-01T00:00:00Z' }));

  it('prices each buy lot against the live price', () => {
    const lots = buildLots(
      rows([
        tx('buy', 10, 100, { commission: 5, id: 1, date: '2024-01-01' }),
        tx('buy', 5, 200, { id: 2, date: '2024-02-01' }),
      ]),
      150,
    );
    // newest first
    expect(lots[0].id).toBe(2);
    expect(lots[1].lot_cost).toBe(1005);
    expect(lots[1].lot_value).toBe(1500);
    expect(lots[1].lot_pl).toBe(495);
    expect(lots[1].lot_pl_pct).toBeCloseTo(49.2537, 3);
    expect(lots[0].lot_pl).toBe(-250);
  });

  it('attaches realised P/L to sells and leaves lot fields off', () => {
    const lots = buildLots(
      rows([
        tx('buy', 10, 100, { commission: 5, id: 1, date: '2024-01-01' }),
        tx('sell', 4, 120, { commission: 5, id: 2, date: '2024-02-01' }),
      ]),
      130,
    );
    const sell = lots.find((l) => l.type === 'sell')!;
    expect(sell.realized_pl).toBe(73);
    expect(sell.lot_cost).toBeUndefined();
  });
});

describe('buildSummary', () => {
  it('aggregates across positions', () => {
    const a = buildPosition('AAPL', META, [tx('buy', 10, 100, { date: '2024-01-01' })], price(110, 105));
    const b = buildPosition(
      'MSFT',
      { name: 'Microsoft', currency: 'USD' },
      [tx('buy', 5, 200, { date: '2024-01-01' }), tx('dividend', 0, 30, { date: '2024-02-01' })],
      { ticker: 'MSFT', price: 190, prev_close: 195, updated_at: '2024-06-01T20:00:00.000Z' },
    );
    const s = buildSummary([a, b], '2024-06-01T20:00:00.000Z');

    expect(s.total_cost).toBe(2000);
    expect(s.total_value).toBe(2050); // 1100 + 950
    expect(s.unrealized_pl).toBe(50);
    expect(s.unrealized_pl_pct).toBe(2.5);
    expect(s.dividend_income).toBe(30);
    expect(s.day_change).toBe(25); // +50 AAPL, -25 MSFT
    expect(s.updated_at).toBe('2024-06-01T20:00:00.000Z');
  });

  it('returns zeroed totals for an empty portfolio', () => {
    const s = buildSummary([], null);
    expect(s.total_value).toBe(0);
    expect(s.unrealized_pl_pct).toBe(0);
    expect(s.day_change_pct).toBe(0);
  });
});
