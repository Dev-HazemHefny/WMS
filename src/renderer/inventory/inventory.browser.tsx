import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ProductLookup, Unit, VariantListItem } from "../../shared/catalog/types";
import type { SessionCapabilities } from "../../shared/identity/types";
import type { InventoryHistoryRequest, InventoryHistoryResult, StockBalanceRequest } from "../../shared/inventory/types";
import { ClientError } from "../../shared/ipc/client-error";
import type { InventoryQueryApi, WarehouseApi } from "../../shared/ipc/contracts";
import type { StockCommand, StockResult } from "../../shared/ipc/stock";
import type { ResolvedLocationDto, StorageLocationDto, WarehouseDto } from "../../shared/warehouses/types";
import { App } from "../app";
import { Session } from "../session";
import "../styles.css";

const simple = "p:one", variant = "v:one", empty = "p:empty";
const exact = "9223372036854775.807";
const cursor = "9223372036854775806";
const defaults = { status: "active", createdAt: "", updatedAt: "", version: 1 } as const;
const products: ProductLookup[] = [
  { id: "one", name: "Simple part", sku: "BASE-001", productType: "simple", status: "active", baseUnitId: "kg" },
  { id: "empty", name: "Zero part", sku: "ZERO", productType: "simple", status: "active", baseUnitId: "kg" },
  { id: "parent", name: "Family", sku: "PARENT", productType: "with_variants", status: "active", baseUnitId: "kg" },
];
const variants: VariantListItem[] = [{
  id: "one", productId: "parent", productName: "Family", name: "Small", sku: "VAR-001",
  attributeSummary: "", status: "inactive", baseUnitName: "قطعة",
}];
const units: Unit[] = [
  { ...defaults, id: "kg", name: "كيلوغرام", symbol: "kg", dimension: "mass", description: null },
  { ...defaults, id: "pc", name: "قطعة", symbol: "pc", dimension: "count", description: null },
];
const sites: WarehouseDto[] = [
  { ...defaults, id: "a", code: "A", name: "Central warehouse", branchId: "b", address: null, description: null },
  { ...defaults, id: "z", code: "Z", name: "West warehouse", branchId: "b", address: null, description: null },
];
const locations: StorageLocationDto[] = [
  { ...defaults, id: "east", warehouseId: "a", code: "EAST", name: "East bin", isStockable: true, isDefault: false, parentId: null, locationType: "bin" },
  { ...defaults, id: "old", warehouseId: "a", code: "OLD", name: "Old bin", isStockable: true, isDefault: false, parentId: null, locationType: "bin", status: "inactive" },
  { ...defaults, id: "west", warehouseId: "z", code: "WEST", name: "West bin", isStockable: true, isDefault: false, parentId: null, locationType: "bin" },
];

