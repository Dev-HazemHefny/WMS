import type Database from "better-sqlite3";
import {randomUUID} from "node:crypto";
import type {WarehouseDirectory} from "../public";
export function createWarehouseDirectory(db:Database.Database):WarehouseDirectory{
 const modern = (db.pragma("table_info(branches)") as {name:string}[]).some(column => column.name === "code");
 const code = (prefix:string) => prefix + "-" + randomUUID().replace(/-/g, "").slice(0,24).toUpperCase();
 const insertLocation = (id:string, warehouse:string, name:string, isDefault:boolean) => {
  if (modern) db.prepare("INSERT INTO locations(id,warehouse,name,code,is_default,created_at,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(id,warehouse,name,code("LOC"),isDefault ? 1 : 0);
  else db.prepare("INSERT INTO locations(id,warehouse,name) VALUES(?,?,?)").run(id,warehouse,name);
 };
 return {
  branch(id,name){
   if (modern) db.prepare("INSERT INTO branches(id,name,code,created_at,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(id,name,code("BR"));
   else db.prepare("INSERT INTO branches(id,name) VALUES(?,?)").run(id,name);
  },
  warehouse(id,branch,name){db.transaction(()=>{
   if (modern) db.prepare("INSERT INTO warehouses(id,branch,name,code,created_at,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(id,branch,name,code("WH"));
   else db.prepare("INSERT INTO warehouses(id,branch,name) VALUES(?,?,?)").run(id,branch,name);
   insertLocation(randomUUID(),id,"افتراضي",true);
  })()},
  location(id,warehouse,name){insertLocation(id,warehouse,name,false)},
  directory(){return db.prepare("SELECT id,name,'branch' kind FROM branches UNION ALL SELECT id,name,'warehouse' kind FROM warehouses ORDER BY kind,name").all() as Record<string,string>[]},
  places(){return db.prepare("SELECT l.id,l.name,w.name warehouse,b.name branch,w.id warehouse_id,b.id branch_id FROM locations l JOIN warehouses w ON w.id=l.warehouse JOIN branches b ON b.id=w.branch").all() as Record<string,string>[]}
 };
}
