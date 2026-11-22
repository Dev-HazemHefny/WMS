import { snapshot } from "../recovery";
import Database from "better-sqlite3";
import { join } from "node:path";
import { runMigrations } from "./migrations";

let database: Database.Database | null = null;

export function initializeDatabase(userDataPath: string): Database.Database {
  if (database) return database;

  const connection = new Database(join(userDataPath, "warehouse.sqlite"));
  try {
    const history = connection
      .prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'")
      .get();
    const version = history
      ? Number(
          connection
            .prepare("SELECT MAX(version) FROM schema_migrations")
            .pluck()
            .get(),
        )
      : 0;
    if (version > 6) throw Error("Unsupported newer database");
    if (version && version < 6)
      snapshot(connection, userDataPath, join(userDataPath, "backups"));
    connection.pragma("foreign_keys = ON");
    connection.pragma("journal_mode = WAL");
    connection.pragma("busy_timeout = 5000");

    runMigrations(connection);
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
