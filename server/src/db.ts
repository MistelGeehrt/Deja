import { DatabaseSync } from "node:sqlite";

export type Reasoning = {
  id: number;
  fingerprint: string;
  task: string;
  context_url: string;
  doc_id: string | null;
  result: string;
  seller_wallet: string;
  price_micro_usdc: number;
  reuse_count: number;
  created_at: string;
};

export type Document = {
  id: string; // ex. idweb BOAMP "26-100275"
  source: string; // "boamp"
  url: string;
  title: string;
  buyer: string;
  published: string; // YYYY-MM-DD
  deadline: string; // ISO ou ''
  text: string;
  created_at: string;
};

export type EventKind = "view" | "ask" | "hit" | "miss" | "near_hit" | "paywall_click" | "sale" | "agent_call" | "payment_required" | "payment_ok" | "free_grant" | "agent_publish";

export function openDb(path: string) {
  const db = new DatabaseSync(path);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reasonings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT UNIQUE NOT NULL,
      task TEXT NOT NULL,
      context_url TEXT NOT NULL DEFAULT '',
      doc_id TEXT,
      result TEXT NOT NULL,
      seller_wallet TEXT NOT NULL,
      price_micro_usdc INTEGER NOT NULL,
      reuse_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS reasonings_doc ON reasonings(doc_id);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      buyer TEXT NOT NULL DEFAULT '',
      published TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS documents_published ON documents(published);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      wallet TEXT NOT NULL DEFAULT '',   -- wallet ou identifiant anonyme de visiteur
      doc_id TEXT,
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
    -- Journal anonymisé des questions, pour compter les quasi-doublons
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id TEXT,
      context_url TEXT NOT NULL DEFAULT '',
      task TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      embedding TEXT,                   -- JSON de nombres, ou NULL
      outcome TEXT NOT NULL,            -- 'hit' | 'miss' | 'near_hit' | 'owned'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS questions_doc ON questions(doc_id);
  `);
  // Migration douce pour les bases créées avant l'ajout de doc_id
  const cols = (db.prepare("PRAGMA table_info(reasonings)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("doc_id")) db.exec("ALTER TABLE reasonings ADD COLUMN doc_id TEXT");
  const ecols = (db.prepare("PRAGMA table_info(events)").all() as { name: string }[]).map((c) => c.name);
  if (!ecols.includes("doc_id")) db.exec("ALTER TABLE events ADD COLUMN doc_id TEXT");

  const s = {
    findByFp: db.prepare("SELECT * FROM reasonings WHERE fingerprint = ?"),
    byDoc: db.prepare("SELECT * FROM reasonings WHERE doc_id = ? ORDER BY id"),
    insert: db.prepare(
      `INSERT INTO reasonings (fingerprint, task, context_url, doc_id, result, seller_wallet, price_micro_usdc)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    bumpReuse: db.prepare("UPDATE reasonings SET reuse_count = reuse_count + 1 WHERE fingerprint = ?"),
    event: db.prepare("INSERT INTO events (fingerprint, kind, wallet, doc_id) VALUES (?, ?, ?, ?)"),
    purchase: db.prepare(
      `INSERT INTO purchases (tx_signature, fingerprint, buyer_wallet, seller_wallet, amount_micro_usdc, fee_micro_usdc)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),
    hasPurchase: db.prepare("SELECT count(*) AS n FROM purchases WHERE tx_signature = ?"),
    buyerOwns: db.prepare("SELECT count(*) AS n FROM purchases WHERE fingerprint = ? AND buyer_wallet = ?"),
    docGet: db.prepare("SELECT * FROM documents WHERE id = ?"),
    docHas: db.prepare("SELECT count(*) AS n FROM documents WHERE id = ?"),
    docInsert: db.prepare(
      `INSERT OR IGNORE INTO documents (id, source, url, title, buyer, published, deadline, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    docRecent: db.prepare("SELECT id, source, url, title, buyer, published, deadline FROM documents ORDER BY published DESC, id DESC LIMIT ?"),
    docSearch: db.prepare(
      "SELECT id, source, url, title, buyer, published, deadline FROM documents WHERE title LIKE ? OR buyer LIKE ? ORDER BY published DESC LIMIT 50"
    ),
    docAll: db.prepare("SELECT id, published FROM documents ORDER BY published DESC"),
    docUnseeded: db.prepare(
      `SELECT d.* FROM documents d WHERE (SELECT count(*) FROM reasonings r WHERE r.doc_id = d.id) < ? ORDER BY d.published DESC LIMIT ?`
    ),
    qInsert: db.prepare(
      "INSERT INTO questions (doc_id, context_url, task, fingerprint, embedding, outcome) VALUES (?, ?, ?, ?, ?, ?)"
    ),
    qByDoc: db.prepare("SELECT task, fingerprint, embedding FROM questions WHERE doc_id = ? AND embedding IS NOT NULL"),
    qEmbByFp: db.prepare("SELECT embedding FROM questions WHERE fingerprint = ? AND embedding IS NOT NULL LIMIT 1"),
    stats: db.prepare(`
      SELECT
        (SELECT count(*) FROM documents) AS documents,
        (SELECT count(*) FROM reasonings) AS reasonings,
        (SELECT count(*) FROM events WHERE kind='view') AS views,
        (SELECT count(DISTINCT wallet) FROM events WHERE kind='view') AS visitors,
        (SELECT count(*) FROM events WHERE kind='ask') AS asks,
        (SELECT count(*) FROM events WHERE kind='miss') AS misses,
        (SELECT count(*) FROM events WHERE kind='hit') AS hits,
        (SELECT count(*) FROM events WHERE kind='near_hit') AS near_hits,
        (SELECT count(*) FROM events WHERE kind='paywall_click') AS paywall_clicks,
        (SELECT count(*) FROM purchases WHERE tx_signature NOT LIKE 'free:%') AS sales,
        (SELECT coalesce(sum(amount_micro_usdc),0) FROM purchases WHERE tx_signature NOT LIKE 'free:%') AS volume_micro_usdc,
        (SELECT coalesce(sum(fee_micro_usdc),0) FROM purchases) AS fees_micro_usdc
    `),
    statsByDay: db.prepare(`
      SELECT substr(created_at,1,10) AS day,
        sum(kind='view') AS views, sum(kind='ask') AS asks, sum(kind='hit') AS hits,
        sum(kind='miss') AS misses, sum(kind='near_hit') AS near_hits, sum(kind='paywall_click') AS paywall_clicks
      FROM events GROUP BY day ORDER BY day DESC LIMIT 60
    `),
    topSellers: db.prepare(`
      SELECT seller_wallet, sum(amount_micro_usdc - fee_micro_usdc) AS earned, count(*) AS sales
      FROM purchases GROUP BY seller_wallet ORDER BY earned DESC LIMIT 10
    `),
    recentQuestions: db.prepare("SELECT doc_id, task, outcome, created_at FROM questions WHERE outcome != 'owned' ORDER BY id DESC LIMIT 50"),
    agentStats: db.prepare(`
      SELECT
        (SELECT count(DISTINCT wallet) FROM events WHERE kind='agent_call') AS agents,
        (SELECT count(*) FROM events WHERE kind='agent_call') AS agent_calls,
        (SELECT count(*) FROM (SELECT wallet FROM events WHERE kind='agent_call' GROUP BY wallet HAVING count(DISTINCT substr(created_at,1,10)) >= 2)) AS returning_agents,
        (SELECT count(*) FROM events WHERE kind='payment_required') AS payment_required,
        (SELECT count(*) FROM events WHERE kind='payment_ok') AS payment_ok,
        (SELECT count(*) FROM events WHERE kind='free_grant') AS free_grants,
        (SELECT count(*) FROM events WHERE kind='agent_publish') AS agent_publishes
    `),
    agentsByWeek: db.prepare(`
      SELECT strftime('%Y-W%W', created_at) AS week, count(DISTINCT wallet) AS agents, count(*) AS calls,
        sum(kind='payment_required') AS required, sum(kind='payment_ok') AS paid
      FROM events WHERE kind IN ('agent_call','payment_required','payment_ok') GROUP BY week ORDER BY week DESC LIMIT 12
    `),
    freeUsed: db.prepare("SELECT count(*) AS n FROM events WHERE kind='free_grant' AND wallet = ? AND substr(created_at,1,10) = date('now')"),
  };

  const num = (v: unknown) => Number(v ?? 0);
  const nums = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? v : num(v)]));

  return {
    raw: db,
    find(fp: string): Reasoning | null {
      return (s.findByFp.get(fp) as Reasoning | undefined) ?? null;
    },
    byDoc(docId: string): Reasoning[] {
      return s.byDoc.all(docId) as Reasoning[];
    },
    insert(r: Omit<Reasoning, "id" | "reuse_count" | "created_at">) {
      s.insert.run(r.fingerprint, r.task, r.context_url, r.doc_id, r.result, r.seller_wallet, r.price_micro_usdc);
    },
    logEvent(kind: EventKind, opts: { fingerprint?: string; wallet?: string; docId?: string | null } = {}) {
      s.event.run(opts.fingerprint ?? "", kind, opts.wallet ?? "", opts.docId ?? null);
    },
    recordPurchase(sig: string, fp: string, buyer: string, seller: string, amount: number, fee: number, docId: string | null) {
      s.purchase.run(sig, fp, buyer, seller, amount, fee);
      s.bumpReuse.run(fp);
      s.event.run(fp, "sale", buyer, docId);
    },
    purchaseExists(sig: string) {
      return num((s.hasPurchase.get(sig) as { n: unknown }).n) > 0;
    },
    buyerOwns(fp: string, buyer: string) {
      return num((s.buyerOwns.get(fp, buyer) as { n: unknown }).n) > 0;
    },
    // Documents
    docGet(id: string): Document | null {
      return (s.docGet.get(id) as Document | undefined) ?? null;
    },
    docHas(id: string) {
      return num((s.docHas.get(id) as { n: unknown }).n) > 0;
    },
    docInsert(d: Omit<Document, "created_at">) {
      s.docInsert.run(d.id, d.source, d.url, d.title, d.buyer, d.published, d.deadline, d.text);
    },
    docRecent(limit = 50) {
      return s.docRecent.all(limit) as Omit<Document, "text" | "created_at">[];
    },
    docSearch(q: string) {
      const like = `%${q}%`;
      return s.docSearch.all(like, like) as Omit<Document, "text" | "created_at">[];
    },
    docAll() {
      return s.docAll.all() as { id: string; published: string }[];
    },
    docUnseeded(minReasonings: number, limit: number): Document[] {
      return s.docUnseeded.all(minReasonings, limit) as Document[];
    },
    // Questions
    logQuestion(q: { docId: string | null; url: string; task: string; fingerprint: string; embedding: number[] | null; outcome: string }) {
      s.qInsert.run(q.docId, q.url, q.task, q.fingerprint, q.embedding ? JSON.stringify(q.embedding) : null, q.outcome);
    },
    questionsByDoc(docId: string) {
      return (s.qByDoc.all(docId) as { task: string; fingerprint: string; embedding: string }[]).map((q) => ({
        ...q,
        embedding: JSON.parse(q.embedding) as number[],
      }));
    },
    embeddingByFp(fp: string): number[] | null {
      const r = s.qEmbByFp.get(fp) as { embedding: string } | undefined;
      return r ? (JSON.parse(r.embedding) as number[]) : null;
    },
    freeUsedToday(agent: string) {
      return num((s.freeUsed.get(agent) as { n: unknown }).n);
    },
    agentStats() {
      const a = nums(s.agentStats.get() as Record<string, unknown>) as {
        agents: number; agent_calls: number; returning_agents: number; payment_required: number; payment_ok: number; free_grants: number; agent_publishes: number;
      };
      return {
        ...a,
        return_rate: a.agents ? a.returning_agents / a.agents : 0,
        pay_rate: a.payment_required ? a.payment_ok / a.payment_required : 0,
        by_week: (s.agentsByWeek.all() as Record<string, unknown>[]).map(nums),
      };
    },
    stats() {
      const st = nums(s.stats.get() as Record<string, unknown>) as {
        documents: number; reasonings: number; views: number; visitors: number; asks: number; misses: number;
        hits: number; near_hits: number; paywall_clicks: number; sales: number; volume_micro_usdc: number; fees_micro_usdc: number;
      };
      const lookups = st.hits + st.misses;
      const quotes = st.hits; // un hit = un devis montré (hors propriétaire)
      return {
        ...st,
        lookups,
        duplicate_rate: lookups ? st.hits / lookups : 0,
        near_duplicate_rate: lookups ? (st.hits + st.near_hits) / lookups : 0,
        paywall_click_rate: quotes ? st.paywall_clicks / quotes : 0,
        by_day: (s.statsByDay.all() as Record<string, unknown>[]).map(nums),
        top_sellers: (s.topSellers.all() as Record<string, unknown>[]).map(nums),
        recent_questions: s.recentQuestions.all() as { doc_id: string | null; task: string; outcome: string; created_at: string }[],
        agents: this.agentStats(),
      };
    },
  };
}

export type Db = ReturnType<typeof openDb>;
