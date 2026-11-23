import { createVerifiedSnapshot } from "../recovery";
import Database from "better-sqlite3";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION, runMigrations } from "./migrations";

let database: Database.Database | null = null;

export function initializeDatabase(userDataPath: string): Database.Database {
  if (database) return database;

  const connection = new Database(join(userDataPath, "warehouse.sqlite"));
  try {
    connection.pragma("foreign_keys = ON");
    runMigrations(connection, CURRENT_SCHEMA_VERSION, {
      beforeUpgrade: () => { createVerifiedSnapshot(connection, userDataPath, join(userDataPath, "backups")); },
    });
    connection.pragma("journal_mode = WAL");
    connection.pragma("busy_timeout = 5000");
    database = connection;
  } catch (error) {
    connection.close();
    throw error;
  }
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
