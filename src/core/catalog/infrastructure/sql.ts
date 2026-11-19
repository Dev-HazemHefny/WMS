import type Database from "better-sqlite3";
import { DomainError } from "../domain/errors";

export function rethrowDb(error: unknown): never {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code.startsWith("SQLITE_CONSTRAINT")) {
    throw new DomainError("CONSTRAINT", "لا يمكن حفظ البيانات لأنها تتعارض مع بيانات موجودة أو مرتبطة");
  }
  throw error;
}

export function likeTerm(search?: string): string | null {
  const term = search?.trim();
  if (!term) return null;
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function pageClause(page: number, pageSize: number): { limit: number; offset: number } {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

export type SqlDatabase = Database.Database;

export function readCount(db: SqlDatabase, sql: string, params: unknown[] = []): number {
  const row = db.prepare(sql).get(...params) as { total: number };
  return row.total;
}
