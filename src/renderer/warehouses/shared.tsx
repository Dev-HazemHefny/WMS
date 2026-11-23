import { useEffect, useRef, useState, type DependencyList, type ReactNode } from "react";
import { ClientError } from "../../shared/ipc/client-error";
import type { z } from "zod";
import type { BranchDto, WarehouseDto } from "../../shared/warehouses/types";
import { Button, Dialog, LoadingState, Notice } from "../ui";
import { useSession } from "../session-context";
import { failureCode, warehouseError } from "./model";

export function useResource<T>(load:()=>Promise<T>, dependencies:DependencyList) {
  const [data,setData] = useState<T|null>(null), [loading,setLoading] = useState(true), [error,setError] = useState("");
  const [revision,setRevision] = useState(0);
  const loader = useRef(load); loader.current=load;
  useEffect(()=>{
    let active=true;
    setLoading(true); setError("");
    loader.current().then(value=>{if(active)setData(value);}).catch(caught=>{if(active){setData(null);setError(warehouseError(caught));}}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  }, [...dependencies,revision]);
  return {data,loading,error,reload:()=>setRevision(value=>value+1)};
}
export function useWarehouseAction() {
  const [busy,setBusy]=useState(false), [error,setError]=useState(""), [success,setSuccess]=useState(""), [conflict,setConflict]=useState(false);
  const {refreshCapabilities}=useSession();
  const inFlight=useRef(false);
  async function run(work:()=>Promise<unknown>, done?:()=>void) {
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError("");setSuccess("");setConflict(false);
    try {await work();setSuccess("تم حفظ التغييرات بنجاح.");done?.();}
    catch(caught){
      const code=failureCode(caught);setError(warehouseError(caught));setConflict(code==="VERSION_CONFLICT");
      if(code==="FORBIDDEN"||code==="AUTH_REQUIRED"){
        try {await refreshCapabilities();} catch(refreshError){setError(warehouseError(refreshError));}
      }
    } finally {inFlight.current=false;setBusy(false);}
  }
  return {busy,error,success,conflict,run,clear:()=>{setError("");setSuccess("");setConflict(false);}};
}
export function Feedback({action,reload}:{action:ReturnType<typeof useWarehouseAction>;reload:()=>void}) {
  return <>{action.error&&<Notice kind="error">{action.error}{action.conflict&&<Button onClick={reload}>إعادة تحميل البيانات الحالية</Button>}</Notice>}{action.success&&<Notice kind="success">{action.success}</Notice>}</>;
}
export function ReadAccess({children}:{children:ReactNode}) {
  const {can}=useSession();
  return can("read")?<>{children}</>:<Notice kind="error">لا تملك صلاحية عرض بيانات المخازن.</Notice>;
}
export function ResourceError({error,reload}:{error:string;reload:()=>void}) {
  return error?<Notice kind="error">{error} <Button onClick={reload}>إعادة المحاولة</Button></Notice>:null;
}
export function WarehouseDialog(props:Parameters<typeof Dialog>[0]&{action:ReturnType<typeof useWarehouseAction>;reload:()=>void}) {
  return <Dialog {...props} error={props.action.error} submitLabel={props.action.busy?"جارٍ الحفظ…":props.submitLabel} submitDisabled={props.action.busy||props.action.conflict||props.submitDisabled} onClose={props.action.busy?undefined:props.onClose}>
    {props.action.conflict&&<Button onClick={props.reload}>إعادة تحميل البيانات الحالية</Button>}
    <fieldset className="warehouse-fields" disabled={props.action.busy}>{props.children}</fieldset>
  </Dialog>;
}
export function DefinitionFields({value,branch=false}:{value?:BranchDto|WarehouseDto|null;branch?:boolean}) {
  const details=value as BranchDto|undefined;
  return <>
    <label>الرمز<input name="code" required maxLength={32} pattern="[A-Za-z0-9_-]+" dir="ltr" defaultValue={value?.code} title="حروف إنجليزية وأرقام وشرطة فقط" /></label>
    <label>الاسم<input name="name" required maxLength={120} defaultValue={value?.name} /></label>
    <label>الوصف<textarea name="description" maxLength={2000} rows={3} defaultValue={value?.description??""} /></label>
    <label>العنوان<input name="address" maxLength={500} defaultValue={value?.address??""} /></label>
    {branch&&<><label>الهاتف<input name="phone" maxLength={40} type="tel" defaultValue={details?.phone??""} /></label><label>اسم مسؤول التواصل<input name="contactName" maxLength={120} defaultValue={details?.contactName??""} /></label></>}
  </>;
}
export function definitionInput(form:HTMLFormElement,branch=false) {
  const values=new FormData(form), text=(key:string)=>String(values.get(key)??"");
  return {code:text("code"),name:text("name"),description:text("description")||null,address:text("address")||null,...(branch?{phone:text("phone")||null,contactName:text("contactName")||null}:{})};
}
export function validated<S extends z.ZodTypeAny>(schema:S,input:unknown):z.output<S> {
  const parsed=schema.safeParse(input);
  if(!parsed.success)throw new ClientError("VALIDATION_ERROR","راجع الحقول المطلوبة وأطوال النصوص.");
  return parsed.data;
}
export function ActiveBranchSelect({value,onChange,branches,loading}:{value:string;onChange:(id:string)=>void;branches:readonly BranchDto[];loading:boolean}) {
  return <label>الفرع المالك<select name="branchId" required value={value} onChange={event=>onChange(event.target.value)} disabled={loading}>
    <option value="">اختر فرعًا نشطًا</option>{branches.filter(branch=>branch.status==="active").map(branch=><option value={branch.id} key={branch.id}>{branch.name} · {branch.code}</option>)}
  </select>{loading&&<LoadingState />}</label>;
}
/** Iterate pages without assuming a lookup endpoint or truncating a branch selector. */
export async function loadBranches():Promise<BranchDto[]> {
  const items:BranchDto[]=[];
  for(let page=1;;page++){
    const result=await window.warehouse.warehouses.branches.list({page,pageSize:100});
    items.push(...result.items);
    if(items.length>=result.total||!result.items.length)return items;
  }
}
