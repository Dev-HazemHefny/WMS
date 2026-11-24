import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { StockCommand, StockLine, StockResult } from "../shared/ipc/stock";
import type { ResolvedLocationDto } from "../shared/warehouses/types";
import { EXACT_COUNT_NOTICE, warehouseError } from "./warehouses/model";
import { eligibleLocations, historicalLocationLabel, indexInventoryLocations, inventoryLocationLabel } from "./warehouses/inventory-locations";
type Row = NonNullable<StockResult["rows"]>[number];
export function InventoryPage() {
  const api = window.warehouse.inventory;
  const [items, setItems] = useState<Row[]>([]),
    [places, setPlaces] = useState<ResolvedLocationDto[]>([]),
    [docs, setDocs] = useState<Row[]>([]),
    [result, setResult] = useState<Row[]>([]);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [historical, setHistorical] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const [kind, setKind] = useState<"receipt" | "issue" | "transfer" | "count">(
      "receipt",
    ),
    [lines, setLines] = useState<StockLine[]>([]),
    [editing, setEditing] = useState<Row | null>(null);
  const [item, setItem] = useState(""),
    [location, setLocation] = useState(""),
    [dest, setDest] = useState(""),
    [qty, setQty] = useState("1");
  const refreshVersion = useRef(0);
  const itemLabels = useMemo(() => {
    const labels = new Map<Row["id"], Row["sku"]>();
    for (const row of items) {
      if (!labels.has(row.id)) labels.set(row.id, row.sku);
    }
    return labels;
  }, [items]);
  const indexedPlaces = useMemo(() => indexInventoryLocations(places), [places]);
  const eligibleLabels = indexedPlaces.labels;

  async function refresh() {
    const version = ++refreshVersion.current;
    const [i, p, d] = await Promise.all([
      api.execute({ op: "items" }),
      window.warehouse.warehouses.locations.stockable(),
      api.execute({ op: "documents" }),
    ]);
    if (version !== refreshVersion.current) return;
    setItems(i.rows ?? []);
    setPlaces(eligibleLocations(p));
    setHistorical(new Map());
    setDocs(d.rows ?? []);
  }
  useEffect(() => {
    const pending = refresh();
    const version = refreshVersion.current;
    pending.catch(error => {
      if (version === refreshVersion.current) setMessage(warehouseError(error));
    });
    return () => { refreshVersion.current++; };
  }, []);
  useEffect(() => {
    let active = true;
    const ids = [...new Set([
      location,
      dest,
      ...lines.flatMap(line => [line.location, line.destination ?? ""]),
      ...result.flatMap(row => [String(row.location ?? ""), String(row.destination ?? "")]),
    ])].filter(id => id && !eligibleLabels.has(id) && !historical.has(id));
    if (ids.length) {
      void Promise.allSettled(ids.map(id => window.warehouse.warehouses.locations.get({ id }))).then(values => {
        if (!active) return;
        const resolved = new Map(historical);
        values.forEach((value, index) => {
          resolved.set(ids[index], value.status === "fulfilled" ? historicalLocationLabel(value.value) : null);
          if (value.status === "rejected") setMessage(warehouseError(value.reason));
        });
        setHistorical(resolved);
      });
    }
    return () => { active = false; };
  }, [location, dest, lines, result, eligibleLabels, historical]);
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMessage(warehouseError(e));
    } finally {
      setBusy(false);
    }
  }
  function command(cmd: StockCommand) {
    void perform(async () => {
      const r = await api.execute(cmd);
      if (r.rows) setResult(r.rows);
      setMessage(cmd.op==="reconcile" && !r.rows?.length?"تطابق الأرصدة سجل الحركات":r.id ?? "اكتملت العملية");
    });
  }
  function display(key:string,value:Row[string]){
    if(value==null)return "—";
    if(["thousandths","expected","counted","ledger","qty"].includes(key)){
      const raw=BigInt(String(value)),absolute=raw<0n?-raw:raw,decimal=(absolute%1000n).toString().padStart(3,"0").replace(/0+$/,"");
      return (raw<0n?"−":"")+(absolute/1000n).toString()+(decimal?"."+decimal:"");
    }
    if(key==="item")return String(itemLabels.get(value)??value);
    if(key==="location"||key==="destination")return placeLabel(String(value));
    return String(value);
  }
  const labels:Record<string,string>={item:"الصنف",location:"الموقع",destination:"الوجهة",thousandths:"الكمية",expected:"المتوقع",counted:"الفعلي",qty:"الرصيد",ledger:"السجل",quantity:"الكمية المدخلة",document:"المستند",id:"المعرف",name:"الاسم",kind:"النوع",snapshot:"تفاصيل الحركة"};
  const itemChoices = useMemo(() => [
    <option key="" value="">
      اختر
    </option>,
    ...items.map((r) => (
      <option key={String(r.id)} value={String(r.id)}>
        {String(r.sku)}
        {r.warehouse ? " · " + r.warehouse : ""}
      </option>
    )),
  ], [items]);
  const locationOptions = useMemo(() => [
    <option key="" value="">اختر موقعًا قابلًا للتخزين</option>,
    ...indexedPlaces.options.map(({ id, label }) => <option key={id} value={id}>{label}</option>),
  ], [indexedPlaces]);
  const placeLabel = (id: string) => inventoryLocationLabel(id, eligibleLabels, historical);
  const unavailableOption = (id: string) => id && !eligibleLabels.has(id)
    ? <option value={id} disabled>{placeLabel(id)}</option>
    : null;
  const sourceEligible = eligibleLabels.has(location), destinationEligible = eligibleLabels.has(dest);
  return (
    <section dir="rtl" className="inventory-page">
      <div className="page-title"><div><h2>عمليات المخزون</h2><p>الاستلام والصرف والتحويل والجرد، في مساحة عمل واحدة.</p></div></div>
      {message && <p className="notice inventory-feedback" role="status">{message}</p>}
      <fieldset disabled={busy}>
        <div className="warehouse-toolbar"><Link className="button button-secondary" to="/branches">إدارة الفروع</Link><Link className="button button-secondary" to="/warehouses">إدارة المخازن ومواقع التخزين</Link><button onClick={()=>void perform(async()=>{})}>تحديث المواقع والمستندات</button></div>
        <div className="inventory-entry">
        <label>
          العملية
          <select
            disabled={!!editing}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setLines([]);
            }}
          >
            <option value="receipt">استلام</option>
            <option value="issue">صرف</option>
            <option value="transfer">تحويل</option>
            <option value="count">جرد</option>
          </select>
        </label>
        <label>
          {kind==="transfer"?"الموقع المصدر":"الموقع"}
          <select
            value={location}
            disabled={!!editing&&kind==="count"}
            onChange={(e) => setLocation(e.target.value)}
          >
            {locationOptions}
            {unavailableOption(location)}
          </select>
        </label>
        {kind === "transfer" && (
          <label>
            الموقع الوجهة
            <select value={dest} onChange={(e) => setDest(e.target.value)}>
              {locationOptions}
              {unavailableOption(dest)}
            </select>
          </label>
        )}
        <label>
          الصنف
          <select value={item} onChange={(e) => setItem(e.target.value)}>
            {itemChoices}
          </select>
        </label>
        <label>
          الكمية بالوحدة الأساسية
          <input value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <button
          disabled={!item || !sourceEligible || (kind==="transfer"&&(!destinationEligible||location===dest)) || (kind==="count" && !editing)}
          onClick={() =>
            setLines([
              ...lines,
              {
                item,
                location,
                quantity: qty,
                ...(kind === "transfer" ? { destination: dest } : {}),
              },
            ])
          }
        >
          إضافة سطر
        </button>
        </div>
        {kind==="count"&&<p className="notice inventory-feedback">{EXACT_COUNT_NOTICE}</p>}
        {location&&!sourceEligible&&<p className="notice notice-error">{placeLabel(location)}. أعد تفعيل الموقع من إدارة المخازن أو راجع المسودة. لم يُستبدل الموقع تلقائيًا.</p>}
        <ul className="inventory-lines">
          {lines.map((l, i) => (
            <li key={i}>
              <span>{itemLabels.get(l.item) ?? l.item} · {l.quantity}<small className="warehouse-secondary">{placeLabel(l.location)}{l.destination&&` ← ${placeLabel(l.destination)}`}</small></span>
              <button onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                حذف
              </button>
            </li>
          ))}
        </ul>
        <button
          disabled={!editing&&(kind==="count"?!sourceEligible:!lines.length)}
          onClick={() =>
            void perform(async () => {
              const r = await api.execute(
                editing
                  ? {
                      op: "edit",
                      document: String(editing.id),
                      version: Number(editing.version),
                      lines,
                    }
                  : kind === "count"
                    ? { op: "count", location }
                    : { op: "draft", kind, lines },
              );
              setLines([]);
              setEditing(null);
              setMessage(String(r.id));
            })
          }
        >
          {editing
            ? "حفظ التعديل"
            : kind === "count"
              ? "بدء الجرد وقفل الموقع"
              : "حفظ مسودة"}
        </button>
        {editing&&<button onClick={()=>{setEditing(null);setLines([]);}}>إغلاق تعديل المسودة</button>}
        <div className="table-wrap inventory-documents"><table>
          <thead>
            <tr>
              <th>المستند</th>
              <th>النوع</th>
              <th>الحالة</th>
              <th>العمليات</th>
            </tr>
          </thead>
          <tbody>
            {!docs.length && <tr><td colSpan={4} className="inventory-empty">لا توجد مستندات بعد. أنشئ مسودة لتسجيل أول حركة مخزنية.</td></tr>}
            {docs.map((d) => {
              const document = String(d.id),
                version = Number(d.version);
              return (
                <tr key={document}>
                  <td>{document}</td>
                  <td>{{receipt:"استلام",issue:"صرف",transfer:"تحويل",count:"جرد",reversal:"عكس"}[String(d.kind)]}</td>
                  <td>{{draft:"مسودة",posted:"معتمد",review:"قيد المراجعة",cancelled:"ملغى"}[String(d.state)]}</td>
                  <td>
                    <button onClick={()=>command({op:"details",document})}>تفاصيل</button>
                    {d.state === "draft" && (
                      <button
                        onClick={() => {
                          setEditing(d);
                          const draftLines=JSON.parse(String(d.lines)) as StockLine[];
                          setLocation(d.location?String(d.location):draftLines[0]?.location??"");
                          setDest(draftLines[0]?.destination??"");
                          setKind(d.kind as typeof kind);
                          setLines(draftLines);
                        }}
                      >
                        تعديل
                      </button>
                    )}
                    {d.state === "draft" && d.kind === "count" ? (
                      <button
                        onClick={() =>
                          command({ op: "review", document, version })
                        }
                      >
                        مراجعة
                      </button>
                    ) : (
                      (d.state === "draft" || d.state === "review") && (
                        <button
                          onClick={() =>
                            command({
                              op: "post",
                              document,
                              version,
                              command: "post:" + document + ":" + version,
                            })
                          }
                        >
                          اعتماد
                        </button>
                      )
                    )}
                    {(d.state === "draft" || d.state === "review") && (
                      <button
                        onClick={() =>
                          command({ op: "cancel", document, version })
                        }
                      >
                        إلغاء
                      </button>
                    )}
                    {d.state === "posted" && d.kind !== "reversal" && (
                      <button
                        onClick={() =>
                          command({
                            op: "reverse",
                            document,
                            command: "reverse:" + document,
                          })
                        }
                      >
                        عكس المستند
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <button onClick={()=>{if(window.confirm("إنشاء نسخة احتياطية وإعادة احتساب الأرصدة من الحركات؟"))command({op:"rebuild"})}}>إعادة احتساب الأرصدة</button>
        <button onClick={() => command({ op: "balances" })}>الأرصدة</button>
        <button onClick={() => command({ op: "reconcile" })}>
          مطابقة السجل
        </button>
        <button
          disabled={!item}
          onClick={() => command({ op: "history", item })}
        >
          حركات الصنف
        </button>
        <button
          onClick={() =>
            void perform(async () =>
              setMessage(
                (await window.warehouse.recovery.backup()) ?? "تم الإلغاء",
              ),
            )
          }
        >
          نسخة احتياطية
        </button>
        <button
          onClick={() => {
            if (
              window.confirm(
                "استبدال البيانات بنسخة احتياطية وإعادة تشغيل التطبيق؟",
              )
            )
              void perform(async () => {
                await window.warehouse.recovery.restore();
              });
          }}
        >
          استعادة نسخة
        </button>
        <table>
          <tbody>
            {result.map((r, i) => (
              <tr key={i}>
                {Object.entries(r).map(([key, value]) => (
                  <td key={key}>
                    {labels[key]??key}: {display(key,value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
    </section>
  );
}
