import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Brand, Category, CategoryTreeNode, Page, RecordStatus, Unit, UnitDimension } from "../../shared/catalog/types";
import { Button, EmptyState, LoadingState, Notice, PageTitle, StatusBadge, confirmDelete, errorMessage, unitDimensionLabel } from "../shared/ui";

type EditValue<T> = T | null | false;

function usePageFeedback() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  return {
    error,
    success,
    setError: (message: string | null) => {
      setSuccess(null);
      setError(message);
    },
    setSuccess: (message: string | null) => {
      setError(null);
      setSuccess(message);
    },
    clear: () => {
      setError(null);
      setSuccess(null);
    }
  };
}

function FilterBar(props: {
  search: string;
  onSearch: (value: string) => void;
  status: "all" | RecordStatus;
  onStatus: (value: "all" | RecordStatus) => void;
}) {
  return (
    <div className="filters">
      <label className="search-field">
        <span>بحث</span>
        <input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="ابحث بالاسم أو الكود" />
      </label>
      <label>
        <span>الحالة</span>
        <select value={props.status} onChange={(event) => props.onStatus(event.target.value as "all" | RecordStatus)}>
          <option value="all">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="inactive">غير نشط</option>
        </select>
      </label>
    </div>
  );
}

function ListPagination(props: { page: Page<unknown>; currentPage: number; onPage: (page: number) => void }) {
  return <div className="pagination"><span>النتائج: {props.page.total}</span><div>
    <Button disabled={props.currentPage <= 1} onClick={() => props.onPage(props.currentPage - 1)}>السابق</Button>
    <span>صفحة {props.page.page}</span>
    <Button disabled={props.currentPage * props.page.pageSize >= props.page.total} onClick={() => props.onPage(props.currentPage + 1)}>التالي</Button>
  </div></div>;
}

function CategoryBranch(props: {
  nodes: CategoryTreeNode[];
  onEdit: (category: Category) => void;
  onToggle: (category: Category) => void;
  onDelete: (category: Category) => void;
}) {
  if (!props.nodes.length) return null;
  return (
    <ul className="category-tree">
      {props.nodes.map((category) => (
        <li key={category.id}>
          <div className="tree-row">
            <div className="tree-label">
              <strong>{category.name}</strong>
              <span className="muted-text">{category.code}</span>
              <StatusBadge status={category.status} />
            </div>
            <div className="row-actions">
              <Button variant="quiet" onClick={() => props.onEdit(category)}>تعديل</Button>
              <Button variant="quiet" onClick={() => props.onToggle(category)}>
                {category.status === "active" ? "تعطيل" : "تفعيل"}
              </Button>
              <Button variant="quiet" onClick={() => props.onDelete(category)}>حذف</Button>
            </div>
          </div>
          <CategoryBranch nodes={category.children} onEdit={props.onEdit} onToggle={props.onToggle} onDelete={props.onDelete} />
        </li>
      ))}
    </ul>
  );
}

