import { useState } from "react";
import { Link } from "react-router-dom";
import type { BranchDto, DefinitionStatus } from "../../shared/warehouses/types";
import { branchCreate, branchUpdate } from "../../shared/warehouses/schemas";
import { Button, DataTable, Dialog, EmptyState, ListPagination, LoadingState, PageTitle, SearchStatusFilter, StatusBadge } from "../ui";
import { useSession } from "../session-context";
import { DefinitionFields, Feedback, ReadAccess, ResourceError, WarehouseDialog, definitionInput, useResource, useWarehouseAction, validated } from "./shared";

const api=()=>window.warehouse.warehouses.branches;
export function BranchesPage(){return <ReadAccess><BranchList /></ReadAccess>;}
function BranchList() {
  const {can}=useSession();
  const [search,setSearch]=useState(""),[status,setStatus]=useState<"all"|DefinitionStatus>("all"),[page,setPage]=useState(1);
  const [editing,setEditing]=useState<BranchDto|null|false>(false),[details,setDetails]=useState<string|null>(null),[changing,setChanging]=useState<BranchDto|null>(null);
  const action=useWarehouseAction();
  const list=useResource(()=>api().list({page,pageSize:15,search,status:status==="all"?undefined:status}),[page,search,status]);
  const reload=()=>{setEditing(false);setChanging(null);action.clear();list.reload();};
  const open=(value:BranchDto|null)=>{action.clear();setEditing(value);};
  return <section dir="rtl" className="warehouse-page">
    <PageTitle title="الفروع" description="نظّم فروع المنشأة وبيانات التواصل والمخازن التابعة لها." action={can("warehouse")&&<Button variant="primary" onClick={()=>open(null)}>إضافة فرع</Button>} />
    <Feedback action={action} reload={reload} /><ResourceError error={list.error} reload={list.reload} />
    <SearchStatusFilter search={search} onSearch={value=>{setSearch(value.slice(0,200));setPage(1);}} status={status} onStatus={value=>{setStatus(value);setPage(1);}} searchPlaceholder="اسم الفرع أو رمزه" />
    <DataTable rows={[...(list.data?.items??[])]} loading={list.loading} rowKey={row=>row.id} empty="لا توجد فروع تطابق البحث." columns={[
      {key:"code",header:"الرمز",render:row=><code>{row.code}</code>},
      {key:"name",header:"الفرع",render:row=><Button variant="quiet" onClick={()=>setDetails(row.id)}>{row.name}</Button>},
      {key:"contact",header:"التواصل",render:row=><>{row.contactName??"—"}<small className="warehouse-secondary">{row.phone}</small></>},
      {key:"status",header:"الحالة",render:row=><StatusBadge status={row.status} />},
      {key:"actions",header:"الإجراءات",render:row=><div className="row-actions"><Button variant="quiet" onClick={()=>setDetails(row.id)}>التفاصيل والمخازن</Button>{can("warehouse")&&<Button variant="quiet" onClick={()=>open(row)}>تعديل</Button>}{can("warehouse.status")&&<Button variant="quiet" onClick={()=>{action.clear();setChanging(row);}}>{row.status==="active"?"تعطيل":"تفعيل"}</Button>}</div>},
    ]} />
    {list.data&&!list.loading&&<ListPagination page={{...list.data,items:[...list.data.items]}} currentPage={page} onPage={setPage} />}
    {editing!==false&&can("warehouse")&&<WarehouseDialog key={editing?.id??"new"} title={editing?"تعديل الفرع":"إضافة فرع"} action={action} reload={reload} onClose={()=>setEditing(false)} onSubmit={event=>{
      event.preventDefault();const form=event.currentTarget;
      void action.run(async()=>{
        const input=definitionInput(form,true);
        if(editing)await api().update(validated(branchUpdate,{...input,id:editing.id,expectedVersion:editing.version}));
        else await api().create(validated(branchCreate,input));
      },()=>{setEditing(false);list.reload();});
    }}><DefinitionFields value={editing} branch />{editing&&<p className="muted-text">الحالة الحالية: <StatusBadge status={editing.status} /> — تغيير الحالة متاح بإجراء مستقل.</p>}</WarehouseDialog>}
    {changing&&can("warehouse.status")&&<WarehouseDialog title={changing.status==="active"?"تعطيل الفرع":"تفعيل الفرع"} action={action} reload={reload} submitLabel="تأكيد تغيير الحالة" onClose={()=>setChanging(null)} onSubmit={event=>{
      event.preventDefault();void action.run(()=>api().setStatus({id:changing.id,status:changing.status==="active"?"inactive":"active",expectedVersion:changing.version}),()=>{setChanging(null);list.reload();});
    }}><p>هل تريد تغيير حالة «{changing.name}»؟</p><p className="muted-text">تعطيل الفرع يتطلب تعطيل جميع مخازنه أولًا. التفعيل لا يفعّل المخازن تلقائيًا.</p></WarehouseDialog>}
    {details&&<BranchDetails id={details} close={()=>setDetails(null)} />}
  </section>;
}
function BranchDetails({id,close}:{id:string;close:()=>void}) {
  const resource=useResource(()=>api().get({id}),[id]);
  return <Dialog title="تفاصيل الفرع" onClose={close} onSubmit={event=>{event.preventDefault();close();}} submitLabel="إغلاق">
    <ResourceError error={resource.error} reload={resource.reload} />
    {resource.loading?<LoadingState />:resource.data&&<>
      <h4>{resource.data.branch.name} <code>{resource.data.branch.code}</code></h4><StatusBadge status={resource.data.branch.status} />
      <dl className="warehouse-metadata">{([['الوصف',resource.data.branch.description],['العنوان',resource.data.branch.address],['الهاتف',resource.data.branch.phone],['مسؤول التواصل',resource.data.branch.contactName]]).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||"—"}</dd></div>)}</dl>
      <h4>المخازن التابعة</h4>{resource.data.warehouses.length?<ul className="warehouse-links">{resource.data.warehouses.map(warehouse=><li key={warehouse.id}><Link to={`/warehouses/${warehouse.id}`}>{warehouse.name} · {warehouse.code}</Link> <StatusBadge status={warehouse.status} /></li>)}</ul>:<EmptyState>لا توجد مخازن تابعة لهذا الفرع.</EmptyState>}
    </>}
  </Dialog>;
}
