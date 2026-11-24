import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useVisibleNavigation } from "./navigation";
import { Notice, errorMessage } from "./ui";

export function DashboardPage() {
  const navigation = useVisibleNavigation();
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

