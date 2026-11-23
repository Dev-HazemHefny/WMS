import type { ResolvedLocationDto, StorageLocationDto } from "../../shared/warehouses/types";

export const EXACT_COUNT_NOTICE = "الجرد لهذا الموقع فقط ولا يشمل المواقع الفرعية. لكل موقع رصيد مستقل.";
export const locationTypes = {zone:"منطقة",shelf:"رف",bin:"خانة",other:"أخرى"} as const;
const errors: Record<string,string> = {
  VERSION_CONFLICT:"تغيّرت البيانات منذ فتحها. أعد تحميل البيانات الحالية قبل المحاولة مجددًا.",
  FORBIDDEN:"لا تملك صلاحية تنفيذ هذا الإجراء. تم تحديث صلاحيات الجلسة.",
  AUTH_REQUIRED:"انتهت الجلسة. سجّل الدخول مجددًا.",
  STOCK_EXISTS:"تعذّر الإجراء لوجود رصيد. راجع الأرصدة أولًا؛ لن تُنقل أي كمية تلقائيًا.",
  COUNT_ACTIVE:"يوجد جرد مفتوح في النطاق المتأثر. أكمل الجرد أو ألغِه أولًا.",
  PENDING_DOCUMENTS:"توجد مستندات معلّقة مرتبطة بالموقع. راجعها قبل تغيير التعريف.",
  ACTIVE_CHILDREN:"عطّل المواقع أو المخازن التابعة أولًا قبل تعطيل هذا التعريف.",
  LOCATION_CYCLE:"لا يمكن نقل الموقع إلى نفسه أو إلى أحد المواقع التابعة له.",
  PARENT_WAREHOUSE_MISMATCH:"يجب أن يتبع الموقع الأب نفس المخزن.",
  LOCATION_INACTIVE:"الموقع أو أحد المواقع الأب غير نشط. أعد تفعيله أو راجع المسودة.",
  LOCATION_NOT_STOCKABLE:"هذا موقع تنظيمي غير مخصص لتخزين الأصناف. اختر موقعًا قابلًا للتخزين.",
  WAREHOUSE_INACTIVE:"المخزن غير نشط. راجع حالته قبل تنفيذ العملية.",
  BRANCH_INACTIVE:"الفرع غير نشط. اختر فرعًا نشطًا أو راجع حالته.",
  DEFAULT_LOCATION_PROTECTED:"الموقع الافتراضي محمي. تتغير حالته من خلال حالة المخزن.",
  DUPLICATE_CODE:"هذا الرمز مستخدم بالفعل. اختر رمزًا آخر.",
  HISTORY_EXISTS:"يوجد سجل حركات تاريخي يمنع هذا الإجراء.",
  WAREHOUSE_ACTIVE:"عطّل المخزن أولًا قبل نقل تبعيته إلى فرع آخر.",
  VALIDATION_ERROR:"راجع الحقول المطلوبة، والرمز الإنجليزي، وأطوال النصوص.",
};
export function failureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as {code?:string;message?:string};
  if (value.code) return value.code;
  // Electron contextBridge can serialize an Error without its custom code.
  const message = value.message ?? "";
  if (message.includes("تم تعديل البيانات")) return "VERSION_CONFLICT";
  if (message.includes("الصلاحية غير متاحة")) return "FORBIDDEN";
  if (message.includes("تسجيل الدخول مطلوب")) return "AUTH_REQUIRED";
  return "";
}
export function warehouseError(error: unknown): string {
  const known = errors[failureCode(error)];
  if (known) return known;
  if (error instanceof Error && /[\u0600-\u06ff]/.test(error.message)) return error.message;
  return "تعذّر إتمام الطلب. تحقق من البيانات وحاول إعادة التحميل.";
}
export function locationLabel(value: ResolvedLocationDto): string {
  return `${value.warehouse.name} · ${value.path.map(node=>node.name).join(" / ")}`;
}
/** Iterative visible rows keep UI depth independent of the JavaScript call stack. */
export function visibleLocations(children: ReadonlyMap<string|null,readonly StorageLocationDto[]>, expanded: ReadonlySet<string>) {
  const rows: {value:StorageLocationDto;depth:number}[] = [];
  const pending = [...(children.get(null) ?? [])].reverse().map(value=>({value,depth:0}));
  const seen = new Set<string>();
  while (pending.length) {
    const row = pending.pop()!;
    if (seen.has(row.value.id)) continue;
    seen.add(row.value.id); rows.push(row);
    if (expanded.has(row.value.id)) {
      const nested = children.get(row.value.id) ?? [];
      for (let i=nested.length-1;i>=0;i--) pending.push({value:nested[i],depth:row.depth+1});
    }
  }
  return rows;
}
export function validParent(candidate: ResolvedLocationDto, warehouseId:string, movingId?:string): boolean {
  return candidate.warehouse.id===warehouseId && candidate.effectiveActive && !candidate.path.some(node=>node.id===movingId);
}
