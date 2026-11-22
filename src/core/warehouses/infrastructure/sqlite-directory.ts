import type Database from "better-sqlite3";
import {randomUUID} from "node:crypto";
import type {WarehouseDirectory} from "../public";
export function createWarehouseDirectory(db:Database.Database):WarehouseDirectory{
 return {
  branch(id,name){db.prepare("INSERT INTO branches VALUES(?,?)").run(id,name)},
  warehouse(id,branch,name){db.prepare("INSERT INTO warehouses VALUES(?,?,?)").run(id,branch,name);db.prepare("INSERT INTO locations VALUES(?,?,?)").run(randomUUID(),id,"افتراضي")},
  location(id,warehouse,name){db.prepare("INSERT INTO locations VALUES(?,?,?)").run(id,warehouse,name)},
  directory(){return db.prepare("SELECT id,name,'branch' kind FROM branches UNION ALL SELECT id,name,'warehouse' kind FROM warehouses ORDER BY kind,name").all() as Record<string,string>[]},
  places(){return db.prepare("SELECT l.id,l.name,w.name warehouse,b.name branch,w.id warehouse_id,b.id branch_id FROM locations l JOIN warehouses w ON w.id=l.warehouse JOIN branches b ON b.id=w.branch").all() as Record<string,string>[]}
 };
}
