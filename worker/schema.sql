-- Схема D1 для Gold Bandito
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT,
  balance REAL NOT NULL DEFAULT 1000,
  spins INTEGER NOT NULL DEFAULT 0,
  fs_remaining INTEGER NOT NULL DEFAULT 0,
  fs_multiplier REAL NOT NULL DEFAULT 1,
  fs_bet REAL NOT NULL DEFAULT 100,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  bet REAL NOT NULL,
  win REAL NOT NULL,
  multipliers TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spins_user ON spins(telegram_id, id DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  kind TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
