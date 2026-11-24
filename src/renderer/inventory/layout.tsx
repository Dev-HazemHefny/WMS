import { useCallback, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { InventoryPage } from "../inventory-page";
import { useSession } from "../session-context";
import { Notice, PageTitle } from "../ui";
import { loadInventoryDirectory } from "./directory";
import { InventoryAccessContext, useInventoryRequest, type AccessError } from "./request";
import { RequestView } from "./shared";

const views = [
  { path: "/inventory", title: "نظرة عامة" },
  { path: "/inventory/balances", title: "أرصدة المخزون" },
  { path: "/inventory/items", title: "حسب الصنف" },
  { path: "/inventory/warehouses", title: "حسب المخزن" },
  { path: "/inventory/history", title: "سجل الحركات" },
  { path: "/inventory/consistency", title: "التحقق من الأرصدة" },
];

export function InventoryLayout() {
  const { can, refreshCapabilities } = useSession();
  const [denied, setDenied] = useState<AccessError | null>(null);
  const onDenied = useCallback((code: AccessError) => {
    setDenied(code);
    void refreshCapabilities().catch(() => {});
  }, [refreshCapabilities]);

  if (!can("read") || denied) return <InventoryAccessNotice expired={denied === "AUTH_REQUIRED"} />;

  return <InventoryAccessContext.Provider value={onDenied}>
    <section dir="rtl" className="inventory-report">
      <nav className="inventory-nav" aria-label="أقسام المخزون">
        {views.map(view => <NavLink key={view.path} to={view.path} end className="button button-secondary">{view.title}</NavLink>)}
        <Link className="button button-quiet" to="/inventory/operations">عمليات المخزون</Link>
      </nav>
      <InventoryDirectoryOutlet />
    </section>
  </InventoryAccessContext.Provider>;
}

export function InventoryOperationsRoute() {
  const { can } = useSession();
  return can("read") ? <InventoryPage /> : <InventoryAccessNotice />;
}

function InventoryAccessNotice({ expired = false }: { expired?: boolean }) {
  return <section dir="rtl">
    <PageTitle title="المخزون" />
    <Notice kind="error">{expired ? "انتهت الجلسة. سجّل الدخول مجددًا." : "لا تملك صلاحية عرض بيانات المخزون."}</Notice>
  </section>;
}

function InventoryDirectoryOutlet() {
  const directory = useInventoryRequest("directory", signal => loadInventoryDirectory(window.warehouse, signal));
  return <RequestView request={directory}>{data => <Outlet context={data} />}</RequestView>;
}
