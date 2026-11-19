import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  BarcodeLabel,
  BarcodeView,
  PackagingListItem,
  Page,
  ProductLookup,
  RecordStatus,
  Unit,
  VariantListItem,
  VariantView
} from "../../shared/catalog/types";
import {
  Button,
  DataTable,
  Dialog,
  FilterBar,
  ListPagination,
  Notice,
  PageTitle,
  SearchField,
  SearchStatusFilter,
  StatusBadge,
  confirmDelete,
  errorMessage,
  unitDimensionLabel
} from "../ui";
import { attributesText, parseAttributes } from "../shared/attributes";

export function VariantsPage() {
  const [page, setPage] = useState<Page<VariantListItem> | null>(null);
  const [products, setProducts] = useState<ProductLookup[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | RecordStatus>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [editing, setEditing] = useState<VariantView | null | false>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [result, productList, unitList] = await Promise.all([
        window.warehouse.catalog.variants.list({
          page: currentPage, pageSize: 20, search: search || null,
          status: status === "all" ? null : status
        }),
        window.warehouse.catalog.products.lookup(),
        window.warehouse.catalog.units.lookup()
      ]);
      setPage(result);
      setProducts(productList);
      setUnits(unitList);
      setError(null);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [currentPage, search, status]);

  const openNew = () => setEditing({
    id: "", productId: "", sku: "", name: "", baseUnitId: "", baseUnitName: "", baseUnitSymbol: "",
    status: "active", attributes: [], packaging: [], barcodes: []
  });
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const sku = String(form.get("sku") ?? "");
    const baseUnitId = String(form.get("baseUnitId") ?? "");
    const attributes = parseAttributes(String(form.get("attributes") ?? ""));
    try {
      if (editing && editing.id) {
        await window.warehouse.catalog.variants.update({ id: editing.id, name, sku, baseUnitId, attributes });
      } else {
        await window.warehouse.catalog.variants.create({
          productId: String(form.get("productId") ?? ""), name, sku,
          baseUnitId: baseUnitId || null, attributes
        });
      }
      setEditing(false);
      setSuccess(editing && editing.id ? "تم تحديث المتغير." : "تمت إضافة المتغير.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const openEdit = async (id: string) => {
    try { setEditing(await window.warehouse.catalog.variants.get({ id })); }
    catch (caught) { setError(errorMessage(caught)); }
  };
  const toggle = async (item: VariantListItem) => {
    try {
      if (item.status === "active") await window.warehouse.catalog.variants.deactivate({ id: item.id });
      else await window.warehouse.catalog.variants.activate({ id: item.id });
      setSuccess("تم تحديث حالة المتغير.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const remove = async (item: VariantListItem) => {
    if (!confirmDelete(`هل تريد حذف المتغير «${item.name}»؟`)) return;
    try {
      await window.warehouse.catalog.variants.delete({ id: item.id });
      setSuccess("تم حذف المتغير.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const availableProducts = products.filter((item) => item.productType === "with_variants" && item.status === "active");

  return <section>
    <PageTitle title="متغيرات الأصناف" description="إدارة الأكواد والخصائص المستقلة لكل متغير."
      action={<Button variant="primary" onClick={openNew}>إضافة متغير</Button>} />
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <SearchStatusFilter
      search={search}
      onSearch={(value) => { setSearch(value); setCurrentPage(1); }}
      status={status}
      onStatus={(value) => { setStatus(value); setCurrentPage(1); }}
      searchPlaceholder="اسم أو كود المتغير"
    />
    <DataTable
      loading={loading}
      rows={page?.items ?? []}
      rowKey={(item) => item.id}
      empty="لا توجد متغيرات مطابقة."
      columns={[
        { key: "name", header: "المتغير", render: (item) => item.name },
        { key: "product", header: "الصنف", render: (item) => item.productName },
        { key: "sku", header: "الكود", dir: "ltr", render: (item) => item.sku },
        { key: "attributes", header: "الخصائص", render: (item) => item.attributeSummary },
        { key: "unit", header: "الوحدة", render: (item) => item.baseUnitName },
        { key: "status", header: "الحالة", render: (item) => <StatusBadge status={item.status} /> },
        {
          key: "actions",
          header: "الإجراءات",
          className: "row-actions",
          render: (item) => (
            <>
              <Button variant="quiet" onClick={() => void openEdit(item.id)}>تعديل</Button>
              <Button variant="quiet" onClick={() => void toggle(item)}>{item.status === "active" ? "تعطيل" : "تفعيل"}</Button>
              <Button variant="quiet" onClick={() => void remove(item)}>حذف</Button>
            </>
          )
        }
      ]}
    />
    {page && <ListPagination page={page} currentPage={currentPage} onPage={setCurrentPage} />}
    {editing && <Dialog
      title={editing.id ? "تعديل المتغير" : "إضافة متغير"}
      onClose={() => setEditing(false)}
      onSubmit={save}
      error={error}
    >
      {!editing.id && <label>الصنف<select name="productId" required defaultValue="">
        <option value="">اختر صنفًا بمتغيرات</option>{availableProducts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}
      </select></label>}
      <label>اسم المتغير<input name="name" required defaultValue={editing.name} /></label>
      <label>كود المتغير<input name="sku" required dir="ltr" defaultValue={editing.sku} /></label>
      <label>الوحدة الأساسية<select name="baseUnitId" required={!editing.id} defaultValue={editing.baseUnitId}>
        <option value="">استخدام وحدة الصنف</option>{units.filter((item) => item.status === "active" || item.id === editing.baseUnitId)
          .map((item) => <option key={item.id} value={item.id}>{item.name} ({item.symbol}) · {unitDimensionLabel(item.dimension)}</option>)}
      </select></label>
      <label>الخصائص<input name="attributes" required placeholder="اللون=أحمر، المقاس=M" defaultValue={attributesText(editing.attributes)} /></label>
    </Dialog>}
  </section>;
}

export function PackagingPage() {
  const [page, setPage] = useState<Page<PackagingListItem> | null>(null);
  const [products, setProducts] = useState<ProductLookup[]>([]);
  const [variants, setVariants] = useState<VariantListItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [editing, setEditing] = useState<PackagingListItem | null | false>(false);
  const [ownerType, setOwnerType] = useState<"product" | "variant">("product");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | RecordStatus>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [result, productList, variantPage, unitList] = await Promise.all([
        window.warehouse.catalog.packaging.list({
          page: currentPage, pageSize: 20, search: search || null,
          status: status === "all" ? null : status
        }),
        window.warehouse.catalog.products.lookup(),
        window.warehouse.catalog.variants.list({ page: 1, pageSize: 100 }),
        window.warehouse.catalog.units.lookup()
      ]);
      setPage(result);
      setProducts(productList);
      setVariants(variantPage.items);
      setUnits(unitList);
      setError(null);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [currentPage, search, status]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const unitId = String(form.get("unitId") ?? "");
    const conversionFactor = String(form.get("conversionFactor") ?? "");
    try {
      if (editing && editing.id) {
        await window.warehouse.catalog.packaging.update({ id: editing.id, unitId, conversionFactor });
      } else {
        await window.warehouse.catalog.packaging.add({
          ownerType,
          ownerId: String(form.get("ownerId") ?? ""),
          unitId,
          conversionFactor
        });
      }
      setEditing(false);
      setSuccess(editing && editing.id ? "تم تحديث وحدة التعبئة." : "تمت إضافة وحدة التعبئة.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const toggle = async (item: PackagingListItem) => {
    try {
      if (item.status === "active") await window.warehouse.catalog.packaging.deactivate({ id: item.id });
      else await window.warehouse.catalog.packaging.activate({ id: item.id });
      setSuccess("تم تحديث حالة وحدة التعبئة.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const remove = async (item: PackagingListItem) => {
    if (!confirmDelete(`هل تريد حذف وحدة التعبئة «${item.unitName}»؟`)) return;
    try {
      await window.warehouse.catalog.packaging.delete({ id: item.id });
      setSuccess("تم حذف وحدة التعبئة.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const owners = ownerType === "product"
    ? products.filter((item) => item.status === "active" && item.productType === "simple").map((item) => ({ id: item.id, label: `${item.name} · ${item.sku}` }))
    : variants.filter((item) => item.status === "active").map((item) => ({ id: item.id, label: `${item.productName} · ${item.name} · ${item.sku}` }));

  return <section>
    <PageTitle title="وحدات التعبئة" description="تعريف عوامل التحويل الخاصة بكل صنف أو متغير."
      action={<Button variant="primary" onClick={() => { setEditing(null); setOwnerType("product"); }}>إضافة وحدة تعبئة</Button>} />
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <SearchStatusFilter
      search={search}
      onSearch={(value) => { setSearch(value); setCurrentPage(1); }}
      status={status}
      onStatus={(value) => { setStatus(value); setCurrentPage(1); }}
      searchPlaceholder="الصنف أو وحدة القياس"
    />
    <DataTable
      loading={loading}
      rows={page?.items ?? []}
      rowKey={(item) => item.id}
      empty="لا توجد وحدات تعبئة معرفة."
      columns={[
        { key: "owner", header: "المالك", render: (item) => item.ownerName },
        { key: "unit", header: "وحدة التعبئة", render: (item) => `${item.unitName} (${item.unitSymbol})` },
        { key: "factor", header: "عامل التحويل", render: (item) => item.factorLabel },
        { key: "status", header: "الحالة", render: (item) => <StatusBadge status={item.status} /> },
        {
          key: "actions",
          header: "الإجراءات",
          className: "row-actions",
          render: (item) => (
            <>
              <Button variant="quiet" onClick={() => setEditing(item)}>تعديل</Button>
              <Button variant="quiet" onClick={() => void toggle(item)}>{item.status === "active" ? "تعطيل" : "تفعيل"}</Button>
              <Button variant="quiet" onClick={() => void remove(item)}>حذف</Button>
            </>
          )
        }
      ]}
    />
    {page && <ListPagination page={page} currentPage={currentPage} onPage={setCurrentPage} />}
    {editing !== false && editing !== null && <Dialog
      title={editing?.id ? "تعديل وحدة التعبئة" : "إضافة وحدة تعبئة"}
      onClose={() => setEditing(false)}
      onSubmit={save}
      error={error}
    >
      {!editing?.id && <>
        <label>نوع المالك<select value={ownerType} onChange={(event) => setOwnerType(event.target.value as "product" | "variant")}>
          <option value="product">صنف عادي</option><option value="variant">متغير</option>
        </select></label>
        <label>الصنف أو المتغير<select name="ownerId" required defaultValue="">
          <option value="">اختر المالك</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.label}</option>)}
        </select></label>
      </>}
      <label>وحدة التعبئة<select name="unitId" required defaultValue={editing?.unitId ?? ""}>
        <option value="">اختر وحدة قياس</option>{units.filter((unit) => unit.status === "active" || unit.id === editing?.unitId)
          .map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol}) · {unitDimensionLabel(unit.dimension)}</option>)}
      </select></label>
      <label>عدد وحدات الأساس في وحدة التعبئة<input name="conversionFactor" required inputMode="decimal" defaultValue={editing?.factorLabel ?? "1"} /></label>
    </Dialog>}
  </section>;
}

export function BarcodesPage() {
  const [page, setPage] = useState<Page<BarcodeView> | null>(null);
  const [products, setProducts] = useState<ProductLookup[]>([]);
  const [variants, setVariants] = useState<VariantListItem[]>([]);
  const [packaging, setPackaging] = useState<PackagingListItem[]>([]);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [targetType, setTargetType] = useState<"product" | "variant">("product");
  const [targetId, setTargetId] = useState("");
  const [findCode, setFindCode] = useState("");
  const [lookup, setLookup] = useState<{ barcode: BarcodeView; product: { product: { name: string; sku: string }; variants: VariantView[] } } | null>(null);
  const [label, setLabel] = useState<BarcodeLabel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [result, productList, variantPage, packagingPage] = await Promise.all([
        window.warehouse.catalog.barcodes.list({ page: currentPage, pageSize: 20, search: search || null }),
        window.warehouse.catalog.products.lookup(),
        window.warehouse.catalog.variants.list({ page: 1, pageSize: 100 }),
        window.warehouse.catalog.packaging.list({ page: 1, pageSize: 100 })
      ]);
      setPage(result);
      setProducts(productList);
      setVariants(variantPage.items);
      setPackaging(packagingPage.items);
      setError(null);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [currentPage, search]);

  const targetOptions = targetType === "product"
    ? products.filter((item) => item.status === "active" && item.productType === "simple").map((item) => ({ id: item.id, label: `${item.name} · ${item.sku}` }))
    : variants.filter((item) => item.status === "active").map((item) => ({ id: item.id, label: `${item.productName} · ${item.name} · ${item.sku}` }));
  const availablePackaging = packaging.filter((item) => item.status === "active" &&
    (targetType === "product" ? item.ownerType === "product" && item.ownerId === targetId : item.ownerType === "variant" && item.ownerId === targetId));

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await window.warehouse.catalog.barcodes.add({
        code: String(form.get("code") ?? ""),
        productId: targetType === "product" ? targetId : null,
        variantId: targetType === "variant" ? targetId : null,
        packagingUnitId: String(form.get("packagingUnitId") ?? "") || null
      });
      setShowAdd(false);
      setSuccess("تمت إضافة الباركود.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const remove = async (item: BarcodeView) => {
    if (!confirmDelete(`هل تريد حذف الباركود ${item.code}؟`)) return;
    try {
      await window.warehouse.catalog.barcodes.delete({ id: item.id });
      setSuccess("تم حذف الباركود.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const find = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = await window.warehouse.catalog.barcodes.find({ code: findCode });
      setLookup(result);
      setLabel(null);
      setError(null);
    } catch (caught) { setLookup(null); setError(errorMessage(caught)); }
  };
  const prepareLabel = async () => {
    if (!lookup) return;
    try {
      setLabel(await window.warehouse.catalog.barcodes.label({ code: lookup.barcode.code }));
      setError(null);
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const lookupVariant = useMemo(() => lookup?.product.variants.find((item) => item.id === lookup.barcode.variantId) ?? null, [lookup]);

  return <section>
    <PageTitle title="الباركود" description="إدارة الباركود والبحث عن الصنف المرتبط به."
      action={<Button variant="primary" onClick={() => { setShowAdd(true); setTargetType("product"); setTargetId(""); }}>إضافة باركود</Button>} />
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <form className="lookup-bar panel" onSubmit={(event) => void find(event)}>
      <label>البحث بالباركود<input value={findCode} dir="ltr" onChange={(event) => setFindCode(event.target.value)} placeholder="امسح الباركود أو اكتبه" /></label>
      <Button type="submit" variant="primary">بحث</Button>
    </form>
    {lookup && <div className="panel lookup-result">
      <div><h3>{lookup.product.product.name}</h3><p>كود الصنف: <b dir="ltr">{lookup.product.product.sku}</b></p>
        {lookupVariant && <p>المتغير: {lookupVariant.name} — {attributesText(lookupVariant.attributes)}</p>}
        <p>الباركود: <b dir="ltr">{lookup.barcode.code}</b></p></div>
      <div className="row-actions"><Button onClick={() => void prepareLabel()}>تجهيز ملصق</Button>{label && <Button onClick={() => window.print()}>طباعة</Button>}</div>
      {label && <div className="barcode-label"><strong>{label.productName}</strong><span>{label.variantName ?? ""}</span><b dir="ltr">{label.sku}</b><code dir="ltr">{label.code}</code><small>{label.unitLabel}</small></div>}
    </div>}
    <FilterBar>
      <SearchField
        value={search}
        onChange={(value) => { setSearch(value); setCurrentPage(1); }}
        label="بحث في القائمة"
        placeholder="رقم الباركود أو الصنف"
      />
    </FilterBar>
    <DataTable
      loading={loading}
      rows={page?.items ?? []}
      rowKey={(item) => item.id}
      empty="لا توجد باركودات مطابقة."
      columns={[
        { key: "code", header: "الباركود", dir: "ltr", render: (item) => item.code },
        { key: "product", header: "الصنف", render: (item) => item.productName },
        { key: "variant", header: "المتغير", render: (item) => item.variantName ?? "—" },
        { key: "packaging", header: "وحدة التعبئة", render: (item) => item.packagingLabel ?? "الوحدة الأساسية" },
        {
          key: "actions",
          header: "الإجراءات",
          className: "row-actions",
          render: (item) => (
            <>
              <Button variant="quiet" onClick={() => { setFindCode(item.code); void window.warehouse.catalog.barcodes.find({ code: item.code }).then(setLookup).catch((caught) => setError(errorMessage(caught))); }}>عرض</Button>
              <Button variant="quiet" onClick={() => void remove(item)}>حذف</Button>
            </>
          )
        }
      ]}
    />
    {page && <ListPagination page={page} currentPage={currentPage} onPage={setCurrentPage} />}
    {showAdd && <Dialog title="إضافة باركود" onClose={() => setShowAdd(false)} onSubmit={add} error={error}>
      <label>نوع المالك<select value={targetType} onChange={(event) => { setTargetType(event.target.value as "product" | "variant"); setTargetId(""); }}>
        <option value="product">صنف عادي</option><option value="variant">متغير</option>
      </select></label>
      <label>الصنف أو المتغير<select required value={targetId} onChange={(event) => setTargetId(event.target.value)}>
        <option value="">اختر مالكًا</option>{targetOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label>قيمة الباركود<input name="code" required dir="ltr" autoFocus /></label>
      <label>وحدة التعبئة (اختياري)<select name="packagingUnitId">
        <option value="">الوحدة الأساسية</option>{availablePackaging.map((item) => <option key={item.id} value={item.id}>{item.unitName}</option>)}
      </select></label>
    </Dialog>}
  </section>;
}
