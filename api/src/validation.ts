import type { TxType } from './types';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface TxPayload {
  ticker: string;
  type: TxType;
  quantity: number;
  price: number;
  commission: number;
  trade_date: string;
  note: string | null;
}

const TICKER_RE = /^[A-Z0-9.\-:]{1,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeTicker(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'ticker is required');
  const ticker = raw.trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) throw new HttpError(400, `invalid ticker: ${raw}`);
  return ticker;
}

/** Today in UTC as 'YYYY-MM-DD'. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function num(value: unknown, field: string): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new HttpError(400, `${field} must be a number`);
  }
  if (n < 0) throw new HttpError(400, `${field} must be >= 0`);
  return n;
}

export function parseTxPayload(body: unknown): TxPayload {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'body must be a JSON object');
  const b = body as Record<string, unknown>;

  const ticker = normalizeTicker(b.ticker);

  const type = String(b.type ?? '').toLowerCase() as TxType;
  if (type !== 'buy' && type !== 'sell' && type !== 'dividend') {
    throw new HttpError(400, "type must be one of 'buy', 'sell', 'dividend'");
  }

  const quantity = num(b.quantity ?? 0, 'quantity');
  const price = num(b.price, 'price');
  const commission = num(b.commission ?? 0, 'commission');

  if (type !== 'dividend' && quantity <= 0) {
    throw new HttpError(400, 'quantity must be greater than 0');
  }

  const trade_date = typeof b.trade_date === 'string' && b.trade_date ? b.trade_date.trim() : today();
  if (!DATE_RE.test(trade_date) || Number.isNaN(Date.parse(trade_date))) {
    throw new HttpError(400, "trade_date must be an ISO date 'YYYY-MM-DD'");
  }
  if (trade_date > today()) throw new HttpError(400, 'trade_date must not be in the future');

  const note =
    typeof b.note === 'string' && b.note.trim() !== '' ? b.note.trim().slice(0, 500) : null;

  return { ticker, type, quantity, price, commission, trade_date, note };
}

export function parseDate(value: string | undefined, field: string): string | undefined {
  if (!value) return undefined;
  if (!DATE_RE.test(value)) throw new HttpError(400, `${field} must be an ISO date 'YYYY-MM-DD'`);
  return value;
}
