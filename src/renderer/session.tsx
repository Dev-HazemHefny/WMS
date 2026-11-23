import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Boxes, LogOut, ShieldCheck, UserPlus } from "lucide-react";
import type { SessionCapabilities } from "../shared/identity/types";
import { SessionContext } from "./session-context";
import { errorMessage } from "./ui";
export function Session({ children }: { children: ReactNode }) {
  const [setup, setSetup] = useState<boolean | null>(null),
    [capabilities, setCapabilities] = useState<SessionCapabilities>({authenticated:false,permissions:[]}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const refreshCapabilities = useCallback(async () => {
    const request = ++generation.current;
    try {
      const current = await window.warehouse.identity.getCapabilities();
      if (request === generation.current) setCapabilities(current);
    } catch (caught) {
      if (request === generation.current) setCapabilities({authenticated:false,permissions:[]});
      throw caught;
    }
  }, []);
  useEffect(() => {
    window.warehouse.identity
      .setupRequired()
      .then(setSetup)
      .catch((e) => setError(String(e)));
  }, []);
  if (capabilities.authenticated)
    return (
      <SessionContext.Provider value={{capabilities,refreshCapabilities}}>
        <div className="session-actions">
        <details dir="rtl" className="user-menu">
          <summary><UserPlus size={16} /> إضافة مستخدم</summary>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                data = new FormData(form);
              try {
                await window.warehouse.identity.add({
                  name: String(data.get("name")),
                  password: String(data.get("password")),
                  roles: data.getAll("role") as (
                    | "admin"
                    | "clerk"
                    | "supervisor"
                  )[],
                });
                form.reset();
                setError("تم حفظ المستخدم");
              } catch (err) {
                setError(String(err));
              }
            }}
          >
            <label>اسم المستخدم<input required name="name" placeholder="اسم المستخدم" /></label>
            <label>كلمة المرور
            <input
              required
              name="password"
              type="password"
              minLength={12}
              placeholder="كلمة المرور"
            /></label>
            {(["clerk", "supervisor", "admin"] as const).map((role, i) => (
              <label key={role}>
                <input type="checkbox" name="role" value={role} />
                {["أمين مخزن", "مشرف", "مدير"][i]}
              </label>
            ))}
            <button>حفظ</button>
            <p role="status">{error}</p>
          </form>
        </details>
        <button
          className="button button-secondary"
          onClick={async () => {
            ++generation.current;
            setCapabilities({authenticated:false,permissions:[]});
            setSetup(false);
            setBusy(true);
            setError("");
            try { await window.warehouse.identity.logout(); await refreshCapabilities(); }
            catch (caught) { setError(errorMessage(caught)); }
            finally { setBusy(false); }
          }}
        >
          <LogOut size={15} /> تبديل المستخدم
        </button>
        </div>
        {children}
      </SessionContext.Provider>
    );
  return (
    <main dir="rtl" className="login-shell">
      <aside className="login-intro">
        <div className="login-brand"><Boxes size={26} /><strong>المخازن</strong></div>
        <div><h2>كل حركة محسوبة.<br />كل صنف في مكانه.</h2><p>مساحة واحدة لإدارة الأصناف ومتابعة المخزون وحركة المستودعات.</p></div>
        <span className="login-trust"><ShieldCheck size={18} /> بياناتك محفوظة على جهازك</span>
      </aside>
      <section className="login-card">
      <span className="login-symbol"><Boxes size={28} /></span>
      <h1>{setup ? "إنشاء حساب المدير" : "تسجيل الدخول"}</h1>
      <p className="login-description">{setup ? "جهّز حسابك الأول للبدء بإدارة مخازنك." : "أدخل بيانات حسابك للمتابعة إلى مساحة العمل."}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await window.warehouse.identity.login({
              name: String(data.get("name")),
              password: String(data.get("password")),
              setup: setup === true,
            });
            await refreshCapabilities();
          } catch (err) {
            setError(String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          اسم المستخدم
          <input required name="name" autoComplete="username" />
        </label>
        <label>
          كلمة المرور
          <input
            required
            name="password"
            type="password"
            minLength={setup ? 12 : 1}
            autoComplete={setup ? "new-password" : "current-password"}
          />
        </label>
        {setup && <small>12 حرفًا على الأقل</small>}
        <button className="button button-primary" disabled={busy || setup === null}>{busy ? "جارٍ التحقق…" : setup ? "إنشاء الحساب" : "دخول إلى النظام"}</button>
      </form>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
