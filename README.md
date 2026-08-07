# Stocker

A single-user, self-hosted stock portfolio tracker. You record every buy, sell and
dividend; Stocker computes positions, average cost basis and profit/loss against live
market prices. Mobile-first web UI, plus a plain-text endpoint for iOS Shortcuts and
Siri.

Runs entirely on Cloudflare's free tier: a Worker for the API, D1 for storage, a Cron
Trigger for price refreshes, and the built React app served as Worker assets.

---

## Stack

| Layer | Choice |
|---|---|
| API | Cloudflare Workers (TypeScript, [Hono](https://hono.dev)) |
| Database | Cloudflare D1 (SQLite) |
| Frontend | React + Vite + Tailwind, served from Worker Assets |
| Prices | [Finnhub](https://finnhub.io) free tier, behind a `PriceProvider` interface |
| Schedule | Cron Trigger, every 15 min during US market hours |
| Auth | One static bearer token (`APP_TOKEN`) |

```
/api        Worker — Hono app, position math, price provider, cron handler
/web        React frontend
/db         D1 migrations
wrangler.toml
```

---

## Quick start (local)

```bash
npm install
cp .dev.vars.example .dev.vars        # set APP_TOKEN (and FINNHUB_API_KEY if you have one)
npm run db:migrate:local              # create the schema in the local D1
npm run build                         # build the React app into web/dist
npm run dev:api                       # Worker + UI on http://localhost:8787
```

Open <http://localhost:8787>, enter the `APP_TOKEN` you put in `.dev.vars`, and you're in.

For frontend hot-reload, run `npm run dev:web` in a second terminal (Vite on :5173,
proxying `/api` to the Worker on :8787).

Run the test suite with `npm test` (position math, API routes, price refresh) and
`npm run typecheck` for both workspaces.

---

## Deploy

From a clean clone:

```bash
npm install

# 1. Create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create stocker

# 2. Apply the schema to the remote database
npm run db:migrate

# 3. Set the secrets
npx wrangler secret put APP_TOKEN         # any long random string — this is your password
npx wrangler secret put FINNHUB_API_KEY   # free key from finnhub.io/register

# 4. Build the UI and ship it
npm run deploy
```

`npm run deploy` builds `web/dist` and runs `wrangler deploy`, which uploads the Worker,
the static assets and the cron trigger together. The app is then live at
`https://stocker.<your-subdomain>.workers.dev`.

Generate a good token with:

```bash
openssl rand -base64 32
```

### Cron

`wrangler.toml` schedules `0,15,30,45 13-21 * * 1-5` (UTC) — every 15 minutes, Monday to
Friday, covering the 13:30–20:00 UTC US session plus the post-close run. Each tick
refreshes quotes for every ticker you currently hold; the 21:30 UTC tick also writes that
day's row into `snapshots`, which is what the History chart draws.

Only held tickers are fetched, one call at a time with a ~1.1 s gap, so a portfolio of any
realistic size stays inside Finnhub's 60 calls/minute free-tier limit.

---

## API

Every endpoint lives under `/api` and requires `Authorization: Bearer <APP_TOKEN>`.
Anything else gets a `401`. Errors come back as `{"error": "message"}` with a 400, 401,
404, 422 or 500 status.

| Method | Path | Description |
|---|---|---|
| GET | `/api/summary` | Portfolio totals |
| GET | `/api/positions` | All positions |
| GET | `/api/positions/:ticker` | One position plus its transactions with per-lot P/L |
| GET | `/api/transactions?ticker=&from=&to=` | Transactions, newest first |
| POST | `/api/transactions` | Create — `{ ticker, type, quantity, price, commission?, trade_date?, note? }` |
| PUT | `/api/transactions/:id` | Edit |
| DELETE | `/api/transactions/:id` | Delete |
| POST | `/api/refresh` | Fetch fresh quotes now |
| POST | `/api/snapshot` | Write today's snapshot now |
| GET | `/api/history?days=90` | Snapshots for the chart |
| GET | `/api/stocks` | Known tickers (autocomplete) |
| GET | `/api/shortcut/summary` | **Plain text** one-liner for iOS Shortcuts |

The token may also be passed as `?token=…` instead of a header, which makes widget-style
GET requests easier to wire up.

Example:

```bash
curl -X POST https://your-app.workers.dev/api/transactions \
  -H "Authorization: Bearer $APP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"ticker":"AAPL","type":"buy","quantity":10,"price":100,"commission":5,"trade_date":"2024-01-02"}'
```

---

## How the numbers work

Positions are derived from the transaction log on every read — nothing is cached or
denormalised, so editing a five-year-old trade instantly corrects everything downstream.

**Average cost**, not FIFO:

- A buy adds `qty × price + commission` to the cost of the holding.
- `avg_cost = total_cost / shares_held`.
- A sell books `(sell price − avg_cost) × qty − commission` as realised P/L, removes
  `avg_cost × qty` from the cost, and leaves the average cost per share unchanged.
- Selling out completely resets the basis, so a later re-buy starts clean.
- Dividends accumulate separately as `dividend_income` and never touch cost basis.
- `total_return = unrealized + realized + dividends`.

Per-transaction P/L on the stock detail screen marks each **buy lot** to market
(`qty × current_price − lot_cost`). It is informational only — sells still consume from
the average cost, not from specific lots.

Transactions are replayed in `trade_date` order, with ties broken by insertion order, so
back-dated entries land in the right place in history.

**Validation:** tickers are uppercased and trimmed (and auto-registered, with name and
currency pulled from the provider when available); dates cannot be in the future;
quantity, price and commission must be ≥ 0. A sell that would leave you short at any point
in time is rejected with `422` — including a back-dated sell, an edit that inflates a sell,
and deleting a buy that later sells depend on.

---

## iOS Shortcut integration

`/api/shortcut/summary` returns one line of plain text, served from cached prices with no
live provider call, so the Shortcut needs zero JSON parsing:

```
Portfolio: $42,310 · +$1,204 (+2.9%) · today +$168 (+0.4%)
```

### Shortcut 1 — "My Portfolio"

1. Open **Shortcuts → +** and name it **My Portfolio**.
2. Add **Get Contents of URL**.
   - URL: `https://your-app.workers.dev/api/shortcut/summary`
   - Method: `GET`
   - Headers: add `Authorization` = `Bearer YOUR_APP_TOKEN`
3. Add **Show Notification** (or **Show Result**) with the **Contents of URL** variable.
4. Tap the share icon → **Add to Home Screen** for a one-tap tile. The same Shortcut shows
   up on Apple Watch, and "Hey Siri, My Portfolio" reads it aloud.

### Shortcut 2 — "Log Buy"

1. New Shortcut named **Log Buy**.
2. **Ask for Input** → Text, prompt "Ticker" (call it `Ticker`).
3. **Ask for Input** → Number, prompt "Quantity" (`Qty`).
4. **Ask for Input** → Number, prompt "Price" (`Price`).
5. **Get Contents of URL**
   - URL: `https://your-app.workers.dev/api/transactions`
   - Method: `POST`
   - Headers: `Authorization` = `Bearer YOUR_APP_TOKEN`
   - Request Body: **JSON**, with fields
     - `ticker` (Text) → `Ticker`
     - `type` (Text) → `buy`
     - `quantity` (Number) → `Qty`
     - `price` (Number) → `Price`
6. **Show Notification** with the Contents of URL to confirm.

`trade_date` defaults to today when omitted, so the Shortcut does not have to ask for it.
Swap `buy` for `sell` to make a matching "Log Sell" — over-selling comes back as a readable
422 message.

---

## The web app

Dark, mobile-first, built for a 390 px viewport, with tabular monospace figures so numbers
do not jitter as prices tick.

- **Portfolio** — total value, unrealised P/L, day change, and a card per holding. Pull down to refresh prices.
- **Stock detail** — position summary and every transaction with its own lot P/L against the live price.
- **Add / Edit** — ticker autocomplete, buy/sell/dividend, commission, date, note.
- **History** — portfolio value chart from daily snapshots, 1M / 3M / 1Y / All.
- **Settings** — manual refresh, CSV export of all transactions, and token management.

The token is requested on first load and kept in `localStorage`. If the server ever rejects
it, the app clears it and prompts again. To rotate: `wrangler secret put APP_TOKEN`, then
"Forget token on this device" and sign back in.

---

## Swapping the price provider

Implement `PriceProvider` (`api/src/prices/provider.ts`) and return it from
`createProvider()` in `api/src/prices/refresh.ts`. Nothing else in the codebase knows about
Finnhub.

```ts
export interface PriceProvider {
  readonly name: string;
  getQuote(ticker: string): Promise<Quote | null>;
  getProfile?(ticker: string): Promise<StockProfile | null>;
}
```

---

## Not in this version

Multi-user accounts, broker sync, options and crypto, tax reporting, streaming prices,
multi-currency display, FIFO/specific-lot accounting, and benchmark comparison.
