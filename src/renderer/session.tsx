import { useEffect, useState, type ReactNode } from "react";
export function Session({ children }: { children: ReactNode }) {
  const [setup, setSetup] = useState<boolean | null>(null),
    [active, setActive] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    window.warehouse.identity
      .setupRequired()
      .then(setSetup)
      .catch((e) => setError(String(e)));
  }, []);
  if (active)
    return (
      <>
        <details dir="rtl">
          <summary>إضافة مستخدم</summary>
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
            <input required name="name" placeholder="اسم المستخدم" />
            <input
              required
              name="password"
              type="password"
              minLength={12}
              placeholder="كلمة المرور"
            />
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
          className="button"
          onClick={async () => {
            await window.warehouse.identity.logout();
            setActive(false);
            setSetup(false);
          }}
        >
          تبديل المستخدم
        </button>
        {children}
      </>
    );
  return (
    <main dir="rtl" className="panel">
      <h1>{setup ? "إنشاء حساب المدير" : "تسجيل الدخول"}</h1>
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
            setActive(true);
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
        <button disabled={busy || setup === null}>دخول</button>
      </form>
      <p role="alert">{error}</p>
    </main>
  );
}
