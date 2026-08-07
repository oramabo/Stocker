export function money(value: number, opts: { decimals?: number; sign?: boolean } = {}): string {
  const decimals = opts.decimals ?? 2;
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const prefix = opts.sign ? (value < 0 ? '−' : '+') : value < 0 ? '−' : '';
  return `${prefix}$${abs}`;
}

export function pct(value: number, opts: { sign?: boolean } = {}): string {
  const prefix = opts.sign !== false && value >= 0 ? '+' : value < 0 ? '−' : '';
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
}

export function shares(value: number): string {
  // Whole share counts read better without trailing zeros; fractions keep them.
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '');
}

/** Tailwind text colour for a P/L figure. */
export function plColor(value: number): string {
  if (value > 0) return 'text-up';
  if (value < 0) return 'text-down';
  return 'text-muted';
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return 'never';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
