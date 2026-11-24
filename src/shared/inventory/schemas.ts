import { z } from "zod";

const id = z.string().min(1).max(160).refine(value => value === value.trim());
const itemId = id.refine(value => /^(p:|v:)\S/.test(value));
const movementId = z.string().regex(/^(0|-?[1-9]\d{0,18})$/).pipe(
  z.string().refine(value => {
    const id = BigInt(value);
    return id >= -(2n ** 63n) && id < 2n ** 63n;
  }),
);

export const stockItemSchema = z.object({ itemId }).strict();
export const stockBalanceSchema = stockItemSchema.extend({ locationId: id });
export const warehouseStockSchema = z.object({ warehouseId: id }).strict();
export const inventoryHistorySchema = stockItemSchema.extend({
  locationId: id.optional(),
  limit: z.number().int().min(1).max(200).default(100),
  beforeMovementId: movementId.optional(),
});
