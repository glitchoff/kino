/**
 * Minimal types for `node:sqlite`.
 *
 * `@types/node` in this repo is v20, which predates `node:sqlite` (added in
 * 22.5). Upgrading it would ripple through every file that touches Node APIs,
 * for one module. So only the surface this project actually uses is declared
 * here, and it is the surface `ShowcaseDb` relies on.
 *
 * If `@types/node` is ever raised to 22+, delete this file and the import
 * resolves on its own.
 */
declare module "node:sqlite" {
  export interface StatementResultingChanges {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): StatementResultingChanges;
  }

  export class DatabaseSync {
    constructor(location: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
    location(): string | null;
  }
}
