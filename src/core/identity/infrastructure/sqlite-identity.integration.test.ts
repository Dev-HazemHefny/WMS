import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../../../electron/main/database/migrations";
import { createSqliteIdentity } from "./create-sqlite-identity";

const password = "  existing-password  ";
const digest = "s1:0123456789abcdef0123456789abcdef:9e2677669beae3a7a74a5f3f6649d3de0dc70b8dc30863bf25530b166cd8fde9ca6054e508e77161c05457bb6662b5f451f4edefa1fe01ae9eb2750707a3de90";
let root: string;
let db: Database.Database;
let identity: ReturnType<typeof createSqliteIdentity>;

function open() {
  db = new Database(join(root, "identity.sqlite"));
  db.pragma("foreign_keys = ON");
  identity = createSqliteIdentity(db);
}

function rows() {
  return {
    operators: db.prepare("SELECT * FROM operators ORDER BY name").all(),
    roles: db.prepare("SELECT * FROM operator_roles ORDER BY rowid").all(),
    audit: db.prepare("SELECT actor, action, target FROM audit ORDER BY id").all(),
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wms-identity-"));
  open();
  runMigrations(db);
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

it("authenticates a reopened legacy account without rewriting its digest or normalizing its password", async () => {
  db.prepare("INSERT INTO operators VALUES(?,?,?)").run("legacy-id", "Legacy", digest);
  db.exec(`INSERT INTO operator_roles VALUES('legacy-id','clerk'),('legacy-id','supervisor');
    INSERT INTO permissions VALUES('clerk','warehouse.reparent'),('supervisor','warehouse');`);
  db.close();
  open();

  await expect(identity.login(1, "legacy", password.trim(), false)).rejects.toMatchObject({ code: "INVALID_LOGIN" });
  await identity.login(1, "legacy", password, false);
  expect(identity.actor(1)).toBe("legacy-id");
  expect(identity.capabilities(1)).toEqual({ authenticated: true, permissions: ["read", "warehouse", "warehouse.reparent"] });
  for (const action of ["read", "draft", "post", "reverse", "count"]) identity.authorize("legacy-id", action);
  expect(() => identity.authorize("legacy-id", "manage-users")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  expect(rows()).toMatchObject({ operators: [{ id: "legacy-id", digest }], audit: [] });
});

it("checks whether an attempt is current before comparing a malformed stored digest", async () => {
  db.prepare("INSERT INTO operators VALUES(?,?,?)").run("legacy-id", "Legacy", "s1:legacy:00");
  const stale = identity.login(1, "legacy", password, false);
  identity.end(1);
  await expect(stale).rejects.toMatchObject({ code: "SESSION_CHANGED" });
  await expect(identity.login(1, "legacy", password, false)).rejects.toMatchObject({ code: "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH" });
});

it("persists setup and an operator with deduplicated roles in insertion order and one audit row", async () => {
  await identity.login(1, "admin", password, true);
  const admin = identity.actor(1);
  await identity.addOperator(1, "operator", password, ["supervisor", "clerk", "supervisor"]);
  await identity.login(2, "operator", password, false);
  const operator = identity.actor(2);
  expect(rows()).toEqual({
    operators: [{ id: admin, name: "admin", digest: expect.stringMatching(/^s1:[0-9a-f]{32}:[0-9a-f]{128}$/) },
      { id: operator, name: "operator", digest: expect.stringMatching(/^s1:[0-9a-f]{32}:[0-9a-f]{128}$/) }],
    roles: [{ operator: admin, role: "admin" }, { operator, role: "supervisor" }, { operator, role: "clerk" }],
    audit: [{ actor: admin, action: "add-user", target: operator }],
  });
});

it("rolls back first-admin creation when the admin role insert violates its foreign key", async () => {
  db.exec("DELETE FROM permissions WHERE role='admin'; DELETE FROM roles WHERE id='admin'");
  await expect(identity.login(1, "admin", password, true)).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
  expect(identity.needsAdmin()).toBe(true);
  expect(rows()).toEqual({ operators: [], roles: [], audit: [] });
});

it("allows only one first administrator across windows", async () => {
  const results = await Promise.allSettled([
    identity.login(1, "first", password, true),
    identity.login(2, "second", password, true),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results).toContainEqual({ status: "rejected", reason: expect.objectContaining({ code: "SETUP_COMPLETE" }) });
  expect(rows().operators).toHaveLength(1);
  expect(rows().roles).toHaveLength(1);
  expect(rows().audit).toEqual([]);
});

it("rolls back operator creation when the final audit write aborts", async () => {
  await identity.login(1, "admin", password, true);
  const before = rows();
  db.exec(`CREATE TEMP TRIGGER fail_identity_audit AFTER INSERT ON audit WHEN NEW.action='add-user'
    BEGIN SELECT RAISE(ABORT,'injected audit failure'); END`);
  await expect(identity.addOperator(1, "operator", password, ["clerk", "supervisor"])).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_TRIGGER" });
  expect(rows()).toEqual(before);
});

it("preserves unique-name and role constraints without leaving partial writes", async () => {
  await identity.login(1, "admin", password, true);
  const before = rows();
  await expect(identity.addOperator(1, "ADMIN", password, ["clerk"])).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_UNIQUE" });
  await expect(identity.addOperator(1, "operator", password, ["clerk", "missing-role"])).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
  expect(rows()).toEqual(before);
});
