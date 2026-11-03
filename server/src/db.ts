import Database from "better-sqlite3";

export type Reasoning = {
  id: number;
  fingerprint: string;
  task: string;
  context_url: string;
  result: string;
  seller_wallet: string;
  price_micro_usdc: number;
  reuse_count: number;
  created_at: string;
};

export function openDb(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reasonings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT UNIQUE NOT NULL,
      task TEXT NOT NULL,
      context_url TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL,
      seller_wallet TEXT NOT NULL,
      price_micro_usdc INTEGER NOT NULL,
      reuse_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL,
      kind TEXT NOT NULL,            -- 'miss' | 'hit' | 'sale'
      wallet TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS events_kind ON events(kind);
    CREATE TABLE IF NOT EXISTS purchases (
      tx_signature TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      buyer_wallet TEXT NOT NULL,
      seller_wallet TEXT NOT NULL,
      amount_micro_usdc INTEGER NOT NULL,
      fee_micro_usdc INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const stmts = {
    findByFp: db.prepare<[string], Reasoning>("SELECT * FROM reasonings WHERE fingerprint = ?"),
    insert: db.prepare(
      `INSERT INTO reasonings (fingerprint, task, context_url, result, seller_wallet, price_micro_usdc)
       VALUES (@fingerprint, @task, @context_url, @result, @seller_wallet, @price_micro_usdc)`
    ),
    bumpReuse: db.prepare("UPDATE reasonings SET reuse_count = reuse_count + 1 WHERE fingerprint = ?"),
    event: db.prepare("INSERT INTO events (fingerprint, kind, wallet) VALUES (?, ?, ?)"),
    purchase: db.prepare(
      `INSERT INTO purchases (tx_signature, fingerprint, buyer_wallet, seller_wallet, amount_micro_usdc, fee_micro_usdc)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),
    hasPurchase: db.prepare<[string], { n: number }>("SELECT count(*) AS n FROM purchases WHERE tx_signature = ?"),
    buyerOwns: db.prepare<[string, string], { n: number }>(
      "SELECT count(*) AS n FROM purchases WHERE fingerprint = ? AND buyer_wallet = ?"
    ),
    stats: db.prepare<[], Record<string, number>>(`
      SELECT
        (SELECT count(*) FROM reasonings) AS reasonings,
        (SELECT count(*) FROM events WHERE kind='miss') AS misses,
        (SELECT count(*) FROM events WHERE kind='hit') AS hits,
        (SELECT count(*) FROM purchases) AS sales,
        (SELECT coalesce(sum(amount_micro_usdc),0) FROM purchases) AS volume_micro_usdc,
        (SELECT coalesce(sum(fee_micro_usdc),0) FROM purchases) AS fees_micro_usdc
    `),
    topSellers: db.prepare<[], { seller_wallet: string; earned: number; sales: number }[]>(`
      SELECT seller_wallet, sum(amount_micro_usdc - fee_micro_usdc) AS earned, count(*) AS sales
      FROM purchases GROUP BY seller_wallet ORDER BY earned DESC LIMIT 10
    `),
  };

  return {
    raw: db,
    find(fp: string) {
      return stmts.findByFp.get(fp) ?? null;
    },
    insert(r: Omit<Reasoning, "id" | "reuse_count" | "created_at">) {
      stmts.insert.run(r);
    },
    logEvent(fp: string, kind: "miss" | "hit" | "sale", wallet = "") {
      stmts.event.run(fp, kind, wallet);
    },
    recordPurchase(sig: string, fp: string, buyer: string, seller: string, amount: number, fee: number) {
      stmts.purchase.run(sig, fp, buyer, seller, amount, fee);
      stmts.bumpReuse.run(fp);
      stmts.event.run(fp, "sale", buyer);
    },
    purchaseExists(sig: string) {
      return (stmts.hasPurchase.get(sig)?.n ?? 0) > 0;
    },
    buyerOwns(fp: string, buyer: string) {
      return (stmts.buyerOwns.get(fp, buyer)?.n ?? 0) > 0;
    },
    stats() {
      const s = stmts.stats.get()!;
      const lookups = s.hits + s.misses;
      return {
        ...s,
        lookups,
        duplicate_rate: lookups ? s.hits / lookups : 0,
        top_sellers: stmts.topSellers.all(),
      };
    },
  };
}

export type Db = ReturnType<typeof openDb>;
