import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { AppInfo } from "../shared/ipc/contracts";
import { navigation, useVisibleNavigation } from "./navigation";
import { Notice, errorMessage } from "./ui";

export function AppLayout() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const location = useLocation();
  const visibleNavigation = useVisibleNavigation();

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
        <span><strong>المخازن</strong><small>إدارة المخزون والأصناف</small></span>
      </Link>
      <div className="nav-caption">القائمة الرئيسية</div>
      <nav className="side-nav" aria-label="القائمة الرئيسية">
        {visibleNavigation.map((item) => { const Icon = item.icon; return <NavLink key={item.to} to={item.to} end={item.end}
          className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
          <Icon size={19} strokeWidth={1.7} aria-hidden="true" />{item.label}
        </NavLink>})}
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

