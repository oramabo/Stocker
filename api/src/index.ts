import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, LotDetail, Transaction, TxInput } from './types';
import {
  computePositions,
  ensureStock,
  getStock,
  getTransaction,
  latestPriceTime,
  listStocks,
  transactionsFor,
  allPrices,
} from './db';
import { buildLots, buildPosition, buildSummary, findOverSell, round } from './portfolio';
import { HttpError, parseDate, parseTxPayload, normalizeTicker } from './validation';
import { createProvider, refreshPrices, writeSnapshot, handleScheduled } from './prices/refresh';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({ origin: '*', allowHeaders: ['authorization', 'content-type'] }));

/* ------------------------------- auth ---------------------------------- */

/** Constant-time-ish compare so the token is not leaked by early exit. */
function tokenMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const expected = c.env.APP_TOKEN;
  if (!expected) return c.json({ error: 'server misconfigured: APP_TOKEN is not set' }, 500);

  const header = c.req.header('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // The iOS Shortcut can only set a header comfortably, but a query token keeps
  // widget-style GETs possible too.
  const token = bearer || c.req.query('token') || '';
  if (!token || !tokenMatches(token, expected)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error('unhandled error', err);
  return c.json({ error: 'internal error' }, 500);
});

/* ----------------------------- portfolio ------------------------------- */

app.get('/api/summary', async (c) => {
  const positions = await computePositions(c.env.DB);
  return c.json(buildSummary(positions, latestPriceTime(positions)));
});

app.get('/api/positions', async (c) => {
  const positions = await computePositions(c.env.DB);
  return c.json(positions);
});

app.get('/api/positions/:ticker', async (c) => {
  const ticker = normalizeTicker(c.req.param('ticker'));
  const [stock, txs, prices] = await Promise.all([
    getStock(c.env.DB, ticker),
    transactionsFor(c.env.DB, ticker),
    allPrices(c.env.DB),
  ]);
  if (!stock && txs.length === 0) return c.json({ error: `unknown ticker ${ticker}` }, 404);

  const price = prices.get(ticker) ?? null;
  const position = buildPosition(
    ticker,
    { name: stock?.name ?? null, currency: stock?.currency ?? 'USD' },
    txs as TxInput[],
    price,
  );
  const transactions: LotDetail[] = buildLots(txs, price?.price ?? null);
  return c.json({ position, transactions });
});

app.get('/api/stocks', async (c) => c.json(await listStocks(c.env.DB)));

/* ---------------------------- transactions ----------------------------- */

app.get('/api/transactions', async (c) => {
  const ticker = c.req.query('ticker') ? normalizeTicker(c.req.query('ticker')) : undefined;
  const from = parseDate(c.req.query('from'), 'from');
  const to = parseDate(c.req.query('to'), 'to');

  const where: string[] = [];
  const binds: unknown[] = [];
  if (ticker) {
    where.push('ticker = ?');
    binds.push(ticker);
  }
  if (from) {
    where.push('trade_date >= ?');
    binds.push(from);
  }
  if (to) {
    where.push('trade_date <= ?');
    binds.push(to);
  }
  const sql =
    'SELECT * FROM transactions' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY trade_date DESC, id DESC';

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<Transaction>();
  return c.json(results ?? []);
});

/**
 * Reject a write that would make the ticker's history over-sold at any point in
 * time — this catches back-dated inserts and edits, not just the newest row.
 */
async function assertSellable(
  db: D1Database,
  ticker: string,
  candidate: TxInput,
  replacingId?: number,
) {
  const existing = (await transactionsFor(db, ticker)).filter((t) => t.id !== replacingId);
  const conflict = findOverSell([...(existing as TxInput[]), candidate]);
  if (conflict) {
    throw new HttpError(
      422,
      `cannot sell ${round(conflict.tx.quantity, 8)} ${ticker} on ${conflict.tx.trade_date}: only ${conflict.held} share(s) held at that date`,
    );
  }
}

