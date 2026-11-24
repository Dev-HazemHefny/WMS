import type { ResolvedLocationDto } from "../../shared/warehouses/types";
import { locationLabel } from "./model";

export function eligibleLocations(values:readonly ResolvedLocationDto[]) {
  return values.filter(value=>value.effectiveActive&&value.location.isStockable);
}
export function indexInventoryLocations(eligible: readonly ResolvedLocationDto[]) {
  const labels = new Map<string, string>();
  const options = eligible.map(value => {
    const id = value.location.id;
    // Keep ordered options and the first label for duplicate IDs, as Array.find did.
    const label = labels.get(id) ?? locationLabel(value);
    labels.set(id, label);
    return { id, label };
  });
  return { labels, options };
}

export function historicalLocationLabel(value: ResolvedLocationDto | null) {
  return value ? `${locationLabel(value)} — غير متاح لعملية جديدة` : null;
}

export function inventoryLocationLabel(
  id: string,
  eligible: ReadonlyMap<string, string>,
  historical: ReadonlyMap<string, string | null>,
) {
  return eligible.get(id) ?? historical.get(id) ?? `موقع غير متاح حاليًا (${id})`;
}