export function CategoriesPage() {
  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [all, setAll] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditValue<Category>>(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | RecordStatus>("all");
  const feedback = usePageFeedback();

  const load = async () => {
    setLoading(true);
    try {
      const [nextTree, categories] = await Promise.all([
        window.warehouse.catalog.categories.tree(),
        window.warehouse.catalog.categories.lookup()
      ]);
      setTree(nextTree);
      setAll(categories);
    } catch (error) {
      feedback.setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const visibleTree = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const filter = (nodes: CategoryTreeNode[]): CategoryTreeNode[] =>
      nodes.flatMap((node) => {
        const children = filter(node.children);
        const matchesText = !needle || `${node.name} ${node.code}`.toLocaleLowerCase().includes(needle);
        const matchesStatus = status === "all" || node.status === status;
        if (!(matchesText && matchesStatus) && children.length === 0) return [];
        return [{ ...node, children }];
      });
    return filter(tree);
  }, [tree, search, status]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input = {
      name: String(values.get("name") ?? ""),
      code: String(values.get("code") ?? ""),
      description: String(values.get("description") ?? "") || null,
      parentId: String(values.get("parentId") ?? "") || null
    };
    try {
      if (editing) await window.warehouse.catalog.categories.update({ id: editing.id, ...input });
      else await window.warehouse.catalog.categories.create(input);
      setEditing(false);
      feedback.setSuccess(editing ? "تم تحديث التصنيف بنجاح." : "تمت إضافة التصنيف بنجاح.");
      await load();
    } catch (error) {
      feedback.setError(errorMessage(error));
    }
  };

  const toggle = async (category: Category) => {
    try {
      if (category.status === "active") await window.warehouse.catalog.categories.deactivate({ id: category.id });
      else await window.warehouse.catalog.categories.activate({ id: category.id });
      feedback.setSuccess("تم تحديث حالة التصنيف.");
      await load();
    } catch (error) {
      feedback.setError(errorMessage(error));
    }
  };

  const remove = async (category: Category) => {
    if (!confirmDelete(`هل تريد حذف التصنيف «${category.name}»؟`)) return;
    try {
      await window.warehouse.catalog.categories.delete({ id: category.id });
      feedback.setSuccess("تم حذف التصنيف.");
      await load();
    } catch (error) {
      feedback.setError(errorMessage(error));
    }
  };

  return (
    <section>
      <PageTitle
        title="التصنيفات"
        description="إدارة التصنيفات الهرمية وربطها بالأصناف."
        action={<Button variant="primary" onClick={() => setEditing(null)}>إضافة تصنيف</Button>}
      />
      {feedback.error && <Notice kind="error">{feedback.error}</Notice>}
      {feedback.success && <Notice kind="success">{feedback.success}</Notice>}
      <FilterBar search={search} onSearch={setSearch} status={status} onStatus={setStatus} />
      <div className="panel data-panel">
        {loading ? <LoadingState /> : visibleTree.length ? (
          <CategoryBranch nodes={visibleTree} onEdit={setEditing} onToggle={(item) => void toggle(item)} onDelete={(item) => void remove(item)} />
        ) : <EmptyState>لا توجد تصنيفات مطابقة.</EmptyState>}
      </div>
      {editing !== false && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setEditing(false);
        }}>
          <form className="dialog form-grid" onSubmit={(event) => void save(event)}>
            <h3>{editing ? "تعديل التصنيف" : "إضافة تصنيف"}</h3>
            {feedback.error && <Notice kind="error">{feedback.error}</Notice>}
            <label>اسم التصنيف<input name="name" required maxLength={200} defaultValue={editing?.name ?? ""} /></label>
            <label>الكود<input name="code" required maxLength={64} defaultValue={editing?.code ?? ""} /></label>
            <label>التصنيف الأب
              <select name="parentId" defaultValue={editing?.parentId ?? ""}>
                <option value="">بدون تصنيف أب</option>
                {all.filter((item) => item.id !== editing?.id).map((item) =>
                  <option key={item.id} value={item.id}>{item.name}</option>
                )}
              </select>
            </label>
            <label>الوصف<textarea name="description" rows={3} defaultValue={editing?.description ?? ""} /></label>
            <div className="dialog-actions">
              <Button type="submit" variant="primary">حفظ</Button>
              <Button onClick={() => setEditing(false)}>إلغاء</Button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function UnitForm(props: { unit: Unit | null; onClose: () => void; onSave: (name: string, symbol: string, dimension: UnitDimension, description: string) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="dialog-backdrop">
      <form className="dialog form-grid" onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        try {
          await props.onSave(
            String(form.get("name")),
            String(form.get("symbol")),
            String(form.get("dimension")) as UnitDimension,
            String(form.get("description") ?? "")
          );
        } catch (caught) {
          setError(errorMessage(caught));
        }
      }}>
        <h3>{props.unit ? "تعديل وحدة قياس" : "إضافة وحدة قياس"}</h3>
        {error && <Notice kind="error">{error}</Notice>}
        <label>اسم الوحدة<input name="name" required maxLength={200} defaultValue={props.unit?.name ?? ""} /></label>
        <label>الرمز<input name="symbol" required maxLength={16} defaultValue={props.unit?.symbol ?? ""} /></label>
        <label>نوع وحدة القياس<select name="dimension" defaultValue={props.unit?.dimension ?? "count"}>
          <option value="count">عدد</option><option value="mass">وزن</option><option value="volume">حجم</option>
          <option value="length">طول</option><option value="area">مساحة</option><option value="other">أخرى</option>
        </select></label>
        <label>الوصف<textarea name="description" rows={3} defaultValue={props.unit?.description ?? ""} /></label>
        <div className="dialog-actions"><Button type="submit" variant="primary">حفظ</Button><Button onClick={props.onClose}>إلغاء</Button></div>
      </form>
    </div>
  );
}

