import Database from "better-sqlite3";
import { PATHS, ensureDataDirs } from "@/lib/paths";

/**
 * ⚠️ globalThis 캐싱 (7-17).
 * Next.js dev 의 HMR 은 모듈을 여러 번 평가합니다. 캐싱하지 않으면 SQLite 커넥션과
 * 파일 핸들이 계속 쌓입니다.
 */
const g = globalThis as unknown as { __blogDb?: Database.Database };

export function db(): Database.Database {
  if (g.__blogDb) return g.__blogDb;
  ensureDataDirs();
  const conn = new Database(PATHS.db);
  // ⚠️ SSE 폴링(읽기)과 파이프라인(쓰기)이 동시에 일어납니다. WAL 이 없으면 잠깁니다.
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  migrate(conn);
  g.__blogDb = conn;
  return conn;
}

/**
 * 스키마 생성 + 마이그레이션.
 * ⚠️ 기존 DB를 절대 날리지 않습니다. CREATE TABLE IF NOT EXISTS 로 만들고,
 *    컬럼 추가는 PRAGMA table_info 로 존재를 확인한 뒤 ALTER TABLE 합니다.
 */
function migrate(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      stage      TEXT,
      auto       INTEGER NOT NULL DEFAULT 1,
      mode       TEXT NOT NULL DEFAULT 'auto',
      inputs     TEXT,
      error      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sources (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      title      TEXT NOT NULL,
      summary    TEXT,
      url        TEXT,
      content    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      angle      TEXT,
      rationale  TEXT,
      chosen     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      idea_id    INTEGER,
      title      TEXT NOT NULL,
      body_json  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS images (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id         INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      draft_id       INTEGER,
      query          TEXT,
      src_url        TEXT,
      local_path     TEXT,
      source_site    TEXT,
      verdict_ok     INTEGER NOT NULL DEFAULT 0,
      verdict_reason TEXT,
      section_index  INTEGER,
      gen_prompt     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      draft_id     INTEGER,
      status       TEXT NOT NULL DEFAULT 'pending',
      blog_url     TEXT,
      screenshot   TEXT,
      note         TEXT,
      published_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      level      TEXT NOT NULL DEFAULT 'info',
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_logs_job    ON job_logs(job_id, id);
    CREATE INDEX IF NOT EXISTS idx_images_job  ON images(job_id);
    CREATE INDEX IF NOT EXISTS idx_posts_job   ON posts(job_id);
    CREATE INDEX IF NOT EXISTS idx_posts_pub   ON posts(status, published_at);
  `);

  // 나중에 컬럼이 늘어나면 여기에 addColumn 을 추가합니다(기존 DB 보존).
  addColumn(conn, "jobs", "mode", "TEXT NOT NULL DEFAULT 'auto'");
  addColumn(conn, "images", "gen_prompt", "TEXT");
}

function addColumn(conn: Database.Database, table: string, col: string, decl: string): void {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  }
}
