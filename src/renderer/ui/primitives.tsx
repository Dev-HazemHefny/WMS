import type { ReactNode } from "react";

export function PageTitle(props: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <h2>{props.title}</h2>
        {props.description && <p>{props.description}</p>}
      </div>
      {props.action}
    </div>
  );
}

export function Button(props: {
  children: ReactNode;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "quiet";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`button button-${props.variant ?? "secondary"}`}
      type={props.type ?? "button"}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Notice(props: { kind: "error" | "success"; children: ReactNode }) {
  return (
    <div className={`notice notice-${props.kind}`} role="status">
      {props.children}
    </div>
  );
}

export function StatusBadge(props: { status: "active" | "inactive" }) {
  return (
    <span className={`status-badge status-${props.status}`}>
      {props.status === "active" ? "نشط" : "غير نشط"}
    </span>
  );
}

export function LoadingState() {
  return <div className="state-card" role="status">جارٍ تحميل البيانات...</div>;
}

export function EmptyState(props: { children: ReactNode }) {
  return <div className="state-card">{props.children}</div>;
}
