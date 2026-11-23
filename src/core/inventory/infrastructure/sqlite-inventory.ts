import type {InventoryWarehouseGateway, LocationOperation} from "../../warehouses/public";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { StockCatalog } from "../../catalog/public";
import {
  commands,
  type StockCommand,
  type StockLine,
  type StockResult,
} from "../../../shared/ipc/stock";
import { AppError } from "../../shared/errors/app-error";

type Document = {
  id: string;
  kind: string;
  state: string;
  version: number;
  lines: string;
};
function fail(code: string): never {
  throw new AppError(code, code);
}
const permission = {
  barcode: "read",
  directory: "read",
  details: "read",
  branch: "warehouse",
  warehouse: "warehouse",
  location: "warehouse",
  draft: "draft",
  edit: "draft",
  cancel: "draft",
  post: "post",
  reverse: "reverse",
  count: "count",
  review: "count",
  balances: "read",
  history: "read",
  reconcile: "read",
  rebuild: "restore",
  items: "read",
  places: "read",
  documents: "read",
} as const;

export function createInventory(
  db: Database.Database,
  authorize: (actor: string, action: string) => void,
  catalog: StockCatalog,
  warehouses: InventoryWarehouseGateway,
  backupBeforeRepair: ()=>void,
) {
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args);
  const get = <T>(sql: string, ...args: unknown[]) =>
    db.prepare(sql).get(...args) as T | undefined;
  const rows = (sql: string, ...args: unknown[]) =>
    db.prepare(sql).all(...args) as NonNullable<StockResult["rows"]>;
  function lookup(id: string) {
    return (
      get<Document>("SELECT * FROM documents WHERE id=?", id) ??
      fail("DOCUMENT_NOT_FOUND")
    );
  }
  function quantity(item: string, location: string) {
    return BigInt(
      get<{ q: string }>(
        "SELECT CAST(qty AS TEXT) q FROM balances WHERE item=? AND location=?",
        item,
        location,
      )?.q ?? "0",
    );
  }
  function apply(
    document: string,
    index: number,
    item: string,
    location: string,
    delta: bigint,
    snapshot: string,
  ) {
    if (
      get(
        "SELECT 1 FROM count_locks WHERE location=? AND document<>?",
        location,
        document,
      )
    )
      fail("LOCATION_LOCKED");
    if (!delta) return;

    run(
      "INSERT INTO movements(document,line,item,location,delta,snapshot) VALUES(?,?,?,?,?,?)",
      document,
      index,
      item,
      location,
      delta,
      snapshot,
    );
  }
  function audit(actor: string, op: string, target: string) {
    run(
      "INSERT INTO audit(actor,action,target) VALUES(?,?,?)",
      actor,
      op,
      target,
    );
  }
  function validateLines(kind: string, lines: readonly StockLine[], countLocation?: string) {
    for (const line of lines) {
      if (kind === "count" && line.location !== countLocation) fail("INVALID_COUNT_LINE");
      warehouses.assertLocationUsable(line.location,kind as LocationOperation);
      if (kind === "transfer") {
        if (!line.destination || line.destination === line.location) fail("INVALID_DESTINATION");
        warehouses.assertLocationUsable(line.destination,"transfer");
      } else if (line.destination) fail("INVALID_DESTINATION");
    }
  }
  function countLocation(document: string): string {
    const lock = get<{location:string}>("SELECT location FROM count_locks WHERE document=?",document);
    if (!lock) fail("INVALID_COUNT_STATE");
    warehouses.countLocationIds(lock.location);
    return lock.location;
  }
  function execute(actor: string, cmd: StockCommand): StockResult {
    authorize(actor, permission[cmd.op]);
    const id = randomUUID();
    switch (cmd.op) {
      case "barcode":
        return { rows: [catalog.resolveBarcode(cmd.code)] };
      case "directory": return {rows:warehouses.directory()};
      case "items":
        return {
          rows: rows(
            "SELECT s.id,coalesce(v.sku,p.sku) sku FROM stock_items s LEFT JOIN products p ON p.id=s.product_id LEFT JOIN product_variants v ON v.id=s.variant_id ORDER BY sku",
          ),
        };
      case "places": return {rows:warehouses.places()};
      case "documents":
        return {
          rows: rows("SELECT d.*,l.location FROM documents d LEFT JOIN count_locks l ON l.document=d.id ORDER BY d.state IN ('draft','review') DESC,d.rowid DESC LIMIT 200"),
        };
      case "balances":
        return {
          rows: rows(
            "SELECT item,location,CAST(qty AS TEXT) thousandths FROM balances ORDER BY item,location",
          ),
        };
      case "history":
        return {
          rows: rows(
            "SELECT document,location,CAST(delta AS TEXT) thousandths,snapshot FROM movements WHERE item=? ORDER BY id DESC LIMIT 200",
            cmd.item,
          ),
        };
      case "rebuild":
      case "reconcile": {
        const totals = new Map<string, bigint>();
        for (const m of db
          .prepare("SELECT item,location,delta FROM movements")
          .safeIntegers()
          .iterate() as Iterable<{
          item: string;
          location: string;
          delta: bigint;
        }>) {
          const k = JSON.stringify([m.item, m.location]);
          totals.set(k, (totals.get(k) ?? 0n) + m.delta);
        }
        if(cmd.op==="rebuild"){
          if(get("SELECT 1 FROM count_locks LIMIT 1"))fail("LOCATION_LOCKED");
          run("DELETE FROM balances");
          for(const [key,value] of totals){
            if(value<0n||value>9223372036854775807n)fail("INVALID_LEDGER");
            const [item,location]=JSON.parse(key);run("INSERT INTO balances VALUES(?,?,?)",item,location,value);
          }
          audit(actor,"rebuild","balances");return {rows:[]};
        }
        const differences: NonNullable<StockResult["rows"]> = [];
        for (const b of rows(
          "SELECT item,location,CAST(qty AS TEXT) qty FROM balances",
        )) {
          const k = JSON.stringify([b.item, b.location]);
          if (totals.get(k) !== BigInt(String(b.qty)))
            differences.push({
              ...b,
              ledger: totals.get(k)?.toString() ?? null,
            });
          totals.delete(k);
        }
        for (const [k, total] of totals) {
          const [item, location] = JSON.parse(k);
          differences.push({
            item,
            location,
            qty: null,
            ledger: total.toString(),
          });
        }
        return { rows: differences };
      }
      case "details": {
        const doc=lookup(cmd.document);
        if(doc.kind==="count")return {rows:rows("SELECT k.item,CAST(e.expected AS TEXT) expected,CAST(c.base AS TEXT) counted FROM (SELECT item FROM count_expected WHERE document=? UNION SELECT item FROM reviewed_counts WHERE document=?) k LEFT JOIN count_expected e ON e.document=? AND e.item=k.item LEFT JOIN reviewed_counts c ON c.document=? AND c.item=k.item",doc.id,doc.id,doc.id,doc.id)};
        return {rows:JSON.parse(doc.lines)};
      }
      // Warehouse services own their audit event; do not also emit an Inventory one.
      case "branch": return {id:warehouses.createBranch(actor,cmd.name)};
      case "warehouse": return {id:warehouses.createWarehouse(actor,cmd.branch,cmd.name)};
      case "location": return {id:warehouses.createLocation(actor,cmd.warehouse,cmd.name)};
      case "draft":
        validateLines(cmd.kind,cmd.lines);
        run(
          "INSERT INTO documents(id,kind,state,lines) VALUES(?,?,'draft',?)",
          id,
          cmd.kind,
          JSON.stringify(cmd.lines),
        );
        break;
      case "count": {
        warehouses.countLocationIds(cmd.location);
        run(
          "INSERT INTO documents(id,kind,state,lines) VALUES(?,'count','draft','[]')",
          id,
        );
        run("INSERT INTO count_locks VALUES(?,?)", cmd.location, id);
        for (const b of rows(
          "SELECT item,CAST(qty AS TEXT) expected FROM balances WHERE location=? AND qty>0",
          cmd.location,
        ))
          run(
            "INSERT INTO count_expected VALUES(?,?,?)",
            id,
            b.item,
            b.expected,
          );
        break;
      }
      default: {
        const doc = lookup(cmd.document);
        if (doc.kind === "count") authorize(actor, "count");
        const fingerprint = JSON.stringify(cmd);
        if ("command" in cmd) {
          const saved = get<{ document: string; fingerprint: string }>(
            "SELECT * FROM receipts WHERE command=?",
            cmd.command,
          );
          if (saved)
            return saved.fingerprint === fingerprint
              ? { id: saved.document }
              : fail("COMMAND_CONFLICT");
        }
        if ("version" in cmd && doc.version !== cmd.version)
          fail("VERSION_CONFLICT");
        let target = doc.id;
        if (cmd.op === "reverse") {
          if (
            doc.state !== "posted" ||
            doc.kind === "reversal" ||
            get("SELECT 1 FROM documents WHERE original=?", doc.id)
          )
            fail("INVALID_REVERSAL");
          // Include zero-variance count lines, which may have no movement entry.
          for (const line of JSON.parse(doc.lines) as StockLine[]) {
            warehouses.assertLocationUsable(line.location,"reversal");
            if (line.destination) warehouses.assertLocationUsable(line.destination,"reversal");
          }
          target = id;
          run(
            "INSERT INTO documents(id,kind,state,lines,original) VALUES(?,'reversal','draft',?,?)",
            id,
            doc.lines,
            doc.id,
          );
          for (const m of rows(
            "SELECT line,item,location,CAST(delta AS TEXT) delta,snapshot FROM movements WHERE document=? ORDER BY id DESC",
            doc.id,
          )) {
            warehouses.assertLocationUsable(String(m.location),"reversal");
            apply(
              id,
              Number(m.line),
              String(m.item),
              String(m.location),
              -BigInt(String(m.delta)),
              String(m.snapshot),
            );
          }
        } else if (cmd.op === "post") {
          if (doc.state !== (doc.kind === "count" ? "review" : "draft"))
            fail("INVALID_STATE");
          const lines = JSON.parse(doc.lines) as StockLine[];
          validateLines(doc.kind,lines,doc.kind === "count" ? countLocation(doc.id) : undefined);
          for (const [i, l] of lines.entries()) {
            const resolved=catalog.resolveStockItem(l,doc.kind==="count");
            const reviewed=doc.kind==="count"?get<{base:string;snapshot:string}>("SELECT CAST(base AS TEXT) base,snapshot FROM reviewed_counts WHERE document=? AND item=?",doc.id,l.item):undefined;
            if(doc.kind==="count" && (!reviewed || reviewed.snapshot!==resolved.snapshot))fail("COUNT_REVIEW_CHANGED");
            const {base,snapshot}=resolved;
            if (
              doc.kind === "transfer" &&
              (!l.destination || l.destination === l.location)
            )
              fail("INVALID_DESTINATION");
            if (doc.kind !== "transfer" && l.destination)
              fail("INVALID_DESTINATION");
            const delta =
              doc.kind === "count"
                ? base - quantity(l.item, l.location)
                : doc.kind === "receipt"
                  ? base
                  : -base;
            apply(target, i, l.item, l.location, delta, snapshot);
            if (doc.kind === "transfer")
              apply(target, i, l.item, l.destination!, base, snapshot);
          }
        } else {
          if (
            doc.state !== "draft" &&
            !(cmd.op === "cancel" && doc.state === "review")
          )
            fail("INVALID_STATE");
          if (cmd.op === "review") {
            if (doc.kind !== "count") fail("INVALID_STATE");
            const location = countLocation(doc.id);
            validateLines("count",JSON.parse(doc.lines) as StockLine[],location);
            const counted = new Set<string>();
            for (const l of JSON.parse(doc.lines) as StockLine[]) {
              if (
                l.location !== location ||
                l.destination ||
                counted.has(l.item)
              )
                fail("INVALID_COUNT_LINE");
              const checked=catalog.resolveStockItem(l,true);
              run("INSERT INTO reviewed_counts VALUES(?,?,?,?)",doc.id,l.item,checked.base,checked.snapshot);
              counted.add(l.item);
            }
            for (const r of rows(
              "SELECT item FROM count_expected WHERE document=?",
              doc.id,
            ))
              if (!counted.has(String(r.item))) fail("INCOMPLETE_COUNT");
          }
          if (cmd.op === "edit" && !cmd.lines.length && doc.kind !== "count")
            fail("EMPTY_DOCUMENT");
          if (cmd.op === "edit") validateLines(doc.kind,cmd.lines,doc.kind === "count" ? countLocation(doc.id) : undefined);
          run(
            "UPDATE documents SET state=?,lines=?,version=version+1 WHERE id=?",
            cmd.op === "review"
              ? "review"
              : cmd.op === "cancel"
                ? "cancelled"
                : "draft",
            cmd.op === "edit" ? JSON.stringify(cmd.lines) : doc.lines,
            target,
          );
          if (cmd.op === "cancel")
            run("DELETE FROM count_locks WHERE document=?", target);
          audit(actor, cmd.op, target);
          return { id: target };
        }
        const totals = new Map<
          string,
          { item: string; location: string; delta: bigint }
        >();
        for (const m of rows(
          "SELECT item,location,CAST(delta AS TEXT) delta FROM movements WHERE document=?",
          target,
        )) {
          const item = String(m.item),
            location = String(m.location),
            key = JSON.stringify([item, location]);
          totals.set(key, {
            item,
            location,
            delta: (totals.get(key)?.delta ?? 0n) + BigInt(String(m.delta)),
          });
        }
        for (const { item, location, delta } of totals.values()) {
          const next = quantity(item, location) + delta;
          if (next < 0n) fail("INSUFFICIENT_STOCK");
          if (next > 9223372036854775807n) fail("QUANTITY_OVERFLOW");
          run(
            "INSERT INTO balances VALUES(?,?,?) ON CONFLICT(item,location) DO UPDATE SET qty=excluded.qty",
            item,
            location,
            next,
          );
        }
        run(
          "UPDATE documents SET state='posted',version=version+1 WHERE id=?",
          target,
        );
        run("DELETE FROM count_locks WHERE document=?", target);
        run(
          "INSERT INTO receipts VALUES(?,?,?)",
          cmd.command,
          target,
          fingerprint,
        );
        audit(actor, cmd.op, target);
        return { id: target };
      }
    }
    audit(actor, cmd.op, id);
    return { id };
  }
  return (actor:string,input:StockCommand)=>{
    const command=commands.parse(input);
    if(command.op==="rebuild"){authorize(actor,"restore");backupBeforeRepair()}
    return db.transaction(()=>execute(actor,command)).immediate();
  };
}
