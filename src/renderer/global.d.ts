import type { WarehouseApi } from "../shared/ipc/contracts";

declare global {
  interface Window {
    warehouse: WarehouseApi;
  }
}

export {};