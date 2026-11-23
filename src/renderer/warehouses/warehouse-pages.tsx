import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { DefinitionStatus, WarehouseDto } from "../../shared/warehouses/types";
import { warehouseCreate, warehouseUpdate } from "../../shared/warehouses/schemas";
import { Button, DataTable, ListPagination, LoadingState, PageTitle, SearchStatusFilter, StatusBadge } from "../ui";
import { useSession } from "../session-context";
import { EXACT_COUNT_NOTICE } from "./model";
import { ActiveBranchSelect, DefinitionFields, Feedback, ReadAccess, ResourceError, WarehouseDialog, definitionInput, loadBranches, useResource, useWarehouseAction, validated } from "./shared";

const api=()=>window.warehouse.warehouses.warehouses;
export function WarehousesPage(){return <ReadAccess><WarehouseList /></ReadAccess>;}
function WarehouseList(){
  const {can}=useSession(),[params]=useSearchParams();
  const action=useWarehouseAction();
  const [branchId,setBranchId]=useState(params.get("branch")??""),[search,setSearch]=useState(""),[status,setStatus]=useState<"all"|DefinitionStatus>("all"),[page,setPage]=useState(1);
  const [creating,setCreating]=useState(false);
  const branches=useResource(loadBranches,[]);
  const list=useResource(()=>api().list({branchId:branchId||undefined,search,status:status==="all"?undefined:status,page,pageSize:15}),[branchId,search,status,page]);
  return <section dir="rtl" className="warehouse-page">
    <PageTitle title="المخازن" description="مخازن واضحة التبعية، ومواقع تخزين منظمة لكل عملية." action={can("warehouse")&&<Button variant="primary" onClick={()=>{action.clear();setCreating(true);}}>إضافة مخزن</Button>} />
    <Feedback action={action} reload={()=>{setCreating(false);action.clear();list.reload();}} />
    <ResourceError error={list.error||branches.error} reload={()=>{list.reload();branches.reload();}} />
    <SearchStatusFilter search={search} onSearch={value=>{setSearch(value.slice(0,200));setPage(1);}} status={status} onStatus={value=>{setStatus(value);setPage(1);}} searchPlaceholder="اسم المخزن أو رمزه" />
    <div className="filters"><label>الفرع<select value={branchId} onChange={event=>{setBranchId(event.target.value);setPage(1);}}><option value="">كل الفروع</option>{branches.data?.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label></div>
    <DataTable rows={[...(list.data?.items??[])]} loading={list.loading} rowKey={row=>row.id} empty="لا توجد مخازن تطابق البحث." columns={[
      {key:"code",header:"الرمز",render:row=><code>{row.code}</code>},
      {key:"name",header:"المخزن",render:row=><Link className="table-link" to={`/warehouses/${row.id}`}>{row.name}</Link>},
      {key:"branch",header:"الفرع",render:row=>branches.data?.find(branch=>branch.id===row.branchId)?.name??"جارٍ تحميل الفرع…"},
      {key:"status",header:"الحالة",render:row=><StatusBadge status={row.status} />},
      {key:"actions",header:"الإجراءات",render:row=><div className="row-actions"><Link className="button button-quiet" to={`/warehouses/${row.id}`}>التفاصيل والإدارة</Link><Link className="button button-quiet" to={`/warehouses/${row.id}/locations`}>مواقع التخزين</Link></div>},
    ]} />
    {list.data&&!list.loading&&<ListPagination page={{...list.data,items:[...list.data.items]}} currentPage={page} onPage={setPage} />}
    {creating&&can("warehouse")&&<WarehouseEditor value={null} action={action} close={()=>setCreating(false)} reload={list.reload} saved={()=>{setCreating(false);list.reload();}} />}
  </section>;
}
function WarehouseEditor({value,action,close,reload,saved}:{value:WarehouseDto|null;action:ReturnType<typeof useWarehouseAction>;close:()=>void;reload:()=>void;saved:()=>void}) {
  const branches=useResource(loadBranches,[]),[branchId,setBranchId]=useState("");
  return <WarehouseDialog title={value?"تعديل المخزن":"إضافة مخزن"} action={action} reload={()=>{close();action.clear();reload();}} onClose={close} submitDisabled={!value&&(!branchId||branches.loading||!!branches.error)} onSubmit={event=>{
    event.preventDefault();const form=event.currentTarget;
    void action.run(async()=>{
      const input=definitionInput(form);
      if(value)await api().update(validated(warehouseUpdate,{...input,id:value.id,expectedVersion:value.version}));
      else await api().create(validated(warehouseCreate,{...input,branchId}));
    },saved);
  }}>
    <DefinitionFields value={value} />{!value&&<><ResourceError error={branches.error} reload={branches.reload} /><ActiveBranchSelect branches={branches.data??[]} loading={branches.loading} value={branchId} onChange={setBranchId} />{!branches.loading&&!branches.error&&!branches.data?.some(branch=>branch.status==="active")&&<p>أضف فرعًا نشطًا من صفحة الفروع أولًا.</p>}</>}
  </WarehouseDialog>;
}
export function WarehouseDetailsPage(){const {id=""}=useParams();return <ReadAccess><WarehouseDetails key={id} id={id} /></ReadAccess>;}
function WarehouseDetails({id}:{id:string}) {
  const details=useResource(()=>api().get({id}),[id]),{can}=useSession(),action=useWarehouseAction();
  const [dialog,setDialog]=useState<"edit"|"status"|"reassign"|null>(null),[branchId,setBranchId]=useState("");
  const branches=useResource(loadBranches,[dialog==="reassign"]);
  const reload=()=>{setDialog(null);if(action.conflict)action.clear();details.reload();};
  const data=details.data;
  return <section dir="rtl" className="warehouse-page">
    <nav className="warehouse-breadcrumbs" aria-label="مسار الصفحة"><Link to="/warehouses">المخازن</Link><span> / </span><span>{data?.warehouse.name??"تفاصيل المخزن"}</span></nav>
    <PageTitle title={data?.warehouse.name??"تفاصيل المخزن"} description="بيانات المخزن والفرع المالك والموقع الافتراضي." />
    <Feedback action={action} reload={reload} /><ResourceError error={details.error} reload={details.reload} />
    {details.loading?<LoadingState />:data&&<>
      <div className="warehouse-toolbar"><Link className="button button-primary" to={`/warehouses/${id}/locations`}>استكشاف مواقع التخزين</Link>
        {can("warehouse")&&<Button onClick={()=>{action.clear();setDialog("edit");}}>تعديل المخزن</Button>}
        {can("warehouse.status")&&<Button onClick={()=>{action.clear();setDialog("status");}}>{data.warehouse.status==="active"?"تعطيل المخزن":"تفعيل المخزن"}</Button>}
        {can("warehouse.reassign")&&<Button onClick={()=>{action.clear();setBranchId("");setDialog("reassign");}}>نقل تبعية الفرع</Button>}
      </div>
      <div className="detail-layout"><article className="panel detail-panel"><h3>بيانات المخزن</h3><StatusBadge status={data.warehouse.status} /><dl className="warehouse-metadata">
        {[["الرمز",data.warehouse.code],["الفرع المالك",data.branch.name],["الوصف",data.warehouse.description],["العنوان",data.warehouse.address]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||"—"}</dd></div>)}
      </dl><Link to={`/warehouses?branch=${data.branch.id}`}>عرض مخازن الفرع</Link></article>
      <article className="panel detail-panel"><h3>الموقع الافتراضي</h3><strong>{data.defaultLocation.name} · {data.defaultLocation.code}</strong><p><StatusBadge status={data.defaultLocation.status} /></p><p className="muted-text">موقع جذري محمي وقابل للتخزين. تتبع حالته حالة المخزن، ولا يمكن نقله أو تغيير قابليته للتخزين.</p><p className="count-rule">{EXACT_COUNT_NOTICE}</p></article></div>
      {dialog==="edit"&&can("warehouse")&&<WarehouseEditor value={data.warehouse} action={action} close={()=>setDialog(null)} reload={details.reload} saved={()=>{setDialog(null);details.reload();}} />}
      {dialog==="status"&&can("warehouse.status")&&<WarehouseDialog title="تغيير حالة المخزن" action={action} reload={reload} submitLabel="تأكيد تغيير الحالة" onClose={()=>setDialog(null)} onSubmit={event=>{
        event.preventDefault();void action.run(()=>api().setStatus({id,status:data.warehouse.status==="active"?"inactive":"active",expectedVersion:data.warehouse.version}),reload);
      }}><p>هل تريد {data.warehouse.status==="active"?"تعطيل":"تفعيل"} «{data.warehouse.name}»؟</p><p>التعطيل يتطلب إخلاء الأرصدة وإنهاء المستندات والجرد وتعطيل المواقع غير الافتراضية. لا تُنقل أي كمية تلقائيًا.</p></WarehouseDialog>}
      {dialog==="reassign"&&can("warehouse.reassign")&&<WarehouseDialog title="نقل تبعية المخزن" action={action} reload={reload} submitLabel="تأكيد نقل التبعية" submitDisabled={!branchId||branchId===data.branch.id||!!branches.error} onClose={()=>setDialog(null)} onSubmit={event=>{
        event.preventDefault();void action.run(()=>api().reassign({id,branchId,expectedVersion:data.warehouse.version}),reload);
      }}><p>الفرع الحالي: <strong>{data.branch.name}</strong></p><p className="muted-text">يجب تعطيل المخزن أولًا. قد يمنع سجل الحركات التاريخي أو المخزون أو المستندات أو الجرد نقل التبعية.</p><ResourceError error={branches.error} reload={branches.reload} /><ActiveBranchSelect branches={branches.data??[]} loading={branches.loading} value={branchId} onChange={setBranchId} /></WarehouseDialog>}
    </>}
  </section>;
}