app.post('/api/transactions', async (c) => {
  const payload = parseTxPayload(await c.req.json().catch(() => null));

  const known = await getStock(c.env.DB, payload.ticker);
  if (!known) {
    const provider = createProvider(c.env);
    let meta: { name?: string | null; currency?: string | null } | undefined;
    if (provider?.getProfile) {
      try {
        const profile = await provider.getProfile(payload.ticker);
        if (profile) meta = { name: profile.name, currency: profile.currency };
      } catch {
        // Metadata is a nicety; never block recording a trade on it.
      }
    }
    await ensureStock(c.env.DB, payload.ticker, meta);
  }

  if (payload.type === 'sell') {
    await assertSellable(c.env.DB, payload.ticker, { id: Number.MAX_SAFE_INTEGER, ...payload });
  }

  const inserted = await c.env.DB.prepare(
    `INSERT INTO transactions (ticker, type, quantity, price, commission, trade_date, note)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      payload.ticker,
      payload.type,
      payload.quantity,
      payload.price,
      payload.commission,
      payload.trade_date,
      payload.note,
    )
    .first<Transaction>();

  return c.json(inserted, 201);
});

app.put('/api/transactions/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);

  const existing = await getTransaction(c.env.DB, id);
  if (!existing) return c.json({ error: `transaction ${id} not found` }, 404);

  const payload = parseTxPayload(await c.req.json().catch(() => null));
  await ensureStock(c.env.DB, payload.ticker);

  // Validate the ticker's post-edit history, plus the old ticker when moved.
  await assertSellable(c.env.DB, payload.ticker, { id, ...payload }, id);
  if (existing.ticker !== payload.ticker && existing.type === 'sell') {
    const remaining = (await transactionsFor(c.env.DB, existing.ticker)).filter((t) => t.id !== id);
    const conflict = findOverSell(remaining as TxInput[]);
    if (conflict) {
      throw new HttpError(
        422,
        `moving this transaction leaves ${existing.ticker} over-sold on ${conflict.tx.trade_date}`,
      );
    }
  }

  const updated = await c.env.DB.prepare(
    `UPDATE transactions
       SET ticker = ?, type = ?, quantity = ?, price = ?, commission = ?, trade_date = ?, note = ?
     WHERE id = ? RETURNING *`,
  )
    .bind(
      payload.ticker,
      payload.type,
      payload.quantity,
      payload.price,
      payload.commission,
      payload.trade_date,
      payload.note,
      id,
    )
    .first<Transaction>();

  return c.json(updated);
});

app.delete('/api/transactions/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);

  const existing = await getTransaction(c.env.DB, id);
  if (!existing) return c.json({ error: `transaction ${id} not found` }, 404);

  // Deleting a buy can leave later sells unsupported.
  if (existing.type === 'buy') {
    const remaining = (await transactionsFor(c.env.DB, existing.ticker)).filter((t) => t.id !== id);
    const conflict = findOverSell(remaining as TxInput[]);
    if (conflict) {
      throw new HttpError(
        422,
        `deleting this buy leaves ${existing.ticker} over-sold on ${conflict.tx.trade_date}`,
      );
    }
  }

  await c.env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
  return c.json({ deleted: id });
});

/* -------------------------------- prices -------------------------------- */

app.post('/api/refresh', async (c) => {
  const provider = createProvider(c.env);
  if (!provider) return c.json({ error: 'price provider not configured (FINNHUB_API_KEY)' }, 500);
  const result = await refreshPrices(c.env, provider);
  return c.json(result);
});

app.post('/api/snapshot', async (c) => c.json(await writeSnapshot(c.env)));

/* ------------------------------- history -------------------------------- */

app.get('/api/history', async (c) => {
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 90) || 90, 1), 3650);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const { results } = await c.env.DB.prepare(
    'SELECT snap_date, total_value, total_cost FROM snapshots WHERE snap_date >= ? ORDER BY snap_date ASC',
  )
    .bind(since)
    .all();
  return c.json(results ?? []);
});

/* ------------------------------ shortcut -------------------------------- */

const money = (n: number) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const signed = (n: number) => `${n < 0 ? '-' : '+'}${money(n)}`;
const pct = (n: number) => `${n < 0 ? '' : '+'}${n.toFixed(1)}%`;

app.get('/api/shortcut/summary', async (c) => {
  // Served entirely from cached prices — no live provider call, so this stays fast.
  const positions = await computePositions(c.env.DB);
  const s = buildSummary(positions, latestPriceTime(positions));
  const text =
    `Portfolio: ${money(s.total_value)} · ${signed(s.unrealized_pl)} (${pct(s.unrealized_pl_pct)}) · ` +
    `today ${signed(s.day_change)} (${pct(s.day_change_pct)})`;
  return c.text(text, 200, { 'cache-control': 'no-store' });
});

app.get('/api/health', (c) => c.json({ ok: true }));

/* ------------------------------- exports -------------------------------- */

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(handleScheduled(event, env));
  },
};

export { app };
