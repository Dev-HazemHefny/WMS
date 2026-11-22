import { z } from "zod";
const id = z.string().min(1).max(160);
const name = z.string().trim().min(1).max(120);
const line = z
  .object({
    item: id,
    location: id,
    destination: id.optional(),
    quantity: z.string().max(40),
    packaging: id.optional(),
  })
  .strict();
export type StockLine = z.infer<typeof line>;
const versioned = { document: id, version: z.number().int().positive() };
export const commands = z.discriminatedUnion("op", [
  z.object({ op: z.literal("branch"), name }),
  z.object({ op: z.literal("warehouse"), branch: id, name }),
  z.object({ op: z.literal("location"), warehouse: id, name }),
  z.object({
    op: z.literal("draft"),
    kind: z.enum(["receipt", "issue", "transfer"]),
    lines: z.array(line).min(1).max(1000),
  }),
  z.object({
    op: z.literal("edit"),
    ...versioned,
    lines: z.array(line).max(1000),
  }),
  z.object({ op: z.literal("cancel"), ...versioned }),
  z.object({ op: z.literal("post"), ...versioned, command: id }),
  z.object({ op: z.literal("reverse"), document: id, command: id }),
  z.object({ op: z.literal("count"), location: id }),
  z.object({ op: z.literal("review"), ...versioned }),
  z.object({ op: z.literal("balances") }),
  z.object({ op: z.literal("history"), item: id }),
  z.object({ op:z.literal("rebuild") }),
  z.object({ op: z.literal("reconcile") }),
  z.object({ op: z.literal("barcode"), code: id }),
  z.object({ op: z.literal("details"),document:id }),
  z.object({ op: z.literal("directory") }),
  z.object({ op: z.literal("items") }),
  z.object({ op: z.literal("places") }),
  z.object({ op: z.literal("documents") }),
]);
export type StockCommand = z.infer<typeof commands>;
export type StockResult = {
  id?: string;
  rows?: Record<string, string | number | null>[];
};
