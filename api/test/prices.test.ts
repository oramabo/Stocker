import { beforeEach, describe, expect, it } from 'vitest';
import { refreshPrices, writeSnapshot } from '../src/prices/refresh';
import type { PriceProvider, Quote } from '../src/prices/provider';
import type { Env } from '../src/types';
import { createTestDb } from './helpers/d1';

let env: Env;

function stubProvider(quotes: Record<string, Quote | null | Error>): PriceProvider {
  return {
    name: 'stub',
    async getQuote(ticker) {
      const q = quotes[ticker];
      if (q instanceof Error) throw q;
      return q ?? null;
    },
  };
}

function seed(ticker: string, type: 'buy' | 'sell', qty: number, price: number, date: string) {
  env.DB.prepare('INSERT OR IGNORE INTO stocks (ticker) VALUES (?)').bind(ticker).run();
  env.DB.prepare(
    'INSERT INTO transactions (ticker, type, quantity, price, commission, trade_date) VALUES (?, ?, ?, ?, 0, ?)',
  )
    .bind(ticker, type, qty, price, date)
    .run();
}

beforeEach(() => {
  env = { DB: createTestDb(), APP_TOKEN: 't' } as Env;
});

describe('refreshPrices', () => {
  it('stores the quote for a held ticker', async () => {
    seed('AAPL', 'buy', 10, 100, '2024-01-01');
    const result = await refreshPrices(
      env,
      stubProvider({ AAPL: { ticker: 'AAPL', price: 190.5, prevClose: 188 } }),
    );

    expect(result.refreshed).toEqual(['AAPL']);
    expect(result.failed).toEqual([]);
    const row = await env.DB.prepare('SELECT * FROM prices WHERE ticker = ?').bind('AAPL').first();
    expect(row).toMatchObject({ price: 190.5, prev_close: 188 });
  });

  it('skips tickers that are fully sold', async () => {
    seed('AAPL', 'buy', 10, 100, '2024-01-01');
    seed('AAPL', 'sell', 10, 120, '2024-02-01');
    const result = await refreshPrices(env, stubProvider({}));
    expect(result.refreshed).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('records a provider failure without aborting the run', async () => {
    seed('AAPL', 'buy', 10, 100, '2024-01-01');
    const result = await refreshPrices(env, stubProvider({ AAPL: new Error('rate limited') }));
    expect(result.refreshed).toEqual([]);
    expect(result.failed).toEqual([{ ticker: 'AAPL', error: 'rate limited' }]);
  });

  it('overwrites a previous quote', async () => {
    seed('AAPL', 'buy', 10, 100, '2024-01-01');
    await refreshPrices(env, stubProvider({ AAPL: { ticker: 'AAPL', price: 100, prevClose: 99 } }));
    await refreshPrices(env, stubProvider({ AAPL: { ticker: 'AAPL', price: 105, prevClose: 100 } }));

    const { results } = await env.DB.prepare('SELECT * FROM prices').all<{ price: number }>();
    expect(results).toHaveLength(1);
    expect(results[0].price).toBe(105);
  });
});

describe('writeSnapshot', () => {
  it('records the day’s value and cost, and is idempotent', async () => {
    seed('AAPL', 'buy', 10, 100, '2024-01-01');
    env.DB.prepare(
      "INSERT INTO prices (ticker, price, prev_close, updated_at) VALUES ('AAPL', 130, 125, '2024-06-01T20:00:00Z')",
    ).run();

    expect(await writeSnapshot(env, '2024-06-01')).toEqual({
      snap_date: '2024-06-01',
      total_value: 1300,
      total_cost: 1000,
    });

    seed('AAPL', 'buy', 10, 100, '2024-06-01');
    await writeSnapshot(env, '2024-06-01');

    const { results } = await env.DB.prepare('SELECT * FROM snapshots').all<{ total_cost: number }>();
    expect(results).toHaveLength(1);
    expect(results[0].total_cost).toBe(2000);
  });
});
