import { useEffect, useState } from "react";
import { HashRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import type { AppInfo } from "../shared/ipc/contracts";
import { BarcodesPage, PackagingPage, VariantsPage } from "./catalog/operations-pages";
import { ProductDetailsPage, ProductFormPage, ProductsPage } from "./catalog/product-pages";
import { BrandsPage, CategoriesPage, UnitsPage } from "./catalog/reference-pages";
import { Notice, errorMessage } from "./ui";

const navigation = [
  { to: "/", label: "نظرة عامة", end: true },
  { to: "/products", label: "الأصناف" },
  { to: "/categories", label: "التصنيفات" },
  { to: "/units", label: "وحدات القياس" },
  { to: "/brands", label: "العلامات التجارية" },
  { to: "/variants", label: "المتغيرات" },
  { to: "/packaging", label: "وحدات التعبئة" },
  { to: "/barcodes", label: "الباركود" }
];

function DashboardPage() {
  const [counts, setCounts] = useState<{ products: number; categories: number; units: number; brands: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      window.warehouse.catalog.products.list({ page: 1, pageSize: 1 }),
      window.warehouse.catalog.categories.lookup(),
      window.warehouse.catalog.units.lookup(),
      window.warehouse.catalog.brands.lookup()
    ]).then(([products, categories, units, brands]) => {
      if (active) setCounts({ products: products.total, categories: categories.length, units: units.length, brands: brands.length });
    }).catch((caught: unknown) => {
      if (active) setError(errorMessage(caught));
    });
    return () => { active = false; };
  }, []);

  return <section>
    <div className="welcome-panel">
      <div><p className="eyebrow">إدارة بيانات الأصناف</p><h2>مرحبًا بك في نظام إدارة المخازن</h2>
        <p>ابدأ بتعريف الأصناف وتصنيفاتها ووحدات القياس والعلامات التجارية.</p></div>
      <Link to="/products/new" className="button button-primary">إضافة صنف جديد</Link>
    </div>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="dashboard-grid">
      <DashboardCard title="الأصناف" value={counts?.products} link="/products" />
      <DashboardCard title="التصنيفات" value={counts?.categories} link="/categories" />
      <DashboardCard title="وحدات القياس" value={counts?.units} link="/units" />
      <DashboardCard title="العلامات التجارية" value={counts?.brands} link="/brands" />
    </div>
    <div className="panel quick-links"><h3>إدارة بيانات الصنف</h3><div>
      {navigation.slice(1).map((item) => <Link key={item.to} to={item.to}>{item.label}<span>←</span></Link>)}
    </div></div>
  </section>;
}

function DashboardCard(props: { title: string; value?: number; link: string }) {
  return <Link className="panel dashboard-card" to={props.link}>
    <span>{props.title}</span><strong>{props.value === undefined ? "—" : new Intl.NumberFormat("ar-EG").format(props.value)}</strong>
    <small>عرض وإدارة البيانات</small>
  </Link>;
}

function AppLayout() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    let active = true;
    window.warehouse.system.getAppInfo().then((info) => {
      if (active) setAppInfo(info);
    }).catch((error: unknown) => {
      if (active) setAppError(errorMessage(error));
    });
    return () => { active = false; };
  }, []);

  const current = navigation.find((item) => item.to !== "/" && location.pathname.startsWith(item.to))
    ?? navigation[0];
  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="brand" to="/" aria-label="الصفحة الرئيسية">
        <span className="brand-mark">م</span>
        <span><strong>المخازن</strong><small>إدارة الأصناف</small></span>
      </Link>
      <div className="nav-caption">القائمة الرئيسية</div>
      <nav className="side-nav" aria-label="القائمة الرئيسية">
        {navigation.map((item) => <NavLink key={item.to} to={item.to} end={item.end}
          className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
          <span className="nav-dot" aria-hidden="true" />{item.label}
        </NavLink>)}
      </nav>
      <div className="sidebar-footer"><span className={`connection-dot${appInfo?.databaseReady ? " online" : ""}`} />
        {appInfo?.databaseReady ? "قاعدة البيانات المحلية متصلة" : appError ? "تعذر الاتصال بالتطبيق" : "جارٍ الاتصال بالتطبيق"}
      </div>
    </aside>
    <section className="workspace">
      <header className="topbar">
        <div><span className="topbar-overline">مساحة العمل</span><strong>{current.label}</strong></div>
        <div className="topbar-status"><span className={`connection-dot${appInfo?.databaseReady ? " online" : ""}`} />
          {appInfo?.databaseReady ? "النظام المحلي جاهز" : "النظام المحلي"}
        </div>
      </header>
      {appError && <div className="app-error"><Notice kind="error">{appError}</Notice></div>}
      <div className="page-content"><Outlet /></div>
    </section>
  </main>;
}

export function App() {
  return <HashRouter>
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/new" element={<ProductFormPage />} />
        <Route path="products/:id/edit" element={<ProductFormPage />} />
        <Route path="products/:id" element={<ProductDetailsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="units" element={<UnitsPage />} />
        <Route path="brands" element={<BrandsPage />} />
        <Route path="variants" element={<VariantsPage />} />
        <Route path="packaging" element={<PackagingPage />} />
        <Route path="barcodes" element={<BarcodesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  </HashRouter>;
}
