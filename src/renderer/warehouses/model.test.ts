import { expect, it } from "@jest/globals";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedLocationDto, StorageLocationDto } from "../../shared/warehouses/types";
import { ClientError } from "../../shared/ipc/client-error";
import { EXACT_COUNT_NOTICE, failureCode, locationLabel, validParent, visibleLocations, warehouseError } from "./model";
import { eligibleLocations, inventoryLocationLabel } from "./inventory-locations";
import { DefinitionFields, ReadAccess } from "./shared";
import { SessionContext } from "../session-context";
import { Dialog } from "../ui";

const node=(id:string,parentId:string|null=null):StorageLocationDto=>({id,parentId,warehouseId:"w",code:id,name:id,status:"active",createdAt:"now",updatedAt:"now",version:1,locationType:"bin",isStockable:true,isDefault:false});
const resolved:ResolvedLocationDto={
  location:node("child","parent"),
  warehouse:{id:"w",branchId:"b",code:"W",name:"المخزن",description:null,address:null,status:"active",createdAt:"now",updatedAt:"now",version:1},
  branch:{id:"b",code:"B",name:"الفرع",description:null,address:null,phone:null,contactName:null,status:"active",createdAt:"now",updatedAt:"now",version:1},
  path:[{id:"parent",code:"P",name:"منطقة"},{id:"child",code:"C",name:"خانة"}],effectiveActive:true,
};
it("shows only expanded hierarchy levels in stable parent-first order",()=>{
  const rows=new Map([[null,[node("root")]],["root",[node("child","root")]],["child",[node("grandchild","child")]]]);
  expect(visibleLocations(rows,new Set()).map(row=>row.value.id)).toEqual(["root"]);
  expect(visibleLocations(rows,new Set(["root"])).map(row=>[row.value.id,row.depth])).toEqual([["root",0],["child",1]]);
});
it("renders a 2000-level expanded chain iteratively and terminates on repeated imported nodes",()=>{
  const rows=new Map<string|null,StorageLocationDto[]>(),expanded=new Set<string>();
  for(let i=0;i<2000;i++){const id=String(i);rows.set(i===0?null:String(i-1),[node(id,i===0?null:String(i-1))]);expanded.add(id);}
  rows.set("1999",[node("0","1999")]);
  expect(visibleLocations(rows,expanded)).toHaveLength(2000);
  expect(visibleLocations(rows,expanded)[1999].depth).toBe(1999);
});
it("allows active same-warehouse parents but excludes a moving node and all descendants",()=>{
  expect(validParent(resolved,"w","other")).toBe(true);
  expect(validParent(resolved,"w","parent")).toBe(false);
  expect(validParent(resolved,"w","child")).toBe(false);
  expect(validParent(resolved,"foreign")).toBe(false);
  expect(validParent({...resolved,effectiveActive:false},"w")).toBe(false);
});
it("excludes organizational and unavailable locations from new Inventory operations",()=>{
  expect(eligibleLocations([resolved,{...resolved,location:{...resolved.location,id:"org",isStockable:false}},{...resolved,effectiveActive:false}])).toEqual([resolved]);
});
it("keeps full warehouse/path labels and historical identities without selecting replacements",()=>{
  expect(locationLabel(resolved)).toBe("المخزن · منطقة / خانة");
  expect(inventoryLocationLabel("child",[resolved],{})).toBe(locationLabel(resolved));
  expect(inventoryLocationLabel("child",[],{child:{...resolved,effectiveActive:false}})).toContain("المخزن · منطقة / خانة — غير متاح");
  expect(inventoryLocationLabel("missing",[],{})).toContain("missing");
});
it("detects version/permission failures after Electron drops custom Error properties",()=>{
  expect(failureCode(new Error("تم تعديل البيانات، أعد تحميلها أولًا"))).toBe("VERSION_CONFLICT");
  expect(failureCode(new Error("الصلاحية غير متاحة"))).toBe("FORBIDDEN");
  expect(warehouseError(new ClientError("STOCK_EXISTS","internal"))).toContain("لن تُنقل أي كمية");
  expect(warehouseError(new Error("SELECT * FROM private C:/secret.db"))).not.toMatch(/SELECT|secret/);
});
it("communicates exact-location counts without presenting child aggregation",()=>{
  expect(EXACT_COUNT_NOTICE).toContain("لا يشمل المواقع الفرعية");
  expect(EXACT_COUNT_NOTICE).toContain("رصيد مستقل");
});
it.each([true,false])("gates read access from the existing session context: %s",allowed=>{
  const html=renderToStaticMarkup(createElement(SessionContext.Provider,{value:{capabilities:{authenticated:true,permissions:allowed?["read"]:[]},refreshCapabilities:async()=>{}}},createElement(ReadAccess,{children:createElement("span",null,"PRIVATE_DEFINITIONS")})));
  expect(html.includes("PRIVATE_DEFINITIONS")).toBe(allowed);
  if(!allowed)expect(html).toContain("لا تملك صلاحية");
});
it("reuses bounded Arabic-capable definition fields and accessible modal semantics",()=>{
  const fields=renderToStaticMarkup(createElement(DefinitionFields,{branch:true}));
  expect(fields).toContain('name="contactName"');expect(fields).toContain('maxLength="120"');expect(fields).toContain('pattern="[A-Za-z0-9_-]+"');
  const html=renderToStaticMarkup(createElement(Dialog,{title:"تأكيد الإجراء",onSubmit:()=>{},children:createElement("p",null,"تأكيد")}));
  expect(html).toContain('role="dialog"');expect(html).toContain('aria-modal="true"');expect(html).toContain("aria-labelledby");
});
