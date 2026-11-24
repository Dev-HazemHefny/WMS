import { createIdentity } from "./identity";
import type { Credentials, NewOperator, OperatorStore } from "./ports";

const pendingHashes: Array<(error?: Error) => void> = [];
const password = "fixture-password";
const windowId = 42;
const fakeDigest = (value: string) => `fake:${value}`;
const afterHash = <T>(result: T) => new Promise<T>((resolve, reject) => {
  pendingHashes.push(error => error ? reject(error) : resolve(result));
});
const credentials: Credentials = {
  hashPassword: value => afterHash(fakeDigest(value)),
  prepareVerification: (value, digest) => afterHash(() => digest === fakeDigest(value)),
};

function fakeOperators() {
  const operators: NewOperator[] = [];
  const roles: Array<{ operator: string; role: string }> = [];
  const audit: Array<{ actor: string; action: string; target: string }> = [];
  const grants = new Map([
    ["admin", ["manage-users", "read", "warehouse"]],
    ["clerk", ["draft", "read", "warehouse.reparent"]],
    ["supervisor", ["post", "read", "warehouse"]],
  ]);
  function listPermissions(operator: string) {
    return [...new Set(roles.filter(row => row.operator === operator).flatMap(row => grants.get(row.role) ?? []))].sort();
  }
  const store: OperatorStore = {
    findByName: name => operators.find(operator => operator.name === name),
    hasOperators: () => operators.length > 0,
    hasPermission: (operator, action) => listPermissions(operator).includes(action),
    listPermissions,
    createFirstOperator(operator, role) {
      if (operators.length > 0) return false;
      operators.push(operator);
      roles.push({ operator: operator.id, role });
      return true;
    },
    createOperator(operator, assignedRoles, actor) {
      operators.push(operator);
      for (const role of assignedRoles) roles.push({ operator: operator.id, role });
      audit.push({ actor, action: "add-user", target: operator.id });
    },
  };
  return { store, grants, accountState: () => structuredClone({ operators, roles, audit }) };
}

let persistence: ReturnType<typeof fakeOperators>;
let identity: ReturnType<typeof createIdentity>;
const accountState = () => persistence.accountState();

function completeHash(index = 0, error?: Error) {
  const [complete] = pendingHashes.splice(index, 1);
  if (!complete) throw new Error("Expected a pending password hash");
  complete(error);
}

async function setup(window = windowId) {
  const login = identity.login(window, "admin", password, true);
  completeHash();
  await login;
  return identity.actor(window);
}

beforeEach(() => {
  pendingHashes.length = 0;
  let ids = 0;
  persistence = fakeOperators();
  identity = createIdentity(persistence.store, credentials, () => `operator-${++ids}`);
});

