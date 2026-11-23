import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { LocationType, ResolvedLocationDto, StorageLocationDto } from "../../shared/warehouses/types";
import { locationCreate, locationUpdate } from "../../shared/warehouses/schemas";
import { Button, EmptyState, ListPagination, LoadingState, Notice, PageTitle, StatusBadge } from "../ui";
import { useSession } from "../session-context";
import { EXACT_COUNT_NOTICE, locationTypes, visibleLocations, warehouseError } from "./model";
import { Feedback, ReadAccess, ResourceError, WarehouseDialog, useResource, useWarehouseAction, validated } from "./shared";
import { ParentPicker, type ParentChoice } from "./parent-picker";

const api=()=>window.warehouse.warehouses.locations;
export function LocationExplorer(){const {id=""}=useParams();return <ReadAccess><Explorer key={id} warehouseId={id} /></ReadAccess>;}
type Operation={kind:"create";parent:ParentChoice}|{kind:"edit"|"reparent"|"status";value:ResolvedLocationDto};
function Explorer({warehouseId}:{warehouseId:string}) {
  const {can}=useSession(),action=useWarehouseAction();
  const warehouse=useResource(()=>window.warehouse.warehouses.warehouses.get({id:warehouseId}),[warehouseId]);
  const roots=useResource(()=>api().tree({warehouseId}),[warehouseId]);
  const [children,setChildren]=useState(new Map<string|null,readonly StorageLocationDto[]>()),[expanded,setExpanded]=useState(new Set<string>());
  const [selected,setSelected]=useState<string|null>(null),[treeBusy,setTreeBusy]=useState(false),[treeError,setTreeError]=useState("");
  const [operation,setOperation]=useState<Operation|null>(null),[search,setSearch]=useState(""),[page,setPage]=useState(1);
  const details=useResource(()=>selected?api().get({id:selected}):Promise.resolve(null),[selected]);
  const results=useResource(()=>search.trim()?api().list({warehouseId,search,page,pageSize:10}):Promise.resolve(null),[warehouseId,search,page]);
  const epoch=useRef(0);
  useEffect(()=>()=>{++epoch.current;},[]);
  useEffect(()=>{if(roots.data){++epoch.current;setChildren(new Map([[null,roots.data]]));setExpanded(new Set());setTreeBusy(false);}},[roots.data]);
  async function toggle(value:StorageLocationDto) {
    if(expanded.has(value.id)){setExpanded(current=>{const next=new Set(current);next.delete(value.id);return next;});return;}
    const request=epoch.current;setTreeBusy(true);setTreeError("");
    try {
      const nested=children.get(value.id)??await api().tree({warehouseId,parentId:value.id});
      if(request===epoch.current){setChildren(current=>new Map(current).set(value.id,nested));setExpanded(current=>new Set(current).add(value.id));}
    }catch(caught){if(request===epoch.current)setTreeError(warehouseError(caught));}
    finally{if(request===epoch.current)setTreeBusy(false);}
  }
  async function reveal(id:string) {
    const request=++epoch.current;setTreeBusy(true);setTreeError("");
    try {
      const path=await api().path({id});
      const groups=new Map(children),open=new Set(expanded);
      // Only the ancestor chain is loaded; unrelated descendants stay unloaded.
      for(const parentId of [null,...path.slice(0,-1).map(node=>node.id)]){
        if(!groups.has(parentId))groups.set(parentId,await api().tree({warehouseId,parentId}));
        if(parentId!==null)open.add(parentId);
        if(request!==epoch.current)return;
      }
      if(request===epoch.current){setChildren(groups);setExpanded(open);setSelected(id);}
    }catch(caught){if(request===epoch.current)setTreeError(warehouseError(caught));}
    finally{if(request===epoch.current)setTreeBusy(false);}
  }
  const reload=()=>{++epoch.current;setOperation(null);if(action.conflict)action.clear();roots.reload();details.reload();results.reload();warehouse.reload();};
  const open=(value:Operation)=>{action.clear();setOperation(value);};
  const current=details.data;
  const rows=visibleLocations(children,expanded);
  const tabStop=rows.find(row=>row.value.id===selected)?.value.id??rows[0]?.value.id;
  return <section dir="rtl" className="warehouse-page">
    <nav className="warehouse-breadcrumbs" aria-label="مسار الصفحة"><Link to="/warehouses">المخازن</Link><span> / </span><Link to={`/warehouses/${warehouseId}`}>{warehouse.data?.warehouse.name??"المخزن"}</Link><span> / مواقع التخزين</span></nav>
    <PageTitle title="مواقع التخزين" description="استكشف هيكل المخزن، واختر موقعًا لعرض بياناته وإدارته." action={can("warehouse")&&<Button variant="primary" onClick={()=>open({kind:"create",parent:null})}>إضافة موقع جذري</Button>} />
    <Feedback action={action} reload={reload} /><ResourceError error={roots.error||warehouse.error||treeError} reload={reload} />
    <div className="filters"><label className="search-field">بحث في مواقع المخزن<input maxLength={200} value={search} placeholder="اسم الموقع أو رمزه" onChange={event=>{setSearch(event.target.value);setPage(1);}} /></label><Button onClick={reload}>تحديث الهيكل</Button></div>
    {search.trim()&&<div className="panel warehouse-search"><ResourceError error={results.error} reload={results.reload} />{results.loading?<LoadingState />:results.data?.items.length?<>
      <ul className="warehouse-links">{results.data.items.map(value=><li key={value.id}><Button disabled={treeBusy} onClick={()=>void reveal(value.id)}>إظهار «{value.name}» في الشجرة</Button><code>{value.code}</code><StatusBadge status={value.status} /></li>)}</ul><ListPagination page={{...results.data,items:[...results.data.items]}} currentPage={page} onPage={setPage} />
    </>:<EmptyState>لا توجد مواقع تطابق البحث.</EmptyState>}</div>}
    <div className="location-layout">
      <article className="panel location-tree-panel" aria-label="هيكل مواقع التخزين"><div className="section-heading"><h3>هيكل المخزن</h3>{treeBusy&&<span role="status">جارٍ التحميل…</span>}</div>
        {roots.loading?<LoadingState />:!rows.length?<EmptyState>لا توجد مواقع للعرض.</EmptyState>:<div role="tree" aria-label="مواقع المخزن">{rows.map(({value,depth})=><div key={value.id} role="treeitem" aria-level={depth+1} aria-selected={selected===value.id} aria-expanded={expanded.has(value.id)} className={`location-tree-row${selected===value.id?" selected":""}`} style={{paddingInlineStart:Math.min(depth,8)*14+8}}>
          <button type="button" className="tree-expander" tabIndex={-1} disabled={treeBusy} aria-label={`${expanded.has(value.id)?"طي":"توسيع"} ${value.name}`} onClick={()=>void toggle(value)}>{expanded.has(value.id)?"−":"+"}</button>
          <button type="button" data-tree-select={value.id} className="tree-location" tabIndex={tabStop===value.id?0:-1} onClick={()=>setSelected(value.id)} onKeyDown={event=>{
            if(event.key==="ArrowLeft"&&!expanded.has(value.id)){event.preventDefault();if(!treeBusy)void toggle(value);}
            if(event.key==="ArrowRight"&&expanded.has(value.id)){event.preventDefault();void toggle(value);}
            if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){
              event.preventDefault();const controls=Array.from(event.currentTarget.closest('[role="tree"]')!.querySelectorAll<HTMLButtonElement>('[data-tree-select]'));const index=controls.indexOf(event.currentTarget);
              controls[event.key==="Home"?0:event.key==="End"?controls.length-1:Math.max(0,Math.min(controls.length-1,index+(event.key==="ArrowDown"?1:-1)))]?.focus();
            }
          }}><strong>{value.name}</strong><span className="muted-text">{value.code} · {locationTypes[value.locationType]}</span><span className="location-markers"><span>{value.isStockable?"قابل للتخزين · رصيد مستقل":"تنظيمي"}</span>{value.isDefault&&<span className="default-marker">افتراضي محمي</span>}<StatusBadge status={value.status} /></span>{value.isStockable&&<small className="count-rule">{EXACT_COUNT_NOTICE}</small>}</button>
        </div>)}</div>}
        <p className="muted-text">استخدم + و− أو السهمين للتوسيع والطي، والسهمين لأعلى وأسفل للتنقل، وEnter للاختيار.</p>
      </article>
      <article className="panel detail-panel location-details" aria-label="تفاصيل الموقع">
        {!selected?<EmptyState>اختر موقعًا من الهيكل لعرض تفاصيله.</EmptyState>:<><ResourceError error={details.error} reload={details.reload} />{details.loading?<LoadingState />:current&&<>
          <nav className="warehouse-breadcrumbs" aria-label="مسار الموقع">{current.path.map((node,index)=><span key={node.id}>{index>0&&" / "}<button type="button" className="text-action" onClick={()=>setSelected(node.id)}>{node.name}</button></span>)}</nav>
          <h3>{current.location.name}</h3><StatusBadge status={current.location.status} />{!current.effectiveActive&&<Notice kind="error">الموقع غير متاح للعمليات حاليًا؛ راجع حالة المخزن والفرع والمواقع الأب.</Notice>}
          <dl className="warehouse-metadata">{[["الرمز",current.location.code],["المخزن",current.warehouse.name],["الفرع",current.branch.name],["نوع الموقع",locationTypes[current.location.locationType]],["قابلية التخزين",current.location.isStockable?"قابل للتخزين":"موقع تنظيمي"],["الموقع الافتراضي",current.location.isDefault?"نعم — محمي":"لا"]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {current.location.isStockable&&<Notice kind="success">{EXACT_COUNT_NOTICE}</Notice>}
          <div className="warehouse-toolbar"><Button disabled={treeBusy} onClick={()=>void reveal(current.location.id)}>إظهار في الشجرة</Button>
            {can("warehouse")&&<><Button disabled={!current.effectiveActive} onClick={()=>open({kind:"create",parent:{id:current.location.id,label:current.path.map(node=>node.name).join(" / ")}})}>إضافة موقع فرعي</Button><Button onClick={()=>open({kind:"edit",value:current})}>تعديل الموقع</Button></>}
            {can("warehouse.reparent")&&<Button disabled={current.location.isDefault} onClick={()=>open({kind:"reparent",value:current})}>نقل الموقع داخل المخزن</Button>}
            {can("warehouse.status")&&<Button disabled={current.location.isDefault} onClick={()=>open({kind:"status",value:current})}>{current.location.status==="active"?"تعطيل الموقع":"تفعيل الموقع"}</Button>}
          </div>{current.location.isDefault&&<p className="muted-text">الموقع الافتراضي لا يُنقل ولا تُغيّر قابليته للتخزين. غيّر حالته من صفحة المخزن.</p>}
        </>}</>}
      </article>
    </div>
    {operation&&can(operation.kind==="reparent"?"warehouse.reparent":operation.kind==="status"?"warehouse.status":"warehouse")&&<LocationOperation key={operation.kind+(operation.kind==="create"?operation.parent?.id??"root":operation.value.location.id)} warehouseId={warehouseId} operation={operation} action={action} close={()=>setOperation(null)} saved={reload} />}
  </section>;
}

function LocationOperation({warehouseId,operation,action,close,saved}:{warehouseId:string;operation:Operation;action:ReturnType<typeof useWarehouseAction>;close:()=>void;saved:()=>void}) {
  const current=operation.kind==="create"?null:operation.value.location;
  const [parent,setParent]=useState<ParentChoice>(operation.kind==="create"?operation.parent:operation.value.location.parentId?{id:operation.value.location.parentId,label:operation.value.path.slice(0,-1).map(node=>node.name).join(" / ")}:null);
  const [type,setType]=useState<LocationType>(current?.locationType??"bin"),[stockable,setStockable]=useState(current?.isStockable??true);
  return <WarehouseDialog title={{create:"إضافة موقع تخزين",edit:"تعديل الموقع",reparent:"نقل الموقع داخل المخزن",status:"تغيير حالة الموقع"}[operation.kind]} action={action} reload={saved} onClose={close} submitLabel={operation.kind==="status"?"تأكيد تغيير الحالة":"حفظ"} onSubmit={event=>{
    event.preventDefault();const values=new FormData(event.currentTarget);
    void action.run(async()=>{
      if(operation.kind==="status")return api().setStatus({id:current!.id,status:current!.status==="active"?"inactive":"active",expectedVersion:current!.version});
      if(operation.kind==="reparent")return api().reparent({id:current!.id,parentId:parent?.id??null,expectedVersion:current!.version});
      const input={code:String(values.get("code")),name:String(values.get("name")),locationType:type,isStockable:stockable};
      if(current)return api().update(validated(locationUpdate,{...input,id:current.id,expectedVersion:current.version}));
      return api().create(validated(locationCreate,{...input,warehouseId,parentId:parent?.id??null}));
    },saved);
  }}>
    {(operation.kind==="create"||operation.kind==="edit")&&<><label>الرمز<input name="code" required maxLength={32} pattern="[A-Za-z0-9_-]+" dir="ltr" defaultValue={current?.code} /></label><label>الاسم<input name="name" required maxLength={120} defaultValue={current?.name} /></label><label>نوع الموقع<select value={type} onChange={event=>setType(event.target.value as LocationType)}>{Object.entries(locationTypes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="checkbox-field"><input type="checkbox" checked={stockable} disabled={current?.isDefault} onChange={event=>setStockable(event.target.checked)} />قابل لتخزين الأصناف</label>{stockable&&<p className="count-rule">{EXACT_COUNT_NOTICE}</p>}</>}
    {(operation.kind==="create"||operation.kind==="reparent")&&<ParentPicker warehouseId={warehouseId} movingId={current?.id} value={parent} onChange={setParent} />}
    {operation.kind==="reparent"&&<p className="muted-text">النقل يغيّر التنظيم داخل المخزن فقط. لا يتغيّر معرّف الموقع أو المخزن أو رصيد المخزون أو سجل الحركات. قد يمنعه جرد مفتوح أو أب غير نشط.</p>}
    {operation.kind==="status"&&<><p>هل تريد تغيير حالة «{current!.name}»؟</p><p className="muted-text">يتحقق النظام من الأرصدة والمستندات والجرد والمواقع التابعة قبل التعطيل. لا تُنقل الأرصدة تلقائيًا.</p></>}
  </WarehouseDialog>;
}