function fixture() {
  let account = "";
  const calls = {
    balance: [] as StockBalanceRequest[], available: [] as StockBalanceRequest[],
    item: [] as string[], warehouse: [] as string[], history: [] as InventoryHistoryRequest[],
    consistency: [] as StockBalanceRequest[], execute: 0, directory: 0, locations: [] as string[], logout: 0,
  };
  const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100 });
  const inventory: InventoryQueryApi & Pick<WarehouseApi["inventory"], "execute"> = {
    async getStockBalance(request) {
      calls.balance.push(request);
      return { ...request, warehouseId: "a", baseUnitId: "kg", onHand: request.locationId === "east" ? exact : null };
    },
    async getAvailableQuantity(request) {
      calls.available.push(request);
      return { ...request, warehouseId: "a", baseUnitId: "kg", onHand: exact, available: exact };
    },
    async getStockItemStock({ itemId }) {
      calls.item.push(itemId);
      if (itemId === empty) return { itemId, baseUnitId: "kg", onHand: "0.000", balances: [] };
      if (itemId === simple) return { itemId, baseUnitId: "kg", onHand: exact, balances: [
        { itemId, warehouseId: "a", locationId: "east", onHand: exact },
      ] };
      if (itemId === variant) return { itemId, baseUnitId: "pc", onHand: "4.375", balances: [
        { itemId, warehouseId: "z", locationId: "west", onHand: "3.125" },
        { itemId, warehouseId: "a", locationId: "old", onHand: "1.250" },
      ] };
      throw new ClientError("STOCK_ITEM_NOT_FOUND", "صنف المخزون غير موجود");
    },
    async getWarehouseStock({ warehouseId }) {
      calls.warehouse.push(warehouseId);
      return { warehouseId, items: warehouseId === "z" ? [] : [
        { itemId: variant, onHand: "1.250", balances: [
          { itemId: variant, locationId: "old", warehouseId, onHand: "1.250" },
        ] },
        { itemId: simple, onHand: exact, balances: [
          { itemId: simple, locationId: "east", warehouseId, onHand: exact },
          { itemId: simple, locationId: "old", warehouseId, onHand: "0.000" },
        ] },
      ] };
    },
    async getInventoryHistory(request) {
      calls.history.push(request);
      return { movements: [], nextBeforeMovementId: null };
    },
    async verifyBalanceConsistency(request) {
      calls.consistency.push(request);
      return { ...request, warehouseId: "a", baseUnitId: "kg", discrepancies: request.locationId === "east" ? [] : [
        { onHand: null, ledger: "-1.375" },
      ] };
    },
    async execute(_command: StockCommand): Promise<StockResult> { calls.execute++; return { rows: [] }; },
  };
  const identity = {
    async setupRequired() { return false; },
    async getCapabilities(): Promise<SessionCapabilities> {
      return { authenticated: Boolean(account), permissions: account && account !== "denied" ? ["read"] : [] };
    },
    async login({ name }) { account = name; },
    async logout() { calls.logout++; account = ""; },
  } satisfies Pick<WarehouseApi["identity"], "getCapabilities" | "setupRequired" | "login" | "logout">;
  const system = {
    async getAppInfo() { return { appName: "WMS", databaseReady: true }; },
  } satisfies WarehouseApi["system"];
  const catalog = {
    products: {
      async lookup() { calls.directory++; return products; },
      async list() { return page([]); },
    } satisfies Pick<WarehouseApi["catalog"]["products"], "lookup" | "list">,
    variants: { async list() { return page(variants); } } satisfies Pick<WarehouseApi["catalog"]["variants"], "list">,
    units: { async lookup() { return units; } } satisfies Pick<WarehouseApi["catalog"]["units"], "lookup">,
    categories: { async lookup() { return []; } } satisfies Pick<WarehouseApi["catalog"]["categories"], "lookup">,
    brands: { async lookup() { return []; } } satisfies Pick<WarehouseApi["catalog"]["brands"], "lookup">,
  };
  const warehouses = {
    warehouses: { async list() { return page(sites); } } satisfies Pick<WarehouseApi["warehouses"]["warehouses"], "list">,
    locations: {
      async list({ warehouseId }) {
        calls.locations.push(warehouseId);
        return page(locations.filter(place => place.warehouseId === warehouseId));
      },
      async stockable(): Promise<ResolvedLocationDto[]> { return []; },
      async get(_request: { id: string }): Promise<ResolvedLocationDto> { throw new Error("Unknown fixture location"); },
    } satisfies Pick<WarehouseApi["warehouses"]["locations"], "list" | "stockable" | "get">,
  };
  return { api: { inventory, identity, system, catalog, warehouses }, calls, endSession: () => { account = ""; } };
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function until(condition: () => unknown, message: string) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}\n${document.body.innerText.slice(0, 900)}`);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

const contains = (text: string) => (document.querySelector(".page-content")?.textContent ?? "").includes(text);
const see = (text: string) => until(() => contains(text), text);
const heading = (title: string) => until(() => document.querySelector(".page-content .page-title h2")?.textContent === title, title);
const node = <T extends HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  assert(element, `Missing ${selector}`);
  return element;
};
const action = (text: string, scope = "button, a") => Array.from(document.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(scope))
  .find(element => element.textContent?.trim() === text);

function click(text: string, scope?: string) {
  const element = action(text, scope);
  assert(element && !(element instanceof HTMLButtonElement && element.disabled), `Missing enabled control: ${text}`);
  element.click();
}

function setField(element: HTMLSelectElement | HTMLInputElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function selection(label: string) {
  const field = Array.from(document.querySelectorAll<HTMLSelectElement>(".inventory-report select"))
    .find(element => element.labels?.[0]?.firstChild?.textContent?.trim() === label);
  assert(field, `Missing field ${label}`);
  return field;
}

function select(label: string, value: string) {
  const field = selection(label);
  assert(Array.from(field.options).some(option => option.value === value), `Missing option ${label} / ${value}`);
  setField(field, value);
}

async function login(name = "reader") {
  await until(() => document.querySelector(".login-card button:not(:disabled)"), "login form");
  setField(node<HTMLInputElement>(".login-card [name=name]"), name);
  setField(node<HTMLInputElement>(".login-card [name=password]"), "does-not-leave-renderer");
  node<HTMLFormElement>(".login-card form").requestSubmit();
  await until(() => document.querySelector(".side-nav"), "signed-in shell");
}

function route(path: string) {
  window.location.hash = path;
}

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function stockLocation(id: string, name: string, active = true): ResolvedLocationDto {
  const location = { ...locations[0], id, code: id, name, status: active ? "active" : "inactive" } as const;
  return {
    location,
    warehouse: sites[0],
    branch: { ...defaults, id: "b", code: "B", name: "Branch", description: null, address: null, phone: null, contactName: null },
    path: [{ id, code: id, name }],
    effectiveActive: active,
  };
}

function operationField(label: string) {
  const field = Array.from(document.querySelectorAll<HTMLSelectElement>(".inventory-entry select"))
    .find(element => element.labels?.[0]?.firstChild?.textContent?.trim() === label);
  assert(field, `Missing Stock Operations field: ${label}`);
  return field;
}

function chooseOperationValue(label: string, value: string) {
  flushSync(() => setField(operationField(label), value));
}

type BrowserCase = (test: ReturnType<typeof fixture>) => Promise<void>;
const cases: Record<string, BrowserCase> = {
  async "navigation and access"({ calls }) {
    await login("denied");
    await heading("المخزون");
    await see("لا تملك صلاحية عرض بيانات المخزون.");
    assert(!action("المخزون", ".side-nav a") && calls.directory === 0, "Denied users must not load the directory or see the sidebar link");
    route("/");
    await see("مرحبًا بك");
    assert(!document.querySelector('.quick-links a[href="#/inventory"]'), "Dashboard must hide the Inventory link");
    click("تبديل المستخدم");
    await login();
    click("المخزون", ".side-nav a");
    await heading("نظرة عامة على المخزون");
    click("سجل الحركات", ".inventory-nav a");
    await heading("سجل حركات المخزون");
    assert(action("سجل الحركات", ".inventory-nav a")?.getAttribute("aria-current") === "page", "Active Inventory navigation");
    assert(calls.locations.join(",") === "a,z", "Label lists should be reused between reports");
    assert(document.documentElement.scrollWidth <= window.innerWidth, "Navigation must fit the desktop workspace");
    click("عمليات المخزون", ".inventory-nav a");
    await heading("عمليات المخزون");
    assert(calls.execute > 0, "Legacy Stock Operations is still reachable");
    click("الأصناف", ".side-nav a");
    await heading("الأصناف");
  },

  async "scoped overview and balances"({ api, calls }) {
    await login();
    await heading("نظرة عامة على المخزون");
    select("الصنف", simple);
    await until(() => selection("الصنف").value === simple, "rendered item selection");
    select("الموقع", "east");
    await see(exact);
    assert(calls.available.length === 1 && calls.balance.length === 0, "Overview should use one availability call");
    click("عرض الأرصدة");
    await heading("أرصدة المخزون");
    await see(exact);
    await see("كيلوغرام");
    assert(calls.balance[0]?.locationId === "east" && contains("Simple part") && contains("Central warehouse"), "Exact balance must show enriched identity");
    select("الموقع", "old");
    await see("لا يوجد رصيد مسجّل");
    select("المخزن", "z");
    await see("لا توجد أرصدة ضمن هذا النطاق.");
    assert(calls.item.includes(simple), "Clearing a location should browse item balances");
    select("المخزن", "a");
    await see(exact);
    assert(calls.item.length === 1, "Warehouse filter should reuse the fetched item balances");
    api.inventory.getStockBalance = async () => { throw new Error("sensitive internal error"); };
    select("الموقع", "east");
    await see("تعذّر تحميل بيانات المخزون");
    assert(!contains("sensitive internal error") && !contains(exact), "Failed filters must discard the previous balance and mask internals");
  },

  async "stock item identity and totals"({ calls }) {
    route("/inventory/items?item=v%3Aone");
    await login();
    await see("4.375");
    await see("Family / Small");
    assert(contains("VAR-001") && contains("قطعة") && contains("West warehouse") && contains("Central warehouse"), "Variant identity, base unit and warehouse breakdown");
    assert(calls.item.join(",") === variant && !Array.from(document.querySelectorAll("option")).some(option => option.value === "p:parent"), "Variant and virtual parent must stay distinct");
    select("الصنف", empty);
    await see("0.000");
    await see("لا توجد أرصدة");
    route("/inventory/items?item=bad");
    await see("معرّف صنف المخزون غير صالح.");
    assert(!calls.item.includes("bad"), "Invalid identifier must not call IPC");
    route("/inventory/items?item=p%3Aunknown");
    await see("صنف المخزون غير موجود.");
  },

  async "warehouse reporting and search"({ calls }) {
    route("/inventory/warehouses");
    await login();
    await heading("المخزون حسب المخزن");
    select("المخزن", "a");
    await see(exact);
    await see("غير نشط");
    const rows = Array.from(document.querySelectorAll(".inventory-report table:first-of-type tbody tr"));
    assert(rows.length >= 2 && rows[0].textContent?.includes("BASE-001"), "Warehouse results are ordered by stable identity");
    assert(contains("Old bin") && contains("East bin") && contains("1.250"), "Report includes every location and exact per-item totals");
    setField(node<HTMLInputElement>(".inventory-report .search-field input"), "var-001");
    await until(() => !contains("Simple part") && contains("Family / Small"), "client-side SKU search");
    assert(calls.warehouse.join(",") === "a", "Search must not refetch warehouse stock");
    click("Family / Small");
    await see("4.375");
    route("/inventory/warehouses?warehouse=z");
    await see("لا توجد أرصدة في هذا المخزن.");
    assert(calls.warehouse.at(-1) === "z", "Second warehouse requested");
  },

  async "movement cursor, errors, and stale requests"({ api, calls }) {
    const old = defer<InventoryHistoryResult>();
    let pagesAfterCursor = 0;
    const movement = (itemId: string, movementId: string, delta: string, documentId = "DOC-1") => (
      { itemId, movementId, delta, documentId, locationId: "old" }
    );
    api.inventory.getInventoryHistory = async request => {
      calls.history.push(request);
      if (request.beforeMovementId) {
        if (++pagesAfterCursor === 1) {
          return { movements: [movement(request.itemId, "38", "0.000", "OLDER-DOCUMENT")], nextBeforeMovementId: null };
        }
        return old.promise;
      }
      if (request.locationId === "east") throw new Error("internal history error");
      if (request.locationId === "old") return { movements: [], nextBeforeMovementId: null };
      return { movements: [movement(request.itemId, "9223372036854775807", "1.375"), movement(request.itemId, cursor, "-0.125")], nextBeforeMovementId: cursor };
    };
    route("/inventory/history?item=v%3Aone");
    await login();
    await see("+1.375");
    const ids = Array.from(document.querySelectorAll(".inventory-report tbody tr"), row => row.firstElementChild?.textContent);
    assert(ids.join(",") === `9223372036854775807,${cursor}` && contains("-0.125") && contains("DOC-1"), "Signed deltas and descending exact movement IDs");
    click("التالي");
    await see("OLDER-DOCUMENT");
    assert(calls.history.at(-1)?.beforeMovementId === cursor && node<HTMLButtonElement>('.pagination button:last-child').disabled, "The next page uses the exact cursor and stops at the end");
    click("السابق");
    await see("+1.375");
    assert(calls.history.at(-1)?.beforeMovementId === undefined, "Previous uses the earlier cursor");
    click("التالي");
    await see("جارٍ تحميل البيانات");
    assert(!contains("+1.375"), "Previous page data must clear while loading");
    await until(() => pagesAfterCursor === 2, "pending cursor request");
    select("الموقع", "old");
    await see("لا توجد حركات مخزون");
    assert(calls.history.at(-1)?.beforeMovementId === undefined && calls.history.at(-1)?.locationId === "old", "Changing scope clears the cursor stack");
    old.resolve({ movements: [movement(variant, "1", "4.000", "STALE-DOCUMENT")], nextBeforeMovementId: null });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert(!contains("STALE-DOCUMENT") && contains("لا توجد حركات مخزون"), "A late page must not overwrite the new filter results");
    select("الموقع", "east");
    await see("تعذّر تحميل بيانات المخزون");
    assert(!contains("STALE-DOCUMENT") && !contains("internal history error"), "Stale and internal data must stay out of the UI");
    assert(calls.history.every(call => !!call.limit && call.limit <= 200 && call.itemId === variant), "Bounded history pages for the exact item");
  },

  async "read-only consistency"({ api, calls }) {
    route("/inventory/consistency?item=p%3Aone&location=east");
    await login();
    await heading("التحقق من اتساق الرصيد");
    assert(!calls.consistency.length, "Verification requires explicit action");
    click("تحقق من الاتساق");
    await see("الرصيد المسجّل مطابق");
    select("الموقع", "old");
    await see("اختر الصنف والموقع ثم اضغط");
    assert(calls.consistency.length === 1 && !contains("الرصيد المسجّل مطابق"), "New scope must clear the previous result");
    click("تحقق من الاتساق");
    await see("يوجد اختلاف");
    assert(contains("-1.375") && contains("لا يوجد رصيد مسجّل") && contains("كيلوغرام"), "Mismatch shows the actual response values");
    api.inventory.verifyBalanceConsistency = async () => { throw new Error("internal diagnostic error"); };
    click("تحقق من الاتساق");
    await see("تعذّر تحميل بيانات المخزون");
    assert(!contains("internal diagnostic error") && !contains("-1.375") && calls.execute === 0, "Verification errors are safe and verification issues no commands");
  },

  async "session expiration, logout, and account switching"({ api, calls, endSession }) {
    const slow = defer<Awaited<ReturnType<InventoryQueryApi["getStockItemStock"]>>>();
    const stock = api.inventory.getStockItemStock;
    api.inventory.getStockItemStock = request => {
      if (request.itemId !== variant) return stock(request);
      calls.item.push(request.itemId);
      return slow.promise;
    };
    route("/inventory/items?item=p%3Aone");
    await login();
    await see(exact);
    select("الصنف", variant);
    await until(() => calls.item.includes(variant), "in-flight request before logout");
    click("تبديل المستخدم");
    await until(() => document.querySelector(".login-card button:not(:disabled)"), "logout clears the session");
    assert(!document.querySelector(".inventory-report") && !window.location.hash.includes("item=") && calls.logout === 1, "Logout removes inventory data and selected IDs");
    await login("other");
    await see("اختر صنفًا لعرض تفاصيل مخزونه.");
    slow.resolve({ itemId: variant, baseUnitId: "pc", onHand: "4321.001", balances: [] });
    api.inventory.getStockItemStock = async () => { throw new Error("تسجيل الدخول مطلوب"); };
    endSession();
    select("الصنف", simple);
    await until(() => document.querySelector(".login-card"), "backend expiration returns to login");
    assert(!contains(exact) && !contains("4321.001") && !window.location.hash.includes("item="), "Neither account can see the previous response after expiration");
    await login();
    await heading("المخزون حسب الصنف");
    api.inventory.getStockItemStock = async () => { throw new ClientError("FORBIDDEN", "الصلاحية غير متاحة"); };
    select("الصنف", simple);
    await see("لا تملك صلاحية عرض بيانات المخزون.");
    assert(!document.querySelector(".inventory-report"), "Backend permission denial removes the reports");
  },
  async "stock operations lookup and document flows"({ api }) {
    let sku = "BASE-001";
    let places = [stockLocation("west", "West bin"), stockLocation("east", "East bin")];
    const saved = [
      { item: simple, location: "old", destination: "missing", quantity: "1.125" },
      { item: variant, location: "east", destination: "west", quantity: "0.001" },
      { item: "p:unknown", location: "east", destination: "west", quantity: "2" },
    ];
    const commands: StockCommand[] = [];
    api.warehouses.locations.stockable = async () => places;
    api.warehouses.locations.get = async ({ id }) => {
      if (id === "old") return stockLocation(id, "Old bin", false);
      throw new Error("الموقع غير موجود");
    };
    api.inventory.execute = async (command): Promise<StockResult> => {
      commands.push(command);
      switch (command.op) {
        case "items": return { rows: [{ id: simple, sku }, { id: variant, sku: "VAR-001" }, { id: simple, sku: "DUPLICATE" }] };
        case "documents": return { rows: [
          { id: "historical-transfer", kind: "transfer", state: "draft", version: 1, lines: JSON.stringify(saved) },
          { id: "posted-issue", kind: "issue", state: "posted", version: 1 },
        ] };
        case "details": return { rows: [{ item: variant, location: "west", thousandths: "9223372036854775807" },
          { item: "p:unknown", location: "missing", thousandths: "-1" }] };
        default: return { id: "saved" };
      }
    };
    const ready = () => until(() => !node<HTMLFieldSetElement>(".inventory-page fieldset").disabled, "stock command finished");
    const received = async (expected: StockCommand) => {
      await until(() => commands.some(command => JSON.stringify(command) === JSON.stringify(expected)), JSON.stringify(expected));
      if (expected.op === "draft") await until(() => !node(".inventory-lines").textContent, "draft lines cleared after save");
      await ready();
    };
    route("/inventory/operations");
    await login();
    await see("BASE-001");
    const location = operationField("الموقع");
    assert(Array.from(location.options).map(option => option.value).join(",") === ",west,east", "Eligible options retain API order");
    assert(location.options[1].text === "Central warehouse · West bin", "Eligible option shows the Warehouse/path");
    const item = operationField("الصنف");
    assert(item.options[1].value === simple && item.options[2].value === variant && item.options[2].text === "VAR-001", "Stock item IDs and labels preserve product and variant identity");
    chooseOperationValue("الموقع", "west");
    chooseOperationValue("الصنف", simple);
    sku = "BASE-REFRESHED";
    places = [stockLocation("east", "East updated"), stockLocation("west", "West updated")];
    click("تحديث المواقع والمستندات");
    await see("West updated");
    await ready();
    assert(location.value === "west" && item.value === simple && location.options[1].value === "east", "Data refresh rebuilds ordered indexes and preserves active selections");
    await see("BASE-REFRESHED");

    for (const kind of ["receipt", "issue"] as const) {
      chooseOperationValue("العملية", kind);
      click("إضافة سطر");
      await until(() => node(".inventory-lines").textContent?.includes("BASE-REFRESHED · 1"), "Lines use the first matching item's refreshed SKU");
      click("حفظ مسودة");
      await received({ op: "draft", kind, lines: [{ item: simple, location: "west", quantity: "1" }] });
    }
    chooseOperationValue("العملية", "transfer");
    chooseOperationValue("الموقع الوجهة", "west");
    assert(action("إضافة سطر")?.matches(":disabled"), "Transfer requires a distinct destination");
    chooseOperationValue("الموقع الوجهة", "east");
    chooseOperationValue("الصنف", variant);
    click("إضافة سطر");
    await until(() => node(".inventory-lines").textContent?.includes("VAR-001 · 1"), "Transfer line shows the selected variant");
    click("حفظ مسودة");
    await received({ op: "draft", kind: "transfer", lines: [{ item: variant, location: "west", quantity: "1", destination: "east" }] });
    chooseOperationValue("العملية", "count");
    await see("لا يشمل المواقع الفرعية");
    click("بدء الجرد وقفل الموقع");
    await received({ op: "count", location: "west" });
    click("عكس المستند");
    await received({ op: "reverse", document: "posted-issue", command: "reverse:posted-issue" });
    click("تفاصيل", ".inventory-documents tbody tr:first-child button");
    await until(() => {
      const result = node(".inventory-page fieldset > table").textContent ?? "";
      return [exact, "−0.001", "VAR-001", "p:unknown", "Central warehouse · West updated",
        "موقع غير متاح حاليًا (missing)"].every(value => result.includes(value));
    }, "Results use refreshed labels, preserve exact quantities and show unknown IDs");
    await ready();

    click("تعديل");
    await see("Central warehouse · Old bin — غير متاح لعملية جديدة");
    const source = operationField("الموقع المصدر");
    const dest = operationField("الموقع الوجهة");
    assert(source.value === "old" && source.selectedOptions[0].disabled, "Historical source remains selected and disabled");
    assert(dest.value === "missing" && dest.selectedOptions[0].disabled
      && dest.selectedOptions[0].text === "موقع غير متاح حاليًا (missing)", "Unknown destination keeps its ID and fallback");
    assert(action("إضافة سطر")?.matches(":disabled"), "Unavailable locations cannot be added to new lines");
    const lines = node(".inventory-lines").textContent ?? "";
    assert(lines.includes("BASE-REFRESHED · 1.125") && lines.includes("VAR-001 · 0.001") && lines.includes("p:unknown · 2"), "Saved lines keep identity, exact quantities and unknown-item fallback");
    places = [...places, stockLocation("old", "Reactivated bin")];
    click("تحديث المواقع والمستندات");
    await see("Reactivated bin");
    await ready();
    assert(source.value === "old" && !source.selectedOptions[0].disabled, "Eligibility refresh restores the active option for the same ID");
    click("إغلاق تعديل المسودة");
    await until(() => !node(".inventory-lines").textContent, "Closing a draft clears its lines");
  },

  async "stock operations session isolation"({ api }) {
    let firstAccount = true;
    const late = defer<ResolvedLocationDto>();
    let requested = false;
    api.warehouses.locations.stockable = async () => firstAccount ? [stockLocation("east", "First account bin")] : [stockLocation("west", "Second account bin")];
    api.warehouses.locations.get = () => { requested = true; return late.promise; };
    api.inventory.execute = async command => {
      if (command.op === "items") return { rows: [{ id: simple, sku: firstAccount ? "FIRST-SKU" : "SECOND-SKU" }] };
      if (command.op === "documents" && firstAccount) return { rows: [{
        id: "first-draft", kind: "receipt", state: "draft", version: 1,
        lines: JSON.stringify([{ item: simple, location: "old", quantity: "1" }]),
      }] };
      return { rows: [] };
    };
    route("/inventory/operations");
    await login();
    await see("FIRST-SKU");
    click("تعديل");
    await until(() => requested, "historical location lookup pending");
    click("تبديل المستخدم");
    await until(() => document.querySelector(".login-card button:not(:disabled)"), "logout clears Stock Operations");
    assert(!document.querySelector(".inventory-page"), "Stock Operations unmounts at logout");
    firstAccount = false;
    await login("other");
    await see("SECOND-SKU");
    late.resolve(stockLocation("old", "Late historical bin", false));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    assert(contains("Second account bin") && !contains("FIRST-SKU") && !contains("First account bin")
      && !contains("Late historical bin") && !contains("first-draft"), "Account switch clears indexes, selections and pending historical results");
    assert(operationField("الموقع").value === "" && operationField("الصنف").value === "", "New session starts with empty form selections");
  },
};

Object.assign(window, {
  async runInventoryTests() {
    const results: Record<string, string | null> = {};
    for (const [name, run] of Object.entries(cases)) {
      window.history.replaceState(null, "", "#/inventory");
      const test = fixture();
      Object.defineProperty(window, "warehouse", { configurable: true, value: test.api });
      const root = createRoot(node("#root"));
      root.render(<StrictMode><Session><App /></Session></StrictMode>);
      try {
        await run(test);
        results[name] = null;
      } catch (error) {
        results[name] = error instanceof Error ? error.stack ?? error.message : String(error);
      } finally {
        root.unmount();
      }
    }
    return results;
  },
});
