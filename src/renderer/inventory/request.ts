import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { failureCode } from "../warehouses/model";

export type AccessError = "AUTH_REQUIRED" | "FORBIDDEN";

export const InventoryAccessContext = createContext<(code: AccessError) => void>(() => {});

function requestError(error: unknown) {
  const code = failureCode(error);
  if (code === "STOCK_ITEM_NOT_FOUND" || (error instanceof Error && error.message === "صنف المخزون غير موجود")) {
    return "صنف المخزون غير موجود.";
  }
  if (code === "VALIDATION_ERROR") return "بيانات الطلب غير صالحة. راجع عوامل التصفية.";
  return "تعذّر تحميل بيانات المخزون. حاول مرة أخرى.";
}

type RequestState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; message: string };

export type InventoryRequest<T> = RequestState<T> | { status: "idle" };

export function useInventoryRequest<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>) {
  const onDenied = useContext(InventoryAccessContext);
  const [revision, setRevision] = useState(0);
  const requestToken = useMemo(() => ({}), [key, revision]);
  const [settled, setSettled] = useState<{ token: object; state: RequestState<T> }>();
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    const request = loader.current;
    // StrictMode can clean up the initial effect before it needs to issue IPC.
    void Promise.resolve().then(async () => {
      if (signal.aborted) return;
      try {
        const data = await request(signal);
        if (!signal.aborted) setSettled({ token: requestToken, state: { status: "success", data } });
      } catch (error) {
        if (signal.aborted) return;
        const code = failureCode(error);
        if (code === "AUTH_REQUIRED" || code === "FORBIDDEN") onDenied(code);
        setSettled({ token: requestToken, state: { status: "error", message: requestError(error) } });
      }
    });
    return () => controller.abort();
  }, [key, onDenied, requestToken]);

  const state: InventoryRequest<T> = key === null ? { status: "idle" }
    : settled?.token === requestToken ? settled.state : { status: "loading" };
  return { state, retry: () => setRevision(value => value + 1) };
}
