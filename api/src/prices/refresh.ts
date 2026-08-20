import { computePositions, ensureStock, tickersMissingName, upsertPrice } from '../db';
import { buildSummary } from '../portfolio';
import type { Env } from '../types';
import type { PriceProvider } from './provider';
import { FinnhubProvider } from './finnhub';

/** Free-tier limit is 60 calls/min; stay well inside it. */
const CALL_DELAY_MS = 1100;

export function createProvider(env: Env): PriceProvider | null {
  if (!env.FINNHUB_API_KEY) return null;
  return new FinnhubProvider(env.FINNHUB_API_KEY);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RefreshResult {
  refreshed: string[];
  failed: { ticker: string; error: string }[];
  updated_at: string;
}

/** Fetch and store quotes for every ticker currently held. */
export async function refreshPrices(env: Env, provider: PriceProvider): Promise<RefreshResult> {
  const positions = await computePositions(env.DB);
  const tickers = positions.filter((p) => p.shares_held > 0).map((p) => p.ticker);

  const refreshed: string[] = [];
  const failed: { ticker: string; error: string }[] = [];
  const updatedAt = new Date().toISOString();

  // Retry any display names the initial lookup never managed to resolve. Costs
  // one extra call per affected ticker, once, and then never again.
  const missingName = provider.getProfile ? await tickersMissingName(env.DB) : new Set<string>();

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    try {
      const quote = await provider.getQuote(ticker);
      if (!quote) {
        failed.push({ ticker, error: 'no quote returned' });
      } else {
        await upsertPrice(env.DB, ticker, quote.price, quote.prevClose, updatedAt);
        refreshed.push(ticker);
      }
    } catch (err) {
      failed.push({ ticker, error: err instanceof Error ? err.message : String(err) });
    }

    if (missingName.has(ticker) && provider.getProfile) {
      await sleep(CALL_DELAY_MS);
      try {
        const profile = await provider.getProfile(ticker);
        if (profile?.name) {
          await ensureStock(env.DB, ticker, { name: profile.name, currency: profile.currency });
        }
      } catch {
        // A display name is cosmetic; never fail a price refresh over one.
      }
    }

    if (i < tickers.length - 1) await sleep(CALL_DELAY_MS);
  }

  return { refreshed, failed, updated_at: updatedAt };
}

/** Write (or overwrite) today's row in `snapshots`. */
export async function writeSnapshot(env: Env, date = new Date().toISOString().slice(0, 10)) {
  const positions = await computePositions(env.DB);
  const summary = buildSummary(positions, null);
  await env.DB.prepare(
    `INSERT INTO snapshots (snap_date, total_value, total_cost) VALUES (?, ?, ?)
     ON CONFLICT(snap_date) DO UPDATE SET total_value = excluded.total_value,
                                          total_cost = excluded.total_cost`,
  )
    .bind(date, summary.total_value, summary.total_cost)
    .run();
  return { snap_date: date, total_value: summary.total_value, total_cost: summary.total_cost };
}

/**
 * Cron entrypoint: refresh quotes on every tick, and once the market has closed
 * (the 21:30 UTC tick) also record the daily snapshot.
 */
export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  const provider = createProvider(env);
  if (provider) {
    const result = await refreshPrices(env, provider);
    console.log(
      `[cron] refreshed ${result.refreshed.length} tickers` +
        (result.failed.length ? `, ${result.failed.length} failed` : ''),
    );
  } else {
    console.warn('[cron] FINNHUB_API_KEY not set — skipping price refresh');
  }

  const now = new Date(event.scheduledTime);
  const snapshotHour = Number(env.SNAPSHOT_HOUR_UTC ?? '21');
  if (now.getUTCHours() === snapshotHour && now.getUTCMinutes() >= 30) {
    const snap = await writeSnapshot(env, now.toISOString().slice(0, 10));
    console.log(`[cron] snapshot ${snap.snap_date}: ${snap.total_value}`);
  }
}
