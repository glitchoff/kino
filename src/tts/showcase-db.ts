/**
 * SQLite store for the voice showcase.
 *
 * Uses `node:sqlite`, which ships with Node 22.5+ and needs no dependency. The
 * earlier version wrote two JSON files; that was fine until the screen grew a
 * delete UI and a render history, at which point "read the whole file, filter,
 * write it back" stops being honest. A take is a row.
 *
 * Schema is created on open and is idempotent, so an old database from a
 * previous run keeps working.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/**
 * Loads `node:sqlite` at runtime.
 *
 * A static import does not survive bundling: esbuild strips the `node:` scheme
 * and emits `from "sqlite"`, which is not a package, so the bundle dies at load
 * with ERR_MODULE_NOT_FOUND. Neither `external` nor an onResolve plugin kept the
 * prefix. A bare `require` also fails, because the ESM bundle rewrites it into a
 * shim that throws `Dynamic require of "node:sqlite" is not supported`. So the
 * module is loaded through `createRequire`, which works in both output formats,
 * and resolved lazily so it only runs when a showcase opens a database.
 */
function loadSqlite(): typeof import("node:sqlite") {
  const id = "node:" + "sqlite";
  const req = createRequire(import.meta.url);
  return req(id) as typeof import("node:sqlite");
}

export interface LineRow {
  id: number;
  text: string;
  at: string;
}

export interface PickRow {
  id: number;
  engine: string;
  voice: string;
  text: string;
  at: string;
}

export interface TakeRow {
  id: number;
  engine: string;
  voice: string;
  text: string;
  /** Milliseconds from request to first byte. Null while still rendering. */
  renderMs: number | null;
  /** Audio length in seconds, once known. */
  seconds: number | null;
  at: string;
}

export class ShowcaseDb {
  private readonly db: import("node:sqlite").DatabaseSync;

  constructor(dir: string) {
    const file = resolve(join(dir, "showcase.db"));
    mkdirSync(dirname(file), { recursive: true });
    this.db = new (loadSqlite().DatabaseSync)(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS lines (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL UNIQUE,
        at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS picks (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        engine TEXT NOT NULL,
        voice  TEXT NOT NULL,
        text   TEXT NOT NULL,
        at     TEXT NOT NULL,
        UNIQUE (engine, voice, text)
      );

      -- Every render, so a take's numbers survive a reload. Not a cache: the
      -- audio itself lives where the synthesiser put it.
      CREATE TABLE IF NOT EXISTS takes (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        engine    TEXT NOT NULL,
        voice     TEXT NOT NULL,
        text      TEXT NOT NULL,
        renderMs  INTEGER,
        seconds   REAL,
        at        TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS takes_lookup ON takes (engine, voice, text);
    `);
  }

  /** The file this database lives in, for reporting. */
  get path(): string {
    return this.db.location() ?? "";
  }

  // --- lines ------------------------------------------------------------

  lines(): LineRow[] {
    return this.db
      .prepare("SELECT id, text, at FROM lines ORDER BY id DESC LIMIT 200")
      .all() as unknown as LineRow[];
  }

  addLine(text: string): void {
    this.db
      .prepare("INSERT INTO lines (text, at) VALUES (?, ?) ON CONFLICT(text) DO UPDATE SET at = excluded.at")
      .run(text, new Date().toISOString());
  }

  deleteLine(id: number): void {
    this.db.prepare("DELETE FROM lines WHERE id = ?").run(id);
  }

  clearLines(): void {
    this.db.exec("DELETE FROM lines");
  }

  // --- picks ------------------------------------------------------------

  picks(): PickRow[] {
    return this.db
      .prepare("SELECT id, engine, voice, text, at FROM picks ORDER BY id DESC LIMIT 100")
      .all() as unknown as PickRow[];
  }

  /** Adds a pick, or removes it when it is already there. Returns the new list. */
  togglePick(engine: string, voice: string, text: string): PickRow[] {
    const existing = this.db
      .prepare("SELECT id FROM picks WHERE engine = ? AND voice = ? AND text = ?")
      .get(engine, voice, text) as { id?: number } | undefined;
    if (existing?.id !== undefined) {
      this.db.prepare("DELETE FROM picks WHERE id = ?").run(existing.id);
    } else {
      this.db
        .prepare("INSERT INTO picks (engine, voice, text, at) VALUES (?, ?, ?, ?)")
        .run(engine, voice, text, new Date().toISOString());
    }
    return this.picks();
  }

  deletePick(id: number): void {
    this.db.prepare("DELETE FROM picks WHERE id = ?").run(id);
  }

  clearPicks(): void {
    this.db.exec("DELETE FROM picks");
  }

  // --- takes ------------------------------------------------------------

  /**
   * Records a render. Returns the row id so the client can attach the measured
   * audio length afterwards â€” the length is only known once the browser has
   * decoded the file, which is after the server finished.
   */
  recordTake(engine: string, voice: string, text: string, renderMs: number): number {
    const res = this.db
      .prepare("INSERT INTO takes (engine, voice, text, renderMs, at) VALUES (?, ?, ?, ?, ?)")
      .run(engine, voice, text, renderMs, new Date().toISOString());
    return Number(res.lastInsertRowid);
  }

  setTakeSeconds(id: number, seconds: number): void {
    this.db.prepare("UPDATE takes SET seconds = ? WHERE id = ?").run(seconds, id);
  }

  /** The most recent take per voice for one line. */
  takesFor(engine: string, text: string): TakeRow[] {
    return this.db
      .prepare(
        `SELECT id, engine, voice, text, renderMs, seconds, at
           FROM takes
          WHERE engine = ? AND text = ?
          ORDER BY id DESC
          LIMIT 200`
      )
      .all(engine, text) as unknown as TakeRow[];
  }

  deleteTake(id: number): void {
    this.db.prepare("DELETE FROM takes WHERE id = ?").run(id);
  }

  clearTakes(): void {
    this.db.exec("DELETE FROM takes");
  }

  close(): void {
    this.db.close();
  }
}
