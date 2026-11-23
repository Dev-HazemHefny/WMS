import type { ResolvedLocationDto } from "../../shared/warehouses/types";
import { locationLabel } from "./model";

export function eligibleLocations(values:readonly ResolvedLocationDto[]) {
  return values.filter(value=>value.effectiveActive&&value.location.isStockable);
}
export function inventoryLocationLabel(id:string,eligible:readonly ResolvedLocationDto[],historical:Readonly<Record<string,ResolvedLocationDto|null>>) {
  const current=eligible.find(value=>value.location.id===id);
  if(current)return locationLabel(current);
  const old=historical[id];
  return old?`${locationLabel(old)} — غير متاح لعملية جديدة`:`موقع غير متاح حاليًا (${id})`;
}
