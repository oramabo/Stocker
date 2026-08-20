import type { Position, PriceRow, Transaction, TxInput } from './types';
import { buildPosition } from './portfolio';

export interface StockRow {
  ticker: string;
  name: string | null;
  currency: string;
  created_at: string;
}

export async function listStocks(db: D1Database): Promise<StockRow[]> {
  const { results } = await db
    .prepare('SELECT ticker, name, currency, created_at FROM stocks ORDER BY ticker')
    .all<StockRow>();
  return results ?? [];
}

export async function getStock(db: D1Database, ticker: string): Promise<StockRow | null> {
  return db
    .prepare('SELECT ticker, name, currency, created_at FROM stocks WHERE ticker = ?')
    .bind(ticker)
    .first<StockRow>();
}

export async function ensureStock(
  db: D1Database,
  ticker: string,
  meta?: { name?: string | null; currency?: string | null },
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO stocks (ticker, name, currency) VALUES (?, ?, ?)')
    .bind(ticker, meta?.name ?? null, meta?.currency || 'USD')
    .run();
  // Backfill metadata for rows created before the provider knew the name.
  if (meta?.name) {
    await db
      .prepare('UPDATE stocks SET name = ? WHERE ticker = ? AND (name IS NULL OR name = "")')
      .bind(meta.name, ticker)
      .run();
  }
}

/**
 * Tickers whose display name was never resolved. The name is only looked up the
 * first time a ticker is seen, so a provider that was rate-limited or down at
 * that moment would otherwise leave the row blank forever.
 */
export async function tickersMissingName(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare(`SELECT ticker FROM stocks WHERE name IS NULL OR name = ''`)
    .all<{ ticker: string }>();
  return new Set((results ?? []).map((r) => r.ticker));
}

export async function allTransactions(db: D1Database): Promise<Transaction[]> {
  const { results } = await db
    .prepare('SELECT * FROM transactions ORDER BY trade_date ASC, id ASC')
    .all<Transaction>();
  return results ?? [];
}

export async function transactionsFor(db: D1Database, ticker: string): Promise<Transaction[]> {
  const { results } = await db
    .prepare('SELECT * FROM transactions WHERE ticker = ? ORDER BY trade_date ASC, id ASC')
    .bind(ticker)
    .all<Transaction>();
  return results ?? [];
}

export async function getTransaction(db: D1Database, id: number): Promise<Transaction | null> {
  return db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<Transaction>();
}

export async function allPrices(db: D1Database): Promise<Map<string, PriceRow>> {
  const { results } = await db.prepare('SELECT * FROM prices').all<PriceRow>();
  return new Map((results ?? []).map((r) => [r.ticker, r]));
}

export function groupByTicker(txs: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();
  for (const tx of txs) {
    const list = map.get(tx.ticker);
    if (list) list.push(tx);
    else map.set(tx.ticker, [tx]);
  }
  return map;
}

/**
 * Every position derived from the transaction log. Tickers whose shares are
 * fully sold are kept only when they still carry realised P/L or dividends,
 * so closed trades remain visible in totals but not as holdings.
 */
export async function computePositions(db: D1Database): Promise<Position[]> {
  const [stocks, txs, prices] = await Promise.all([
    listStocks(db),
    allTransactions(db),
    allPrices(db),
  ]);
  const meta = new Map(stocks.map((s) => [s.ticker, s]));
  const grouped = groupByTicker(txs);

  const positions: Position[] = [];
  for (const [ticker, list] of grouped) {
    const stock = meta.get(ticker);
    positions.push(
      buildPosition(
        ticker,
        { name: stock?.name ?? null, currency: stock?.currency ?? 'USD' },
        list as TxInput[],
        prices.get(ticker) ?? null,
      ),
    );
  }

  positions.sort((a, b) => {
    if (a.shares_held > 0 !== b.shares_held > 0) return a.shares_held > 0 ? -1 : 1;
    if (b.market_value !== a.market_value) return b.market_value - a.market_value;
    return a.ticker < b.ticker ? -1 : 1;
  });
  return positions;
}

/** Newest price timestamp across the held tickers. */
export function latestPriceTime(positions: Position[]): string | null {
  let latest: string | null = null;
  for (const p of positions) {
    if (p.price_updated_at && (latest === null || p.price_updated_at > latest)) {
      latest = p.price_updated_at;
    }
  }
  return latest;
}

export async function upsertPrice(
  db: D1Database,
  ticker: string,
  price: number,
  prevClose: number | null,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO prices (ticker, price, prev_close, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(ticker) DO UPDATE SET price = excluded.price,
                                         prev_close = excluded.prev_close,
                                         updated_at = excluded.updated_at`,
    )
    .bind(ticker, price, prevClose, updatedAt)
    .run();
}
