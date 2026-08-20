import type { Position } from './api';

export type ViewMode = 'cards' | 'table';
export type SortDir = 'asc' | 'desc';
export type SortKey =
  | 'value'
  | 'day'
  | 'daycash'
  | 'pl'
  | 'plpct'
  | 'cost'
  | 'shares'
  | 'avg'
  | 'price'
  | 'ticker';
export type FilterKey = 'all' | 'gainers' | 'losers' | 'unpriced' | 'closed';

interface SortSpec {
  label: string;
  /** Natural direction when this column is first chosen. */
  dir: SortDir;
  get(p: Position): number | string;
}

export const SORTS: Record<SortKey, SortSpec> = {
  value: { label: 'Value', dir: 'desc', get: (p) => p.market_value },
  day: { label: 'Today %', dir: 'desc', get: (p) => p.day_change_pct },
  daycash: { label: 'Today $', dir: 'desc', get: (p) => p.day_change },
  pl: { label: 'P/L $', dir: 'desc', get: (p) => p.unrealized_pl },
  plpct: { label: 'P/L %', dir: 'desc', get: (p) => p.unrealized_pl_pct },
  cost: { label: 'Cost', dir: 'desc', get: (p) => p.cost_basis },
  shares: { label: 'Shares', dir: 'desc', get: (p) => p.shares_held },
  avg: { label: 'Avg cost', dir: 'desc', get: (p) => p.avg_cost },
  // Unpriced positions sort last rather than pretending to be worth nothing.
  price: { label: 'Last price', dir: 'desc', get: (p) => p.current_price ?? -1 },
  ticker: { label: 'Ticker', dir: 'asc', get: (p) => p.ticker },
};

export const SORT_KEYS = Object.keys(SORTS) as SortKey[];

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'gainers', label: 'Gainers' },
  { key: 'losers', label: 'Losers' },
  { key: 'unpriced', label: 'Unpriced' },
  { key: 'closed', label: 'Closed' },
];

function matchesFilter(p: Position, filter: FilterKey): boolean {
  const open = p.shares_held > 0;
  switch (filter) {
    case 'closed':
      return !open;
    case 'gainers':
      return open && p.unrealized_pl > 0;
    case 'losers':
      return open && p.unrealized_pl < 0;
    case 'unpriced':
      return open && p.current_price === null;
    default:
      return open;
  }
}

function matchesSearch(p: Position, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return p.ticker.toLowerCase().includes(q) || (p.name ?? '').toLowerCase().includes(q);
}

export function countFor(positions: Position[], filter: FilterKey): number {
  return positions.filter((p) => matchesFilter(p, filter)).length;
}

export function applyView(
  positions: Position[],
  opts: { search: string; filter: FilterKey; sort: SortKey; dir: SortDir },
): Position[] {
  const spec = SORTS[opts.sort];
  const mul = opts.dir === 'asc' ? 1 : -1;

  return positions
    .filter((p) => matchesFilter(p, opts.filter) && matchesSearch(p, opts.search))
    .sort((a, b) => {
      const av = spec.get(a);
      const bv = spec.get(b);
      const cmp =
        typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : av - bv;
      // Ticker breaks ties so the order never wobbles between renders.
      return cmp * mul || a.ticker.localeCompare(b.ticker);
    });
}

/* --------------------------- preference storage --------------------------- */

const PREFS_KEY = 'stocker:view';

export interface ViewPrefs {
  view: ViewMode;
  sort: SortKey;
  dir: SortDir;
}

export const DEFAULT_PREFS: ViewPrefs = { view: 'cards', sort: 'value', dir: 'desc' };

export function loadPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ViewPrefs>;
    return {
      view: parsed.view === 'table' ? 'table' : 'cards',
      sort: parsed.sort && parsed.sort in SORTS ? parsed.sort : DEFAULT_PREFS.sort,
      dir: parsed.dir === 'asc' ? 'asc' : 'desc',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: ViewPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or a full quota — preferences just don't persist.
  }
}
