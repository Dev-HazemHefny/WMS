import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  Brand,
  Category,
  Page,
  Product,
  ProductDetails,
  ProductListItem,
  ProductType,
  RecordStatus,
  Unit,
  VariantDraft
} from "../../shared/catalog/types";
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  ListPagination,
  LoadingState,
  Notice,
  PageTitle,
  SearchField,
  StatusBadge,
  StatusSelect,
  confirmDelete,
  errorMessage,
  productTypeLabel,
  unitDimensionLabel
} from "../ui";
import { parseAttributes } from "../shared/attributes";
import { readFileAsDataUrl } from "../shared/files";

type ProductFilters = {
  search: string;
  status: "all" | RecordStatus;
  categoryId: string;
  brandId: string;
  productType: "all" | ProductType;
};

function ProductFiltersBar(props: {
  filters: ProductFilters;
  categories: Category[];
  brands: Brand[];
  onChange: (filters: ProductFilters) => void;
}) {
  const set = (key: keyof ProductFilters, value: string) => props.onChange({ ...props.filters, [key]: value });
  return (
    <FilterBar wide>
      <SearchField
        value={props.filters.search}
        onChange={(value) => set("search", value)}
        placeholder="اسم الصنف أو الكود"
      />
      <label><span>التصنيف</span><select value={props.filters.categoryId} onChange={(event) => set("categoryId", event.target.value)}>
        <option value="">كل التصنيفات</option>{props.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label><span>العلامة التجارية</span><select value={props.filters.brandId} onChange={(event) => set("brandId", event.target.value)}>
        <option value="">كل العلامات</option>{props.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label><span>النوع</span><select value={props.filters.productType} onChange={(event) => set("productType", event.target.value)}>
        <option value="all">كل الأنواع</option><option value="simple">صنف عادي</option><option value="with_variants">صنف بمتغيرات</option>
      </select></label>
      <StatusSelect value={props.filters.status} onChange={(value) => set("status", value)} />
    </FilterBar>
  );
}

export function ProductsPage() {
  const [page, setPage] = useState<Page<ProductListItem> | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProductFilters>({
    search: "", status: "all", categoryId: "", brandId: "", productType: "all"
  });
  const [currentPage, setCurrentPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [products, categoryList, brandList] = await Promise.all([
        window.warehouse.catalog.products.list({
          page: currentPage, pageSize: 20,
          search: filters.search || null,
          status: filters.status === "all" ? null : filters.status,
          categoryId: filters.categoryId || null,
          brandId: filters.brandId || null,
          productType: filters.productType === "all" ? null : filters.productType
        }),
        window.warehouse.catalog.categories.lookup(),
        window.warehouse.catalog.brands.lookup()
      ]);
      setPage(products);
      setCategories(categoryList);
      setBrands(brandList);
      setError(null);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [currentPage, filters]);

  const changeFilters = (next: ProductFilters) => {
    setFilters(next);
    setCurrentPage(1);
  };
  const toggle = async (item: ProductListItem) => {
    try {
      if (item.status === "active") await window.warehouse.catalog.products.deactivate({ id: item.id });
      else await window.warehouse.catalog.products.activate({ id: item.id });
      setSuccess("تم تحديث حالة الصنف.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const remove = async (item: ProductListItem) => {
    if (!confirmDelete(`هل تريد حذف الصنف «${item.name}»؟`)) return;
    try {
      await window.warehouse.catalog.products.delete({ id: item.id });
      setSuccess("تم حذف الصنف.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };

  return (
    <section>
      <PageTitle title="الأصناف" description="إدارة بيانات الأصناف والمتغيرات الأساسية."
        action={<Link className="button button-primary" to="/products/new">إضافة صنف</Link>} />
      {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
      <ProductFiltersBar filters={filters} categories={categories} brands={brands} onChange={changeFilters} />
      <DataTable
        loading={loading}
        rows={page?.items ?? []}
        rowKey={(item) => item.id}
        empty="لا توجد أصناف مطابقة. أضف صنفًا جديدًا للبدء."
        columns={[
          { key: "name", header: "الصنف", render: (item) => <Link className="table-link" to={`/products/${item.id}`}>{item.name}</Link> },
          { key: "sku", header: "الكود", dir: "ltr", render: (item) => item.sku },
          { key: "category", header: "التصنيف", render: (item) => item.categoryName },
          { key: "brand", header: "العلامة", render: (item) => item.brandName ?? "—" },
          { key: "unit", header: "وحدة القياس", render: (item) => `${item.baseUnitName} (${item.baseUnitSymbol})` },
          { key: "type", header: "النوع", render: (item) => productTypeLabel(item.productType) },
          { key: "status", header: "الحالة", render: (item) => <StatusBadge status={item.status} /> },
          {
            key: "actions",
            header: "الإجراءات",
            className: "row-actions",
            render: (item) => (
              <>
                <Link className="text-action" to={`/products/${item.id}`}>عرض</Link>
                <Link className="text-action" to={`/products/${item.id}/edit`}>تعديل</Link>
                <Button variant="quiet" onClick={() => void toggle(item)}>{item.status === "active" ? "تعطيل" : "تفعيل"}</Button>
                <Button variant="quiet" onClick={() => void remove(item)}>حذف</Button>
              </>
            )
          }
        ]}
      />
      {page && <ListPagination page={page} currentPage={currentPage} onPage={setCurrentPage} />}
    </section>
  );
}

type PackagingDraft = { unitId: string; conversionFactor: string };
type BarcodeDraft = { code: string; packagingUnitId: string };
type VariantFormDraft = VariantDraft & { attributesText: string };

function ProductEditor(props: { product?: ProductDetails; categories: Category[]; units: Unit[]; brands: Brand[] }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null | undefined>(undefined);
  const initialType = props.product?.product.productType ?? "simple";
  const [productType, setProductType] = useState<ProductType>(initialType);
  const [packaging, setPackaging] = useState<PackagingDraft[]>([]);
  const [barcodes, setBarcodes] = useState<BarcodeDraft[]>([]);
  const [variants, setVariants] = useState<VariantFormDraft[]>([]);

  const addPackaging = () => setPackaging((items) => [...items, { unitId: "", conversionFactor: "1" }]);
  const addBarcode = () => setBarcodes((items) => [...items, { code: "", packagingUnitId: "" }]);
  const addVariant = () => setVariants((items) => [...items, {
    name: "", sku: "", attributes: [], attributesText: "", packaging: [], barcodes: []
  }]);

  const updateVariant = (index: number, patch: Partial<VariantFormDraft>) => {
    setVariants((items) => items.map((item, current) => current === index ? { ...item, ...patch } : item));
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const productInput = {
      name: String(form.get("name") ?? ""),
      sku: String(form.get("sku") ?? ""),
      categoryId: String(form.get("categoryId") ?? ""),
      baseUnitId: String(form.get("baseUnitId") ?? ""),
      description: String(form.get("description") ?? "") || null,
      imageDataUrl,
      brandId: String(form.get("brandId") ?? "") || null,
      productType,
      allowDecimalQuantity: form.get("allowDecimalQuantity") === "on"
    };

    try {
      if (props.product) {
        await window.warehouse.catalog.products.update({ id: props.product.product.id, ...productInput });
        navigate(`/products/${props.product.product.id}`);
      } else {
        const validVariants = variants.map(({ attributesText, ...variant }) => ({
          ...variant,
          attributes: parseAttributes(attributesText)
        }));
        const result = await window.warehouse.catalog.products.create({
          ...productInput,
          packaging: productType === "simple" ? packaging : [],
          barcodes: productType === "simple" ? barcodes : [],
          variants: productType === "with_variants" ? validVariants : []
        });
        navigate(`/products/${result.product.id}`);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally { setSaving(false); }
  };

  return (
    <form className="product-form" onSubmit={(event) => void submit(event)}>
      {error && <Notice kind="error">{error}</Notice>}
      <section className="panel form-section">
        <h3>المعلومات الأساسية</h3>
        <div className="form-grid two-columns">
          <label>اسم الصنف<input name="name" required maxLength={200} defaultValue={props.product?.product.name ?? ""} /></label>
          <label>كود الصنف<input name="sku" required maxLength={64} dir="ltr" defaultValue={props.product?.product.sku ?? ""} /></label>
          <label>التصنيف الأساسي<select name="categoryId" required defaultValue={props.product?.product.categoryId ?? ""}>
            <option value="">اختر تصنيفًا</option>{props.categories.filter((item) => item.status === "active" || item.id === props.product?.product.categoryId)
              .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>وحدة القياس الأساسية<select name="baseUnitId" required defaultValue={props.product?.product.baseUnitId ?? ""}>
            <option value="">اختر وحدة قياس</option>{props.units.filter((item) => item.status === "active" || item.id === props.product?.product.baseUnitId)
              .map((item) => <option key={item.id} value={item.id}>{item.name} ({item.symbol}) · {unitDimensionLabel(item.dimension)}</option>)}
          </select></label>
          <label>العلامة التجارية<select name="brandId" defaultValue={props.product?.product.brandId ?? ""}>
            <option value="">بدون علامة تجارية</option>{props.brands.filter((item) => item.status === "active" || item.id === props.product?.product.brandId)
              .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>نوع الصنف<select value={productType} onChange={(event) => setProductType(event.target.value as ProductType)}>
            <option value="simple">صنف عادي</option><option value="with_variants">صنف بمتغيرات</option>
          </select></label>
          <label className="checkbox-field"><input name="allowDecimalQuantity" type="checkbox" defaultChecked={props.product?.product.allowDecimalQuantity ?? false} />
            يسمح بالكميات العشرية</label>
          <label className="full-width">الوصف<textarea name="description" rows={3} defaultValue={props.product?.product.description ?? ""} /></label>
          <label>صورة الصنف<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try { setImageDataUrl(await readFileAsDataUrl(file)); }
            catch (caught) { setError(errorMessage(caught)); }
          }} /></label>
          {imageDataUrl && <Button onClick={() => setImageDataUrl(null)}>إزالة الصورة المختارة</Button>}
          {props.product?.product.imagePath && imageDataUrl === undefined &&
            <Button onClick={() => setImageDataUrl(null)}>إزالة الصورة الحالية</Button>}
        </div>
      </section>

      {productType === "simple" && !props.product && <>
        <section className="panel form-section">
          <div className="section-heading"><h3>وحدات التعبئة</h3><Button onClick={addPackaging}>إضافة وحدة</Button></div>
          {packaging.length === 0 && <p className="muted-text">يمكن إضافة وحدات تعبئة اختيارية بعد حفظ الصنف.</p>}
          {packaging.map((item, index) => <div className="inline-fields" key={index}>
            <label>وحدة التعبئة<select required value={item.unitId} onChange={(event) =>
              setPackaging((items) => items.map((row, i) => i === index ? { ...row, unitId: event.target.value } : row))}>
              <option value="">اختر وحدة</option>{props.units.filter((unit) => unit.status === "active").map((unit) =>
                <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol}) · {unitDimensionLabel(unit.dimension)}</option>)}
            </select></label>
            <label>عامل التحويل إلى الوحدة الأساسية<input required inputMode="decimal" value={item.conversionFactor}
              onChange={(event) => setPackaging((items) => items.map((row, i) => i === index ? { ...row, conversionFactor: event.target.value } : row))} /></label>
            <Button variant="danger" onClick={() => {
              const removedUnitId = item.unitId;
              setPackaging((items) => items.filter((_, i) => i !== index));
              setBarcodes((items) => items.map((barcode) =>
                barcode.packagingUnitId === removedUnitId ? { ...barcode, packagingUnitId: "" } : barcode
              ));
            }}>إزالة</Button>
          </div>)}
        </section>
        <section className="panel form-section">
          <div className="section-heading"><h3>الباركود</h3><Button onClick={addBarcode}>إضافة باركود</Button></div>
          {barcodes.length === 0 && <p className="muted-text">يمكن إضافة باركود اختياريًا.</p>}
          {barcodes.map((item, index) => <div className="inline-fields" key={index}>
            <label>قيمة الباركود<input required dir="ltr" value={item.code} onChange={(event) =>
              setBarcodes((items) => items.map((row, i) => i === index ? { ...row, code: event.target.value } : row))} /></label>
            <label>وحدة التعبئة (اختياري)<select value={item.packagingUnitId} onChange={(event) =>
              setBarcodes((items) => items.map((row, i) => i === index ? { ...row, packagingUnitId: event.target.value } : row))}>
              <option value="">الوحدة الأساسية</option>{packaging.filter((row) => row.unitId).map((row, i) => {
                const unit = props.units.find((candidate) => candidate.id === row.unitId);
                return <option key={`${row.unitId}-${i}`} value={row.unitId}>{unit?.name ?? "وحدة تعبئة"}</option>;
              })}
            </select></label>
            <Button variant="danger" onClick={() => setBarcodes((items) => items.filter((_, i) => i !== index))}>إزالة</Button>
          </div>)}
        </section>
      </>}

      {productType === "with_variants" && !props.product && <section className="panel form-section">
        <div className="section-heading"><h3>المتغيرات</h3><Button onClick={addVariant}>إضافة متغير</Button></div>
        <p className="muted-text">أدخل الخصائص بصيغة: اللون=أحمر، المقاس=M. يمكن إدارة التعبئة والباركود لكل متغير بعد حفظ الصنف.</p>
        {variants.map((variant, index) => <div className="variant-draft" key={index}>
          <div className="inline-fields">
            <label>اسم المتغير<input required value={variant.name} onChange={(event) => updateVariant(index, { name: event.target.value })} /></label>
            <label>كود المتغير<input required dir="ltr" value={variant.sku} onChange={(event) => updateVariant(index, { sku: event.target.value })} /></label>
            <label>وحدة القياس<select value={variant.baseUnitId ?? ""} onChange={(event) => updateVariant(index, { baseUnitId: event.target.value || null })}>
              <option value="">استخدام الوحدة الأساسية</option>{props.units.filter((unit) => unit.status === "active").map((unit) =>
                <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol}) · {unitDimensionLabel(unit.dimension)}</option>)}
            </select></label>
            <Button variant="danger" onClick={() => setVariants((items) => items.filter((_, i) => i !== index))}>إزالة</Button>
          </div>
          <label>الخصائص<input required placeholder="اللون=أحمر، المقاس=M" value={variant.attributesText}
            onChange={(event) => updateVariant(index, { attributesText: event.target.value })} /></label>
        </div>)}
        {variants.length === 0 && <EmptyState>أضف متغيرًا واحدًا على الأقل لهذا النوع من الأصناف.</EmptyState>}
      </section>}

      {props.product && <div className="panel form-section">
        <h3>بيانات مرتبطة</h3>
        <p>لتعديل المتغيرات أو وحدات التعبئة أو الباركود، استخدم صفحاتها من القائمة الجانبية.</p>
      </div>}
      <div className="form-footer"><Button type="submit" variant="primary" disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ الصنف"}</Button>
        <Button onClick={() => navigate(props.product ? `/products/${props.product.product.id}` : "/products")}>إلغاء</Button></div>
    </form>
  );
}

export function ProductFormPage() {
  const { id } = useParams();
  const [product, setProduct] = useState<ProductDetails | undefined>();
  const [references, setReferences] = useState<{ categories: Category[]; units: Unit[]; brands: Brand[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const [categories, units, brands, details] = await Promise.all([
          window.warehouse.catalog.categories.lookup(),
          window.warehouse.catalog.units.lookup(),
          window.warehouse.catalog.brands.lookup(),
          id ? window.warehouse.catalog.products.get({ id }) : Promise.resolve(undefined)
        ]);
        if (active) {
          setReferences({ categories, units, brands });
          setProduct(details);
        }
      } catch (caught) { if (active) setError(errorMessage(caught)); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [id]);

  if (loading) return <LoadingState />;
  if (!references) return <Notice kind="error">{error ?? "تعذر تحميل بيانات النموذج."}</Notice>;
  if (id && !product) return <Notice kind="error">{error ?? "الصنف غير موجود."}</Notice>;
  return <section>
    <PageTitle title={product ? "تعديل الصنف" : "إضافة صنف جديد"} description="أدخل البيانات الأساسية ثم احفظها في قاعدة البيانات المحلية." />
    <ProductEditor key={product?.product.id ?? "new-product"} product={product}
      categories={references.categories} units={references.units} brands={references.brands} />
  </section>;
}

function DetailRow(props: { label: string; value: string }) {
  return <div className="detail-row"><span>{props.label}</span><strong>{props.value}</strong></div>;
}

export function ProductDetailsPage() {
  const { id = "" } = useParams();
  const [details, setDetails] = useState<ProductDetails | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await window.warehouse.catalog.products.get({ id });
        const imageData = result.product.imagePath ? await window.warehouse.catalog.media.read({ relativePath: result.product.imagePath }) : null;
        if (active) { setDetails(result); setImage(imageData); }
      } catch (caught) { if (active) setError(errorMessage(caught)); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [id]);

  if (loading) return <LoadingState />;
  if (error || !details) return <Notice kind="error">{error ?? "الصنف غير موجود."}</Notice>;
  const product: Product = details.product;
  return <section>
    <PageTitle title={product.name} description={`كود الصنف: ${product.sku}`}
      action={<div className="row-actions"><Link className="button button-secondary" to={`/products/${id}/edit`}>تعديل</Link><Link className="button button-secondary" to="/products">العودة للأصناف</Link></div>} />
    <div className="detail-layout">
      <div className="panel detail-panel">
        <h3>بيانات الصنف</h3>
        {image && <img className="product-image" src={image} alt={`صورة ${product.name}`} />}
        <DetailRow label="التصنيف" value={details.categoryName} />
        <DetailRow label="العلامة التجارية" value={details.brandName ?? "بدون علامة تجارية"} />
        <DetailRow label="وحدة القياس" value={`${details.baseUnitName} (${details.baseUnitSymbol})`} />
        <DetailRow label="النوع" value={productTypeLabel(product.productType)} />
        <DetailRow label="الحالة" value={product.status === "active" ? "نشط" : "غير نشط"} />
        <DetailRow label="الكميات العشرية" value={product.allowDecimalQuantity ? "مسموح" : "غير مسموح"} />
        <DetailRow label="الوصف" value={product.description ?? "—"} />
      </div>
      <div className="panel detail-panel">
        <h3>وحدات التعبئة</h3>
        {details.packaging.length ? details.packaging.map((item) =>
          <DetailRow key={item.id} label={item.unitName} value={`${item.factorLabel} ${details.baseUnitSymbol}`} />
        ) : <p className="muted-text">لا توجد وحدات تعبئة معرفة على الصنف.</p>}
      </div>
      <div className="panel detail-panel">
        <h3>المتغيرات</h3>
        {details.variants.length ? details.variants.map((variant) =>
          <DetailRow key={variant.id} label={`${variant.name} · ${variant.sku}`}
            value={variant.attributes.map((item) => `${item.name}: ${item.value}`).join("، ")} />
        ) : <p className="muted-text">لا توجد متغيرات.</p>}
      </div>
      <div className="panel detail-panel">
        <h3>الباركود</h3>
        {details.barcodes.length ? details.barcodes.map((item) =>
          <DetailRow key={item.id} label={item.code} value={item.packagingLabel ?? "الوحدة الأساسية"} />
        ) : <p className="muted-text">لا توجد باركودات.</p>}
      </div>
    </div>
  </section>;
}
