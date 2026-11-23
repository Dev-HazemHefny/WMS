import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import type { Page, RecordStatus } from "../../shared/catalog/types";
import { Button, EmptyState, LoadingState, Notice } from "./primitives";

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export function FilterBar(props: { children: ReactNode; wide?: boolean }) {
  return <div className={`filters${props.wide ? " filters-wide" : ""}`}>{props.children}</div>;
}

export function SearchField(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="search-field">
      <span>{props.label ?? "بحث"}</span>
      <input value={props.value} placeholder={props.placeholder} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

export function StatusSelect(props: {
  value: "all" | RecordStatus;
  onChange: (value: "all" | RecordStatus) => void;
  label?: string;
}) {
  return (
    <label>
      <span>{props.label ?? "الحالة"}</span>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as "all" | RecordStatus)}
      >
        <option value="all">كل الحالات</option>
        <option value="active">نشط</option>
        <option value="inactive">غير نشط</option>
      </select>
    </label>
  );
}

/** The common "search + status" filter used by reference and operation lists. */
export function SearchStatusFilter(props: {
  search: string;
  onSearch: (value: string) => void;
  status: "all" | RecordStatus;
  onStatus: (value: "all" | RecordStatus) => void;
  searchPlaceholder?: string;
}) {
  return (
    <FilterBar>
      <SearchField value={props.search} onChange={props.onSearch} placeholder={props.searchPlaceholder} />
      <StatusSelect value={props.status} onChange={props.onStatus} />
    </FilterBar>
  );
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  dir?: "ltr" | "rtl";
  className?: string;
}

/**
 * Standard list table: handles the loading and empty states so every page
 * renders the same way.
 */
export function DataTable<T>(props: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty: ReactNode;
}) {
  return (
    <div className="panel table-wrap">
      {props.loading ? (
        <LoadingState />
      ) : props.rows.length ? (
        <table>
          <thead>
            <tr>{props.columns.map((column) => <th key={column.key}>{column.header}</th>)}</tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={props.rowKey(row)}>
                {props.columns.map((column) => (
                  <td key={column.key} dir={column.dir} className={column.className}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState>{props.empty}</EmptyState>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export function ListPagination(props: {
  page: Page<unknown>;
  currentPage: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span>النتائج: {props.page.total}</span>
      <div>
        <Button disabled={props.currentPage <= 1} onClick={() => props.onPage(props.currentPage - 1)}>السابق</Button>
        <span>صفحة {props.page.page}</span>
        <Button
          disabled={props.currentPage * props.page.pageSize >= props.page.total}
          onClick={() => props.onPage(props.currentPage + 1)}
        >
          التالي
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function Dialog(props: {
  title: ReactNode;
  children: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose?: () => void;
  error?: string | null;
  submitLabel?: string;
  cancelLabel?: string;
  submitDisabled?: boolean;
  closeOnBackdrop?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = form.current!;
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),a[href],[tabindex="0"]')).filter(node => !node.hidden && node.getClientRects().length > 0);
    (controls()[0] ?? element).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current?.(); }
      if (event.key !== "Tab") return;
      const nodes = controls(), first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); element.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    element.addEventListener("keydown", keydown);
    return () => { element.removeEventListener("keydown",keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={
        props.closeOnBackdrop
          ? (event) => {
              if (event.target === event.currentTarget) props.onClose?.();
            }
          : undefined
      }
    >
      <form ref={form} className="dialog form-grid" onSubmit={props.onSubmit} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h3 id={titleId}>{props.title}</h3>
        {props.error && <Notice kind="error">{props.error}</Notice>}
        {props.children}
        <div className="dialog-actions">
          <Button type="submit" variant="primary" disabled={props.submitDisabled}>
            {props.submitLabel ?? "حفظ"}
          </Button>
          <Button onClick={props.onClose}>{props.cancelLabel ?? "إلغاء"}</Button>
        </div>
      </form>
    </div>
  );
}
