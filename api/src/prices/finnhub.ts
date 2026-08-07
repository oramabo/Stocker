import type { PriceProvider, Quote, StockProfile } from './provider';

const BASE = 'https://finnhub.io/api/v1';

interface FinnhubQuote {
  c: number; // current
  d: number | null; // change
  dp: number | null; // change %
  h: number;
  l: number;
  o: number;
  pc: number; // previous close
  t: number;
}

interface FinnhubProfile {
  name?: string;
  currency?: string;
}

export class FinnhubProvider implements PriceProvider {
  readonly name = 'finnhub';

  constructor(private apiKey: string) {}

  async getQuote(ticker: string): Promise<Quote | null> {
    const res = await fetch(
      `${BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${this.apiKey}`,
      { headers: { accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`finnhub quote ${ticker}: HTTP ${res.status}`);
    const data = (await res.json()) as FinnhubQuote;
    // Unknown symbols come back as all-zero rather than as an error.
    if (!data || typeof data.c !== 'number' || data.c === 0) return null;
    return {
      ticker,
      price: data.c,
      prevClose: typeof data.pc === 'number' && data.pc !== 0 ? data.pc : null,
    };
  }

  async getProfile(ticker: string): Promise<StockProfile | null> {
    const res = await fetch(
      `${BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${this.apiKey}`,
      { headers: { accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as FinnhubProfile;
    if (!data || (!data.name && !data.currency)) return null;
    return { name: data.name ?? null, currency: data.currency ?? null };
  }
}
