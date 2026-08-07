export type TxType = 'buy' | 'sell' | 'dividend';

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

export interface LotDetail extends Transaction {
  lot_cost?: number;
  lot_value?: number;
  lot_pl?: number;
  lot_pl_pct?: number;
  realized_pl?: number;
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

export interface Snapshot {
  snap_date: string;
  total_value: number;
  total_cost: number;
}

export interface TxPayload {
  ticker: string;
  type: TxType;
  quantity: number;
  price: number;
  commission?: number;
  trade_date: string;
  note?: string | null;
}

const TOKEN_KEY = 'stocker.token';

/** In-memory copy so requests do not touch localStorage on every call. */
let token: string | null = localStorage.getItem(TOKEN_KEY);

export const getToken = () => token;

export function setToken(value: string | null) {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fired when the server rejects the stored token, so the app can re-prompt. */
export const onUnauthorized = new Set<() => void>();

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');

  const res = await fetch(`/api${path}`, { ...init, headers });

  if (res.status === 401) {
    setToken(null);
    onUnauthorized.forEach((fn) => fn());
    throw new ApiError(401, 'Invalid or missing token');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      typeof body === 'object' && body && 'error' in body ? String(body.error) : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export const api = {
  summary: () => request<Summary>('/summary'),
  positions: () => request<Position[]>('/positions'),
  position: (ticker: string) =>
    request<{ position: Position; transactions: LotDetail[] }>(`/positions/${encodeURIComponent(ticker)}`),
  transactions: (params: { ticker?: string; from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][],
    ).toString();
    return request<Transaction[]>(`/transactions${qs ? `?${qs}` : ''}`);
  },
  createTransaction: (payload: TxPayload) =>
    request<Transaction>('/transactions', { method: 'POST', body: JSON.stringify(payload) }),
  updateTransaction: (id: number, payload: TxPayload) =>
    request<Transaction>(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteTransaction: (id: number) => request<{ deleted: number }>(`/transactions/${id}`, { method: 'DELETE' }),
  refresh: () =>
    request<{ refreshed: string[]; failed: { ticker: string; error: string }[]; updated_at: string }>(
      '/refresh',
      { method: 'POST' },
    ),
  history: (days: number) => request<Snapshot[]>(`/history?days=${days}`),
  stocks: () => request<{ ticker: string; name: string | null; currency: string }[]>('/stocks'),
};
