import { AppError } from "../../shared/errors/app-error";
import { SESSION_PERMISSIONS, type SessionCapabilities, type SessionPermission } from "../../../shared/identity/types";
import type { Credentials, OperatorStore } from "./ports";

function sessionChanged(): AppError {
  return new AppError("انتهت الجلسة", "SESSION_CHANGED");
}

export function createIdentity(operators: OperatorStore, credentials: Credentials, newId: () => string) {
  const sessions = new Map<number, { actor: string }>();
  const attempts = new Map<number, symbol>();
  function end(window: number) {
    sessions.delete(window);
    attempts.delete(window);
  }
  function requireSession(window: number) {
    const session = sessions.get(window);
    if (!session) throw new AppError("تسجيل الدخول مطلوب", "AUTH_REQUIRED");
    return session;
  }
  function actor(window: number) {
    return requireSession(window).actor;
  }
  function guardSession(window: number) {
    const session = requireSession(window);
    return {
      actor: session.actor,
      revalidate() {
        if (requireSession(window) !== session) throw sessionChanged();
      },
    };
  }
  function authorize(user: string, action: string) {
    if (!operators.hasPermission(user, action))
      throw new AppError("الصلاحية غير متاحة", "FORBIDDEN");
  }
  function needsAdmin() {
    return !operators.hasOperators();
  }
  function capabilities(window: number): SessionCapabilities {
    const user = sessions.get(window)?.actor;
    if (!user) return { authenticated: false, permissions: [] };
    const actions = operators.listPermissions(user);
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
    const attempt = Symbol();
    attempts.set(window, attempt);
    const assertCurrentAttempt = () => {
      if (attempts.get(window) !== attempt) throw sessionChanged();
    };
    try {
      let id: string;
      if (setup) {
        const digest = await credentials.hashPassword(password);
        assertCurrentAttempt();
        id = newId();
        if (!operators.createFirstOperator({ id, name, digest }, "admin"))
          throw new AppError("الحساب موجود", "SETUP_COMPLETE");
      } else {
        const row = operators.findByName(name);
        const verify = await credentials.prepareVerification(password, row?.digest);
        assertCurrentAttempt();
        if (!row || !verify())
          throw new AppError("بيانات الدخول غير صحيحة", "INVALID_LOGIN");
        id = row.id;
      }
      sessions.set(window, { actor: id });
    } finally {
      if (attempts.get(window) === attempt) attempts.delete(window);
    }
  }
  async function addOperator(
    window: number,
    name: string,
    password: string,
    roles: string[],
  ) {
    const { actor: admin, revalidate } = guardSession(window);
    authorize(admin, "manage-users");
    const digest = await credentials.hashPassword(password);
    revalidate();
    authorize(admin, "manage-users");
    const id = newId();
    operators.createOperator({ id, name, digest }, [...new Set(roles)], admin);
  }
  return { actor, authorize, end, login, needsAdmin, addOperator, capabilities, guardSession };
}
export type Identity = ReturnType<typeof createIdentity>;
