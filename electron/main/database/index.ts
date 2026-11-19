import Database from "better-sqlite3";
import { join } from "node:path";
import { runMigrations } from "./migrations";

let database: Database.Database | null = null;

export function initializeDatabase(userDataPath: string): Database.Database {
  if (database) return database;

  database = new Database(join(userDataPath, "warehouse.sqlite"));
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");

  runMigrations(database);
  return database;
}

export function getDatabase(): Database.Database {
  if (!database) throw new Error("Database has not been initialized.");
  return database;
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}