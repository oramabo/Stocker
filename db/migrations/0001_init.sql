-- Migration 0001: initial schema

CREATE TABLE IF NOT EXISTS stocks (
  ticker      TEXT PRIMARY KEY,          -- e.g. 'AAPL'
  name        TEXT,
  currency    TEXT NOT NULL DEFAULT 'USD',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker      TEXT NOT NULL REFERENCES stocks(ticker),
  type        TEXT NOT NULL CHECK (type IN ('buy','sell','dividend')),
  quantity    REAL NOT NULL,             -- shares; for dividend: 0 allowed
  price       REAL NOT NULL,             -- per-share price; for dividend: total amount received
  commission  REAL NOT NULL DEFAULT 0,
  trade_date  TEXT NOT NULL,             -- ISO date 'YYYY-MM-DD'
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prices (
  ticker      TEXT PRIMARY KEY REFERENCES stocks(ticker),
  price       REAL NOT NULL,
  prev_close  REAL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (   -- daily portfolio value history
  snap_date   TEXT PRIMARY KEY,          -- 'YYYY-MM-DD'
  total_value REAL NOT NULL,
  total_cost  REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_ticker_date ON transactions(ticker, trade_date);
