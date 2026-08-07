export type TxType = 'buy' | 'sell' | 'dividend';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  APP_TOKEN: string;
  FINNHUB_API_KEY?: string;
  SNAPSHOT_HOUR_UTC?: string;
}

export interface Transaction {
  id: number;
  ticker: string;
  type: TxType;
  quantity: number;
  price: number;
  commission: number;
  trade_date: string;
  note: string | null;
  created_at: string;
}

/** A transaction as it participates in the math — id/date/order only. */
export interface TxInput {
  id: number;
  type: TxType;
  quantity: number;
  price: number;
  commission: number;
  trade_date: string;
}

export interface PriceRow {
  ticker: string;
  price: number;
  prev_close: number | null;
  updated_at: string;
}

export interface Position {
  ticker: string;
  name: string | null;
  currency: string;
  shares_held: number;
  avg_cost: number;
  cost_basis: number;
  current_price: number | null;
  prev_close: number | null;
  market_value: number;
  unrealized_pl: number;
  unrealized_pl_pct: number;
  realized_pl: number;
  dividend_income: number;
  total_return: number;
  day_change: number;
  day_change_pct: number;
  price_updated_at: string | null;
}

export interface LotDetail extends Transaction {
  /** Present for buy transactions only. */
  lot_cost?: number;
  lot_value?: number;
  lot_pl?: number;
  lot_pl_pct?: number;
  /** Present for sell transactions only: realised P/L booked by this sell. */
  realized_pl?: number;
}

export interface Summary {
  total_value: number;
  total_cost: number;
  unrealized_pl: number;
  unrealized_pl_pct: number;
  realized_pl: number;
  dividend_income: number;
  day_change: number;
  day_change_pct: number;
  updated_at: string | null;
}