it("leaves first-admin setup empty when the login attempt is invalidated during hashing", async () => {
  const before = accountState();
  const pending = identity.login(windowId, "cancelled-admin", password, true);
  identity.end(windowId);
  completeHash();
  await expect(pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
  expect(accountState()).toEqual(before);
  expect(identity.needsAdmin()).toBe(true);
  expect(() => identity.actor(windowId)).toThrow(expect.objectContaining({ code: "AUTH_REQUIRED" }));
});

it("allows the newer setup to win even when the superseded hash finishes first", async () => {
  const older = identity.login(windowId, "older-admin", password, true);
  const newer = identity.login(windowId, "newer-admin", password, true);
  completeHash();
  await expect(older).rejects.toMatchObject({ code: "SESSION_CHANGED" });
  expect(accountState()).toEqual({ operators: [], roles: [], audit: [] });
  completeHash();
  await newer;
  const actor = identity.actor(windowId);
  expect(accountState()).toMatchObject({
    operators: [{ id: actor, name: "newer-admin" }],
    roles: [{ operator: actor, role: "admin" }],
    audit: [],
  });
});

it("preserves the first-admin constraint when current setup attempts come from different windows", async () => {
  const first = identity.login(windowId, "first-admin", password, true);
  const second = identity.login(windowId + 1, "second-admin", password, true);
  completeHash();
  await first;
  const before = accountState();
  completeHash();
  await expect(second).rejects.toMatchObject({ code: "SETUP_COMPLETE" });
  expect(accountState()).toEqual(before);
});

it("keeps the newer authenticated session after an older ordinary login finishes", async () => {
  const admin = await setup();
  const before = accountState();
  const older = identity.login(windowId, "admin", password, false);
  identity.end(windowId);
  const newer = identity.login(windowId, "admin", password, false);
  completeHash(1);
  await newer;
  completeHash();
  await expect(older).rejects.toMatchObject({ code: "SESSION_CHANGED" });
  expect(identity.actor(windowId)).toBe(admin);
  expect(accountState()).toEqual(before);
});

it("rejects an add-user operation after logout while its hash is pending", async () => {
  await setup();
  const before = accountState();
  const pending = identity.addOperator(windowId, "stale-user", password, ["clerk"]);
  identity.end(windowId);
  completeHash();
  await expect(pending).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(accountState()).toEqual(before);
});

it.each(["reauthenticate directly", "log out and reauthenticate"])("rejects a pending add-user when the same actor can %s", async transition => {
  const admin = await setup();
  const before = accountState();
  const pending = identity.addOperator(windowId, "stale-user", password, ["clerk"]);
  if (transition === "log out and reauthenticate") identity.end(windowId);
  const renewed = identity.login(windowId, "admin", password, false);
  completeHash(1);
  await renewed;
  completeHash();
  await expect(pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
  expect(identity.actor(windowId)).toBe(admin);
  expect(accountState()).toEqual(before);
});

it("checks the live manage-users grant before persisting after hashing", async () => {
  const admin = await setup();
  const before = accountState();
  const pending = identity.addOperator(windowId, "revoked-user", password, ["clerk"]);
  persistence.grants.set("admin", ["read", "warehouse"]);
  completeHash();
  await expect(pending).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(identity.actor(windowId)).toBe(admin);
  expect(accountState()).toEqual(before);
});

it("persists an uninterrupted add-user operation and accepts the stored digest on login", async () => {
  const admin = await setup();
  const pending = identity.addOperator(windowId, "operator", password, ["clerk", "supervisor", "clerk"]);
  completeHash();
  await pending;
  const login = identity.login(windowId, "operator", password, false);
  completeHash();
  await login;
  const operator = identity.actor(windowId);
  expect(accountState()).toEqual({
    operators: [{ id: admin, name: "admin", digest: fakeDigest(password) }, { id: operator, name: "operator", digest: fakeDigest(password) }],
    roles: [{ operator: admin, role: "admin" }, { operator, role: "clerk" }, { operator, role: "supervisor" }],
    audit: [{ actor: admin, action: "add-user", target: operator }],
  });
  expect(identity.capabilities(windowId)).toEqual({ authenticated: true, permissions: ["read", "warehouse", "warehouse.reparent"] });
  for (const action of ["draft", "post", "read"]) identity.authorize(operator, action);
  expect(() => identity.authorize(operator, "manage-users")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
});

it.each([["admin", "wrong-password"], ["missing", password]])("rejects invalid credentials for %s and ends the previous session", async (name, entered) => {
  await setup();
  const before = accountState();
  const pending = identity.login(windowId, name, entered, false);
  expect(identity.capabilities(windowId)).toEqual({ authenticated: false, permissions: [] });
  completeHash();
  await expect(pending).rejects.toMatchObject({ code: "INVALID_LOGIN" });
  expect(accountState()).toEqual(before);
});

it("rejects an operator creation without a live grant before hashing", async () => {
  await setup();
  const before = accountState();
  persistence.grants.set("admin", ["read"]);
  await expect(identity.addOperator(windowId, "blocked", password, ["clerk"])).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(pendingHashes).toHaveLength(0);
  expect(accountState()).toEqual(before);
});

it("propagates a hashing failure and permits a new setup attempt", async () => {
  const failure = new Error("hash failed");
  const pending = identity.login(windowId, "first", password, true);
  completeHash(0, failure);
  await expect(pending).rejects.toBe(failure);
  expect(identity.needsAdmin()).toBe(true);
  expect(identity.capabilities(windowId)).toEqual({ authenticated: false, permissions: [] });
  await setup();
  expect(identity.needsAdmin()).toBe(false);
});

it("propagates a persistence failure without discarding the caller's session", async () => {
  const admin = await setup();
  const before = accountState();
  const failure = new Error("write failed");
  jest.spyOn(persistence.store, "createOperator").mockImplementation(() => { throw failure; });
  const pending = identity.addOperator(windowId, "operator", password, ["clerk"]);
  completeHash();
  await expect(pending).rejects.toBe(failure);
  expect(identity.actor(windowId)).toBe(admin);
  expect(accountState()).toEqual(before);
});
