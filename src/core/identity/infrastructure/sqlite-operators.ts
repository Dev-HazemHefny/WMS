import type Database from "better-sqlite3";
import type { NewOperator, OperatorCredentials, OperatorStore } from "../application/ports";

export function createSqliteOperators(db: Database.Database): OperatorStore {
  function hasOperators(): boolean {
    return Boolean(db.prepare("SELECT 1 FROM operators LIMIT 1").get());
  }

  function insertOperator({ id, name, digest }: NewOperator) {
    db.prepare("INSERT INTO operators VALUES(?,?,?)").run(id, name, digest);
  }

  return {
    hasOperators,
    findByName(name) {
      return db.prepare("SELECT id,digest FROM operators WHERE name=?")
        .get(name) as OperatorCredentials | undefined;
    },
    hasPermission(operator, action) {
      return Boolean(db.prepare(
        "SELECT 1 FROM operator_roles o JOIN permissions p ON p.role=o.role WHERE o.operator=? AND p.action=?",
      ).get(operator, action));
    },
    listPermissions(operator) {
      return db.prepare("SELECT DISTINCT p.action FROM operator_roles u JOIN permissions p ON p.role=u.role WHERE u.operator=? ORDER BY p.action")
        .pluck().all(operator) as string[];
    },
    createFirstOperator(operator, role) {
      return db.transaction(() => {
        if (hasOperators()) return false;
        insertOperator(operator);
        db.prepare("INSERT INTO operator_roles VALUES(?,?)").run(operator.id, role);
        return true;
      })();
    },
    createOperator(operator, roles, actor) {
      db.transaction(() => {
        insertOperator(operator);
        for (const role of roles)
          db.prepare("INSERT INTO operator_roles VALUES(?,?)").run(operator.id, role);
        db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,'add-user',?)").run(actor, operator.id);
      })();
    },
  };
}
