import { useEffect, useState } from "react";
import type { StockCommand, StockLine, StockResult } from "../shared/ipc/stock";
type Row = NonNullable<StockResult["rows"]>[number];
const api = window.warehouse.inventory;
export function InventoryPage() {
  const [items, setItems] = useState<Row[]>([]),
    [places, setPlaces] = useState<Row[]>([]),
    [docs, setDocs] = useState<Row[]>([]),
    [result, setResult] = useState<Row[]>([]);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"receipt" | "issue" | "transfer" | "count">(
      "receipt",
    ),
    [lines, setLines] = useState<StockLine[]>([]),
    [editing, setEditing] = useState<Row | null>(null);
  const [item, setItem] = useState(""),
    [location, setLocation] = useState(""),
    [dest, setDest] = useState(""),
    [qty, setQty] = useState("1");
  async function refresh() {
    const [i, p, d] = await Promise.all([
      api.execute({ op: "items" }),
      api.execute({ op: "places" }),
      api.execute({ op: "documents" }),
    ]);
    setItems(i.rows ?? []);
    setPlaces(p.rows ?? []);
    setDocs(d.rows ?? []);
  }
  useEffect(() => {
    refresh().catch((e) => setMessage(String(e)));
  }, []);
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMessage(String(e));
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
    if(key==="item")return String(items.find(i=>i.id===value)?.sku??value);
    if(key==="location"||key==="destination")return String(places.find(p=>p.id===value)?.name??value);
    return String(value);
  }
  const labels:Record<string,string>={item:"الصنف",location:"الموقع",destination:"الوجهة",thousandths:"الكمية",expected:"المتوقع",counted:"الفعلي",qty:"الرصيد",ledger:"السجل",quantity:"الكمية المدخلة",document:"المستند",id:"المعرف",name:"الاسم",kind:"النوع",snapshot:"تفاصيل الحركة"};
  const choices = (values: Row[], label: string) => [
    <option key="" value="">
      اختر
    </option>,
    ...values.map((r) => (
      <option key={String(r.id)} value={String(r.id)}>
        {String(r[label])}
        {r.warehouse ? " · " + r.warehouse : ""}
      </option>
    )),
  ];
  return (
    <section dir="rtl">
      <h2>عمليات المخزون</h2>
      <p role="status">{message}</p>
      <fieldset disabled={busy}>
        <details>
          <summary>الفروع والمخازن ومواقع التخزين</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                name = String(f.get("name")),
                parent = String(f.get("parent"));
              const op = f.get("type");
              command(
                op === "branch"
                  ? { op, name }
                  : op === "warehouse"
                    ? { op, name, branch: parent }
                    : { op: "location", name, warehouse: parent },
              );
            }}
          >
            <select name="type">
              <option value="branch">فرع</option>
              <option value="warehouse">مخزن</option>
              <option value="location">موقع</option>
            </select>
            <input name="name" required placeholder="الاسم" />
            <input name="parent" placeholder="معرّف الفرع أو المخزن" />
            <button type="button" onClick={() => command({ op: "directory" })}>
              عرض معرّفات الفروع والمخازن
            </button>
            <button>إضافة</button>
          </form>
        </details>
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
          الموقع
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            {choices(places, "name")}
          </select>
        </label>
        {kind === "transfer" && (
          <label>
            الوجهة
            <select value={dest} onChange={(e) => setDest(e.target.value)}>
              {choices(places, "name")}
            </select>
          </label>
        )}
        <label>
          الصنف
          <select value={item} onChange={(e) => setItem(e.target.value)}>
            {choices(items, "sku")}
          </select>
        </label>
        <label>
          الكمية بالوحدة الأساسية
          <input value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <button
          disabled={!item || !location || (kind==="count" && !editing)}
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
        <ul>
          {lines.map((l, i) => (
            <li key={i}>
              {items.find((r) => r.id === l.item)?.sku ?? l.item} · {l.quantity}{" "}
              <button onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                حذف
              </button>
            </li>
          ))}
        </ul>
        <button
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
        <table>
          <thead>
            <tr>
              <th>المستند</th>
              <th>النوع</th>
              <th>الحالة</th>
              <th>العمليات</th>
            </tr>
          </thead>
          <tbody>
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
                          if(d.location)setLocation(String(d.location));
                          setKind(d.kind as typeof kind);
                          setLines(JSON.parse(String(d.lines)));
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
        </table>
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
