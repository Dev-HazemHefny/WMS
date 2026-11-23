import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import { AppError } from "../../shared/errors/app-error";
import { SESSION_PERMISSIONS, type SessionCapabilities, type SessionPermission } from "../../../shared/identity/types";
const derive = promisify(scrypt);
export function createIdentity(db: Database.Database) {
  const sessions = new Map<number, string>();
  const generations = new Map<number, number>();
  function end(window: number) {
    sessions.delete(window);
    generations.set(window, (generations.get(window) ?? 0) + 1);
  }
  function actor(window: number) {
    const value = sessions.get(window);
    if (!value) throw new AppError("تسجيل الدخول مطلوب", "AUTH_REQUIRED");
    return value;
  }
  function authorize(user: string, action: string) {
    if (
      !db
        .prepare(
          "SELECT 1 FROM operator_roles o JOIN permissions p ON p.role=o.role WHERE o.operator=? AND p.action=?",
        )
        .get(user, action)
    )
      throw new AppError("الصلاحية غير متاحة", "FORBIDDEN");
  }
  function needsAdmin() {
    return !db.prepare("SELECT 1 FROM operators LIMIT 1").get();
  }
  function capabilities(window: number): SessionCapabilities {
    const user = sessions.get(window);
    if (!user) return { authenticated: false, permissions: [] };
    const actions = db.prepare("SELECT DISTINCT p.action FROM operator_roles u JOIN permissions p ON p.role=u.role WHERE u.operator=? ORDER BY p.action")
      .pluck().all(user) as string[];
    const permissions = actions.filter((action): action is SessionPermission => SESSION_PERMISSIONS.some(allowed => allowed === action));
    return { authenticated: true, permissions };
  }
  async function login(
    window: number,
    name: string,
    password: string,
    setup: boolean,
  ) {
    end(window);
    const generation = generations.get(window);
    let id: string;
    if (setup) {
      const salt = randomBytes(16).toString("hex");
      const hash = (await derive(password, salt, 64)) as Buffer;
      id = randomUUID();
      db.transaction(() => {
        if (!needsAdmin()) throw new AppError("الحساب موجود", "SETUP_COMPLETE");
        db.prepare("INSERT INTO operators VALUES(?,?,?)").run(
          id,
          name,
          "s1:" + salt + ":" + hash.toString("hex"),
        );
        db.prepare("INSERT INTO operator_roles VALUES(?,'admin')").run(id);
      })();
    } else {
      const row = db
        .prepare("SELECT id,digest FROM operators WHERE name=?")
        .get(name) as { id: string; digest: string } | undefined;
      const [, salt, expected] = (row?.digest ?? "s1:invalid:").split(":");
      const hash = (await derive(password, salt, 64)) as Buffer;
      if (!row || !timingSafeEqual(hash, Buffer.from(expected, "hex")))
        throw new AppError("بيانات الدخول غير صحيحة", "INVALID_LOGIN");
      id = row.id;
    }
    if (generation !== generations.get(window))
      throw new AppError("انتهت الجلسة", "SESSION_CHANGED");
    sessions.set(window, id);
  }
  async function addOperator(
    window: number,
    name: string,
    password: string,
    roles: string[],
  ) {
    const admin = actor(window);
    authorize(admin, "manage-users");
    const salt = randomBytes(16).toString("hex"),
      hash = (await derive(password, salt, 64)) as Buffer;
    if (actor(window) !== admin)
      throw new AppError("انتهت الجلسة", "SESSION_CHANGED");
    authorize(admin, "manage-users");
    const id = randomUUID();
    db.transaction(() => {
      db.prepare("INSERT INTO operators VALUES(?,?,?)").run(
        id,
        name,
        "s1:" + salt + ":" + hash.toString("hex"),
      );
      for (const role of new Set(roles))
        db.prepare("INSERT INTO operator_roles VALUES(?,?)").run(id, role);
      db.prepare(
        "INSERT INTO audit(actor,action,target) VALUES(?,'add-user',?)",
      ).run(admin, id);
    })();
  }
  return { actor, authorize, end, login, needsAdmin, addOperator, capabilities };
}
export type Identity = ReturnType<typeof createIdentity>;
