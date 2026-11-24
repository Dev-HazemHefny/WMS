import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createIdentity } from "../application/identity";
import type { Identity } from "../public";
import { nodeCredentials } from "./node-credentials";
import { createSqliteOperators } from "./sqlite-operators";

export function createSqliteIdentity(db: Database.Database): Identity {
  return createIdentity(createSqliteOperators(db), nodeCredentials, randomUUID);
}
