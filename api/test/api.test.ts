import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/types';
import { createTestDb } from './helpers/d1';

const TOKEN = 'test-token-123';
let env: Env;

const auth = { authorization: `Bearer ${TOKEN}` };
const json = { ...auth, 'content-type': 'application/json' };

function req(path: string, init?: RequestInit) {
  return app.fetch(new Request(`https://example.com${path}`, init), env as never);
}

const post = (path: string, body: unknown, headers: Record<string, string> = json) =>
  req(path, { method: 'POST', headers, body: JSON.stringify(body) });

const today = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  env = { DB: createTestDb(), APP_TOKEN: TOKEN } as Env;
});

describe('auth', () => {
  const paths = [
    '/api/summary',
    '/api/positions',
    '/api/positions/AAPL',
    '/api/transactions',
    '/api/history',
    '/api/shortcut/summary',
  ];

  it.each(paths)('rejects %s without a token', async (path) => {
    const res = await req(path);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects a wrong token', async () => {
    const res = await req('/api/summary', { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('rejects mutations without a token', async () => {
    const res = await post('/api/transactions', { ticker: 'AAPL' }, { 'content-type': 'application/json' });
    expect(res.status).toBe(401);
  });

  it('accepts a valid token', async () => {
    expect((await req('/api/summary', { headers: auth })).status).toBe(200);
  });

  it('accepts the token as a query parameter for widget-style GETs', async () => {
    expect((await req(`/api/summary?token=${TOKEN}`)).status).toBe(200);
  });
});

describe('transactions CRUD', () => {
  it('creates a transaction and auto-registers the ticker', async () => {
    const res = await post('/api/transactions', {
      ticker: ' aapl ',
      type: 'buy',
      quantity: 10,
      price: 100,
      commission: 5,
      trade_date: '2024-01-01',
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as any;
    expect(row.ticker).toBe('AAPL');
    expect(row.id).toBeGreaterThan(0);

    const stocks = (await (await req('/api/stocks', { headers: auth })).json()) as any[];
    expect(stocks.map((s) => s.ticker)).toEqual(['AAPL']);
  });

  it('defaults the trade date to today', async () => {
    const res = await post('/api/transactions', {
      ticker: 'AAPL',
      type: 'buy',
      quantity: 1,
      price: 10,
    });
    expect(((await res.json()) as any).trade_date).toBe(today());
  });

  it('rejects a future trade date', async () => {
    const res = await post('/api/transactions', {
      ticker: 'AAPL',
      type: 'buy',
      quantity: 1,
      price: 10,
      trade_date: '2999-01-01',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toMatch(/future/);
  });

  it.each([
    ['negative quantity', { quantity: -1, price: 10 }],
    ['negative price', { quantity: 1, price: -5 }],
    ['zero quantity on a buy', { quantity: 0, price: 10 }],
    ['unknown type', { quantity: 1, price: 10, type: 'gift' }],
  ])('rejects %s with 400', async (_label, patch) => {
    const res = await post('/api/transactions', {
      ticker: 'AAPL',
      type: 'buy',
      trade_date: '2024-01-01',
      ...patch,
    });
    expect(res.status).toBe(400);
  });

  it('lists transactions newest first and filters by ticker and date', async () => {
    await post('/api/transactions', { ticker: 'AAPL', type: 'buy', quantity: 1, price: 10, trade_date: '2024-01-01' });
    await post('/api/transactions', { ticker: 'MSFT', type: 'buy', quantity: 1, price: 20, trade_date: '2024-02-01' });
    await post('/api/transactions', { ticker: 'AAPL', type: 'buy', quantity: 1, price: 30, trade_date: '2024-03-01' });

    const all = (await (await req('/api/transactions', { headers: auth })).json()) as any[];
    expect(all.map((t) => t.trade_date)).toEqual(['2024-03-01', '2024-02-01', '2024-01-01']);

    const aapl = (await (await req('/api/transactions?ticker=aapl', { headers: auth })).json()) as any[];
    expect(aapl).toHaveLength(2);

    const ranged = (await (
      await req('/api/transactions?from=2024-02-01&to=2024-02-28', { headers: auth })
    ).json()) as any[];
    expect(ranged).toHaveLength(1);
    expect(ranged[0].ticker).toBe('MSFT');
  });

  it('edits a transaction', async () => {
    const created = (await (
      await post('/api/transactions', { ticker: 'AAPL', type: 'buy', quantity: 10, price: 100, trade_date: '2024-01-01' })
    ).json()) as any;

    const res = await req(`/api/transactions/${created.id}`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({
        ticker: 'AAPL',
        type: 'buy',
        quantity: 20,
        price: 90,
        commission: 1,
        trade_date: '2024-01-02',
        note: 'topped up',
      }),
    });
    expect(res.status).toBe(200);
    const row = (await res.json()) as any;
    expect(row.quantity).toBe(20);
    expect(row.note).toBe('topped up');
  });

  it('deletes a transaction', async () => {
    const created = (await (
      await post('/api/transactions', { ticker: 'AAPL', type: 'buy', quantity: 10, price: 100, trade_date: '2024-01-01' })
    ).json()) as any;

    const res = await req(`/api/transactions/${created.id}`, { method: 'DELETE', headers: auth });
    expect(res.status).toBe(200);
    expect((await (await req('/api/transactions', { headers: auth })).json()) as any[]).toHaveLength(0);
  });

  it('404s on editing or deleting an unknown id', async () => {
    expect((await req('/api/transactions/999', { method: 'DELETE', headers: auth })).status).toBe(404);
    const put = await req('/api/transactions/999', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ ticker: 'AAPL', type: 'buy', quantity: 1, price: 1, trade_date: '2024-01-01' }),
    });
    expect(put.status).toBe(404);
  });
});

describe('over-sell protection', () => {
  beforeEach(async () => {
    await post('/api/transactions', { ticker: 'AAPL', type: 'buy', quantity: 10, price: 100, trade_date: '2024-01-01' });
  });

  it('rejects selling more shares than held with 422', async () => {
    const res = await post('/api/transactions', {
      ticker: 'AAPL',
      type: 'sell',
      quantity: 11,
      price: 120,
      trade_date: '2024-02-01',
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toMatch(/only 10 share/);
  });

  it('rejects a sell back-dated before its covering buy', async () => {
    const res = await post('/api/transactions', {
      ticker: 'AAPL',
      type: 'sell',
      quantity: 5,
      price: 120,
      trade_date: '2023-12-31',
    });
    expect(res.status).toBe(422);
  });

  it('rejects an edit that would over-sell', async () => {
    const sell = (await (
      await post('/api/transactions', { ticker: 'AAPL', type: 'sell', quantity: 5, price: 120, trade_date: '2024-02-01' })
    ).json()) as any;

    const res = await req(`/api/transactions/${sell.id}`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ ticker: 'AAPL', type: 'sell', quantity: 50, price: 120, trade_date: '2024-02-01' }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects deleting a buy that later sells depend on', async () => {
    const buys = (await (await req('/api/transactions?ticker=AAPL', { headers: auth })).json()) as any[];
    await post('/api/transactions', { ticker: 'AAPL', type: 'sell', quantity: 10, price: 120, trade_date: '2024-02-01' });

    const res = await req(`/api/transactions/${buys[0].id}`, { method: 'DELETE', headers: auth });
    expect(res.status).toBe(422);
  });

  it('allows selling exactly the held quantity', async () => {
    const res = await post('/api/transactions', {
      ticker: 'AAPL',
      type: 'sell',
      quantity: 10,
      price: 120,
      trade_date: '2024-02-01',
    });
    expect(res.status).toBe(201);
  });
});

describe('portfolio views', () => {
  beforeEach(async () => {
    await post('/api/transactions', {
      ticker: 'AAPL', type: 'buy', quantity: 10, price: 100, commission: 5, trade_date: '2024-01-01',
    });
    await post('/api/transactions', {
      ticker: 'AAPL', type: 'sell', quantity: 4, price: 120, commission: 5, trade_date: '2024-02-01',
    });
    env.DB.prepare(
      "INSERT INTO prices (ticker, price, prev_close, updated_at) VALUES ('AAPL', 130, 125, '2024-06-01T20:00:00Z')",
    ).run();
  });

  it('reports the acceptance-criteria position', async () => {
    const positions = (await (await req('/api/positions', { headers: auth })).json()) as any[];
    expect(positions).toHaveLength(1);
    const p = positions[0];
    expect(p.shares_held).toBe(6);
    expect(p.avg_cost).toBe(100.5);
    expect(p.realized_pl).toBe(73);
    expect(p.market_value).toBe(780);
    expect(p.unrealized_pl).toBe(177);
    expect(p.day_change).toBe(30);
  });

  it('summarises the portfolio', async () => {
    const s = (await (await req('/api/summary', { headers: auth })).json()) as any;
    expect(s.total_cost).toBe(603);
    expect(s.total_value).toBe(780);
    expect(s.unrealized_pl).toBe(177);
    expect(s.realized_pl).toBe(73);
    expect(s.day_change).toBe(30);
    expect(s.updated_at).toBe('2024-06-01T20:00:00Z');
  });

  it('returns a position with its per-lot P/L', async () => {
    const res = await req('/api/positions/aapl', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.position.shares_held).toBe(6);
    expect(body.transactions).toHaveLength(2);
    const buy = body.transactions.find((t: any) => t.type === 'buy');
    expect(buy.lot_cost).toBe(1005);
    expect(buy.lot_value).toBe(1300);
    expect(buy.lot_pl).toBe(295);
    const sell = body.transactions.find((t: any) => t.type === 'sell');
    expect(sell.realized_pl).toBe(73);
  });

  it('404s for an unknown ticker', async () => {
    expect((await req('/api/positions/ZZZZ', { headers: auth })).status).toBe(404);
  });

  it('serves a plain-text one-liner for the iOS Shortcut', async () => {
    const started = Date.now();
    const res = await req('/api/shortcut/summary', { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const text = await res.text();
    expect(text).toMatch(/^Portfolio: \$780 · \+\$177 \(\+29\.4%\) · today \+\$30 \(\+4\.0%\)$/);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('history', () => {
  it('returns snapshots within the requested window', async () => {
    const recent = new Date(Date.now() - 5 * 86400_000).toISOString().slice(0, 10);
    env.DB.prepare("INSERT INTO snapshots VALUES ('2000-01-01', 100, 90)").run();
    env.DB.prepare('INSERT INTO snapshots VALUES (?, 5000, 4000)').bind(recent).run();

    const rows = (await (await req('/api/history?days=30', { headers: auth })).json()) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].snap_date).toBe(recent);
  });
});
