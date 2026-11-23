import { useState } from "react";
import { Button, ListPagination, LoadingState } from "../ui";
import { ResourceError, useResource } from "./shared";
import { validParent } from "./model";

export type ParentChoice = {id:string;label:string}|null;
export function ParentPicker({warehouseId,movingId,value,onChange}:{warehouseId:string;movingId?:string;value:ParentChoice;onChange:(value:ParentChoice)=>void}) {
  const [search,setSearch]=useState(""),[page,setPage]=useState(1);
  const candidates=useResource(async()=>{
    const result=await window.warehouse.warehouses.locations.list({warehouseId,search,status:"active",page,pageSize:10});
    const resolved=await Promise.all(result.items.map(row=>window.warehouse.warehouses.locations.get({id:row.id})));
    return {...result,items:resolved};
  },[warehouseId,movingId,search,page]);
  return <div className="parent-picker" role="group" aria-label="اختيار الموقع الأب">
    <p>الموقع الأب: <strong>{value?.label??"جذر المخزن — بدون أب"}</strong></p>
    <Button onClick={()=>onChange(null)}>اختيار جذر المخزن</Button>
    <label>بحث عن موقع أب<input maxLength={200} value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} placeholder="اسم الموقع أو رمزه" /></label>
    <ResourceError error={candidates.error} reload={candidates.reload} />
    {candidates.loading?<LoadingState />:<ul className="parent-options">{candidates.data?.items.map(row=>{
      const allowed=validParent(row,warehouseId,movingId),label=row.path.map(node=>node.name).join(" / ");
      return <li key={row.location.id}><button type="button" className="button button-quiet" disabled={!allowed} aria-pressed={row.location.id===value?.id} onClick={()=>onChange({id:row.location.id,label})}>{label} · {row.location.code}{!allowed?" — غير متاح كأب":""}</button></li>;
    })}</ul>}
    {!candidates.loading&&!candidates.error&&!candidates.data?.items.length&&<p className="muted-text">لا توجد مواقع تطابق البحث.</p>}
    {candidates.data&&!candidates.loading&&<ListPagination page={candidates.data} currentPage={page} onPage={setPage} />}
    <small className="muted-text">تظهر مواقع المخزن نفسه فقط. المواقع غير النشطة والاختيارات الدائرية غير متاحة.</small>
  </div>;
}