export function UnitsPage() {
  const [page, setPage] = useState<Page<Unit> | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditValue<Unit>>(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | RecordStatus>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await window.warehouse.catalog.units.list({
        page: currentPage, pageSize: 20, search: search || null,
        status: status === "all" ? null : status
      });
      setPage(result);
      setError(null);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [search, status, currentPage]);

  const save = async (name: string, symbol: string, dimension: UnitDimension, description: string) => {
    const input = { name, symbol, dimension, description: description || null };
    if (editing) await window.warehouse.catalog.units.update({ id: editing.id, ...input });
    else await window.warehouse.catalog.units.create(input);
    setEditing(false);
    setSuccess(editing ? "تم تحديث وحدة القياس." : "تمت إضافة وحدة القياس.");
    await load();
  };
  const toggle = async (unit: Unit) => {
    try {
      if (unit.status === "active") await window.warehouse.catalog.units.deactivate({ id: unit.id });
      else await window.warehouse.catalog.units.activate({ id: unit.id });
      setSuccess("تم تحديث حالة وحدة القياس.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const remove = async (unit: Unit) => {
    if (!confirmDelete(`هل تريد حذف وحدة القياس «${unit.name}»؟`)) return;
    try {
      await window.warehouse.catalog.units.delete({ id: unit.id });
      setSuccess("تم حذف وحدة القياس.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };

  return (
    <section>
      <PageTitle title="وحدات القياس" description="إدارة وحدات القياس المستخدمة في تعريف الأصناف."
        action={<Button variant="primary" onClick={() => setEditing(null)}>إضافة وحدة</Button>} />
      {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
      <FilterBar search={search} onSearch={(value) => { setSearch(value); setCurrentPage(1); }}
        status={status} onStatus={(value) => { setStatus(value); setCurrentPage(1); }} />
      <div className="panel table-wrap">
        {loading ? <LoadingState /> : page?.items.length ? <table>
          <thead><tr><th>الوحدة</th><th>الرمز</th><th>النوع</th><th>الوصف</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
          <tbody>{page.items.map((unit) => <tr key={unit.id}>
            <td>{unit.name}</td><td>{unit.symbol}</td><td>{unitDimensionLabel(unit.dimension)}</td><td>{unit.description || "—"}</td><td><StatusBadge status={unit.status} /></td>
            <td className="row-actions"><Button variant="quiet" onClick={() => setEditing(unit)}>تعديل</Button>
              <Button variant="quiet" onClick={() => void toggle(unit)}>{unit.status === "active" ? "تعطيل" : "تفعيل"}</Button>
              <Button variant="quiet" onClick={() => void remove(unit)}>حذف</Button></td>
          </tr>)}</tbody>
        </table> : <EmptyState>لا توجد وحدات قياس مطابقة.</EmptyState>}
      </div>
      {page && <ListPagination page={page} currentPage={currentPage} onPage={setCurrentPage} />}
      {editing !== false && <UnitForm key={editing?.id ?? "new"} unit={editing} onClose={() => setEditing(false)} onSave={save} />}
    </section>
  );
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("تعذر قراءة الصورة."));
    reader.onerror = () => reject(new Error("تعذر قراءة الصورة."));
    reader.readAsDataURL(file);
  });
}

function BrandForm(props: { brand: Brand | null; onClose: () => void; onSave: (data: { name: string; code: string; description: string; imageDataUrl?: string | null }) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<string | null | undefined>(undefined);
  const [reading, setReading] = useState(false);
  return (
    <div className="dialog-backdrop">
      <form className="dialog form-grid" onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        try {
          await props.onSave({
            name: String(form.get("name")),
            code: String(form.get("code")),
            description: String(form.get("description") ?? ""),
            imageDataUrl: image
          });
        } catch (caught) { setError(errorMessage(caught)); }
      }}>
        <h3>{props.brand ? "تعديل العلامة التجارية" : "إضافة علامة تجارية"}</h3>
        {error && <Notice kind="error">{error}</Notice>}
        <label>اسم العلامة التجارية<input name="name" required maxLength={200} defaultValue={props.brand?.name ?? ""} /></label>
        <label>الكود<input name="code" required maxLength={64} defaultValue={props.brand?.code ?? ""} /></label>
        <label>الوصف<textarea name="description" rows={3} defaultValue={props.brand?.description ?? ""} /></label>
        <label>الشعار أو الصورة<input type="file" accept="image/png,image/jpeg,image/webp" disabled={reading}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setReading(true);
            try { setImage(await fileToDataUrl(file)); }
            catch (caught) { setError(errorMessage(caught)); }
            finally { setReading(false); }
          }} /></label>
        {image && <Button onClick={() => setImage(null)}>إزالة الصورة المختارة</Button>}
        {props.brand?.imagePath && image === undefined && <Button onClick={() => setImage(null)}>إزالة الشعار الحالي</Button>}
        <div className="dialog-actions"><Button type="submit" variant="primary" disabled={reading}>حفظ</Button><Button onClick={props.onClose}>إلغاء</Button></div>
      </form>
    </div>
  );
}

