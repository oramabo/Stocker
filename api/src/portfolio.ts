import type { LotDetail, Position, PriceRow, Summary, Transaction, TxInput } from './types';

/** Share quantities below this are treated as a flat zero (float dust guard). */
const EPS = 1e-9;

/** Round to `dp` decimals without accumulating float noise in the output. */
export function round(value: number, dp = 6): number {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, dp);
  return Math.round((value + Number.EPSILON * Math.sign(value || 1)) * f) / f;
}

/**
 * Chronological order: by trade_date, then by id so that same-day transactions
 * are replayed in the order they were entered.
 */
export function sortTransactions<T extends { trade_date: string; id: number }>(txs: T[]): T[] {
  return [...txs].sort((a, b) =>
    a.trade_date === b.trade_date ? a.id - b.id : a.trade_date < b.trade_date ? -1 : 1,
  );
}

export interface ReplayState {
  shares: number;
  /** Total cost of the shares currently held (shares * avg_cost). */
  cost: number;
  avgCost: number;
  realized: number;
  dividends: number;
  /** Realised P/L booked by each sell, keyed by transaction id. */
  realizedByTx: Map<number, number>;
  /** avg_cost that was in force when each sell executed, keyed by transaction id. */
  avgCostAtSell: Map<number, number>;
}

/**
 * Replay a ticker's transactions using the average-cost method.
 *
 * - buy      : cost += qty*price + commission; shares += qty; avg = cost/shares
 * - sell     : realised += (price - avg)*qty - commission; shares -= qty;
 *              cost -= avg*qty  (avg cost per share is unchanged by a sell)
 * - dividend : dividends += price - commission (price holds the total amount)
 *
 * When the position is fully closed the basis resets, so a later re-buy starts
 * from a clean average cost.
 */
export function replay(txs: TxInput[]): ReplayState {
  const state: ReplayState = {
    shares: 0,
    cost: 0,
    avgCost: 0,
    realized: 0,
    dividends: 0,
    realizedByTx: new Map(),
    avgCostAtSell: new Map(),
  };

  for (const tx of sortTransactions(txs)) {
    if (tx.type === 'buy') {
      state.cost += tx.quantity * tx.price + tx.commission;
      state.shares += tx.quantity;
      state.avgCost = state.shares > EPS ? state.cost / state.shares : 0;
    } else if (tx.type === 'sell') {
      const avg = state.avgCost;
      const pl = (tx.price - avg) * tx.quantity - tx.commission;
      state.realized += pl;
      state.realizedByTx.set(tx.id, round(pl));
      state.avgCostAtSell.set(tx.id, round(avg));
      state.shares -= tx.quantity;
      state.cost -= avg * tx.quantity;
      if (state.shares <= EPS) {
        // Position closed (or over-sold, which validation rejects on write):
        // reset the basis so a re-buy is not polluted by float dust.
        state.shares = 0;
        state.cost = 0;
        state.avgCost = 0;
      }
    } else {
      state.dividends += tx.price - tx.commission;
    }
  }

  state.shares = round(state.shares, 8);
  state.cost = round(state.cost);
  state.avgCost = round(state.avgCost);
  state.realized = round(state.realized);
  state.dividends = round(state.dividends);
  return state;
}

/**
 * The first point in the replay where a sell would drive the held share count
 * negative, or null when the sequence is valid. Used to reject over-selling on
 * writes, including back-dated inserts and edits.
 */
export function findOverSell(txs: TxInput[]): { tx: TxInput; held: number } | null {
  let shares = 0;
  for (const tx of sortTransactions(txs)) {
    if (tx.type === 'buy') shares += tx.quantity;
    else if (tx.type === 'sell') {
      if (tx.quantity - shares > EPS) return { tx, held: round(shares, 8) };
      shares -= tx.quantity;
    }
  }
  return null;
}

export function buildPosition(
  ticker: string,
  meta: { name: string | null; currency: string },
  txs: TxInput[],
  price: PriceRow | null,
): Position {
  const s = replay(txs);
  const currentPrice = price?.price ?? null;
  const prevClose = price?.prev_close ?? null;

  const costBasis = round(s.shares * s.avgCost);
  const marketValue = currentPrice === null ? 0 : round(s.shares * currentPrice);
  // Without a live price we cannot state a gain — report zero rather than a
  // fabricated loss against a market value of 0.
  const unrealized = currentPrice === null ? 0 : round(marketValue - costBasis);
  const unrealizedPct = costBasis > EPS ? round((unrealized / costBasis) * 100, 4) : 0;
  const dayChange =
    currentPrice === null || prevClose === null ? 0 : round(s.shares * (currentPrice - prevClose));
  const prevValue = prevClose === null ? 0 : s.shares * prevClose;

  return {
    ticker,
    name: meta.name,
    currency: meta.currency,
    shares_held: s.shares,
    avg_cost: s.avgCost,
    cost_basis: costBasis,
    current_price: currentPrice,
    prev_close: prevClose,
    market_value: marketValue,
    unrealized_pl: unrealized,
    unrealized_pl_pct: unrealizedPct,
    realized_pl: s.realized,
    dividend_income: s.dividends,
    total_return: round(unrealized + s.realized + s.dividends),
    day_change: dayChange,
    day_change_pct: prevValue > EPS ? round((dayChange / prevValue) * 100, 4) : 0,
    price_updated_at: price?.updated_at ?? null,
  };
}

/** Per-transaction detail: buy lots marked to market, sells with realised P/L. */
export function buildLots(txs: Transaction[], currentPrice: number | null): LotDetail[] {
  const s = replay(txs);
  return sortTransactions(txs)
    .map<LotDetail>((tx) => {
      if (tx.type === 'buy') {
        const lotCost = round(tx.quantity * tx.price + tx.commission);
        const lotValue = currentPrice === null ? 0 : round(tx.quantity * currentPrice);
        const lotPl = currentPrice === null ? 0 : round(lotValue - lotCost);
        return {
          ...tx,
          lot_cost: lotCost,
          lot_value: lotValue,
          lot_pl: lotPl,
          lot_pl_pct: lotCost > EPS && currentPrice !== null ? round((lotPl / lotCost) * 100, 4) : 0,
        };
      }
      if (tx.type === 'sell') {
        return { ...tx, realized_pl: s.realizedByTx.get(tx.id) ?? 0 };
      }
      return { ...tx };
    })
    .reverse(); // newest first
}

export function buildSummary(positions: Position[], updatedAt: string | null): Summary {
  let totalValue = 0;
  let totalCost = 0;
  let realized = 0;
  let dividends = 0;
  let dayChange = 0;
  let prevValue = 0;

  for (const p of positions) {
    // A position with no quote yet is carried at cost, so a missing price reads
    // as "no gain known" rather than as a total loss.
    const value = p.current_price === null ? p.cost_basis : p.market_value;
    totalValue += value;
    totalCost += p.cost_basis;
    realized += p.realized_pl;
    dividends += p.dividend_income;
    dayChange += p.day_change;
    prevValue += p.prev_close !== null ? p.shares_held * p.prev_close : value;
  }

  const unrealized = round(totalValue - totalCost);
  return {
    total_value: round(totalValue),
    total_cost: round(totalCost),
    unrealized_pl: unrealized,
    unrealized_pl_pct: totalCost > EPS ? round((unrealized / totalCost) * 100, 4) : 0,
    realized_pl: round(realized),
    dividend_income: round(dividends),
    day_change: round(dayChange),
    day_change_pct: prevValue > EPS ? round((round(dayChange) / prevValue) * 100, 4) : 0,
    updated_at: updatedAt,
  };
}