export function BrandsPage() {
  const [page, setPage] = useState<Page<Brand> | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditValue<Brand>>(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | RecordStatus>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await window.warehouse.catalog.brands.list({
        page: currentPage, pageSize: 20, search: search || null,
        status: status === "all" ? null : status
      });
      setPage(result);
      setError(null);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [search, status, currentPage]);

  const save = async (data: { name: string; code: string; description: string; imageDataUrl?: string | null }) => {
    const input = { ...data, description: data.description || null };
    if (editing) await window.warehouse.catalog.brands.update({ id: editing.id, ...input });
    else await window.warehouse.catalog.brands.create(input);
    setEditing(false);
    setSuccess(editing ? "تم تحديث العلامة التجارية." : "تمت إضافة العلامة التجارية.");
    await load();
  };
  const toggle = async (brand: Brand) => {
    try {
      if (brand.status === "active") await window.warehouse.catalog.brands.deactivate({ id: brand.id });
      else await window.warehouse.catalog.brands.activate({ id: brand.id });
      setSuccess("تم تحديث حالة العلامة التجارية.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const remove = async (brand: Brand) => {
    if (!confirmDelete(`هل تريد حذف العلامة التجارية «${brand.name}»؟`)) return;
    try {
      await window.warehouse.catalog.brands.delete({ id: brand.id });
      setSuccess("تم حذف العلامة التجارية.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
  };

  return (
    <section>
      <PageTitle title="العلامات التجارية" description="إدارة العلامات التجارية وربطها بالأصناف."
        action={<Button variant="primary" onClick={() => setEditing(null)}>إضافة علامة تجارية</Button>} />
      {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
      <FilterBar search={search} onSearch={(value) => { setSearch(value); setCurrentPage(1); }}
        status={status} onStatus={(value) => { setStatus(value); setCurrentPage(1); }} />
      <div className="panel table-wrap">
        {loading ? <LoadingState /> : page?.items.length ? <table>
          <thead><tr><th>العلامة التجارية</th><th>الكود</th><th>الوصف</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
          <tbody>{page.items.map((brand) => <tr key={brand.id}>
            <td>{brand.name}</td><td>{brand.code}</td><td>{brand.description || "—"}</td><td><StatusBadge status={brand.status} /></td>
            <td className="row-actions"><Button variant="quiet" onClick={() => setEditing(brand)}>تعديل</Button>
              <Button variant="quiet" onClick={() => void toggle(brand)}>{brand.status === "active" ? "تعطيل" : "تفعيل"}</Button>
              <Button variant="quiet" onClick={() => void remove(brand)}>حذف</Button></td>
          </tr>)}</tbody>
        </table> : <EmptyState>لا توجد علامات تجارية مطابقة.</EmptyState>}
      </div>
      {page && <ListPagination page={page} currentPage={currentPage} onPage={setCurrentPage} />}
      {editing !== false && <BrandForm key={editing?.id ?? "new"} brand={editing} onClose={() => setEditing(false)} onSave={save} />}
    </section>
  );
}
