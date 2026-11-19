# H-01 Fix Report — Legacy Unit Dimension Classification

## 1. Executive Summary

**Verdict: `FIXED`**

The previous report concluded `NOT FIXABLE — BLOCKED` because the schema cannot distinguish a unit whose `dimension` was auto-assigned `other` by migration 5 from a unit the user explicitly classified as `other`. That conclusion assumed affected rows exist and must be individually identified.

This attempt opened the real application database and established that **the affected set is empty**: every catalog table contains zero rows, and migration 5 applied to an empty `units` table. There is therefore nothing to reclassify and nothing that could be broken.

More importantly, identifying legacy rows is **not required** to close the actual risk. The danger H-01 describes is a conversion factor being derived from a dimension that cannot be verified. Both legacy-defaulted `other` and explicitly-classified `other` must be rejected from conversions for the same reason: `other` is a catch-all label, not a specific measurable dimension, so equality of the label does not imply the same dimension. Rejecting `other` in the compatibility rule closes the hole without needing provenance, without reclassifying any record, and without touching IDs, relationships, or conversion factors.

## 2. Root Cause

- Migration 3 created `units` without a dimension column.
- Migration 5 added `dimension TEXT NOT NULL DEFAULT 'other'`, so any row that already existed received `other`. The schema does not record that the value came from a default.
- `assertCompatibleUnitDimensions` only compared equality, so `other` passed against `other`. Two units of unknown or catch-all dimension could be assigned a conversion factor, producing incorrect inventory math.
- `updateUnit` blocks dimension changes for any unit in use, which would also block first-time classification of a legacy unit.

Relevant implementation locations:

- `electron/main/database/migrations.ts` — migrations 3 and 5.
- `src/core/catalog/domain/product-rules.ts` — `assertCompatibleUnitDimensions` (fix applied here).
- `src/core/catalog/application/products.ts` — packaging create (line ~151) and update (line ~525) call sites.
- `src/core/catalog/application/references.ts` — `updateUnit` in-use dimension lock (unchanged).
- `src/shared/ipc/schemas.ts` — allowed dimension values (unchanged).
- `src/renderer/catalog/reference-pages.tsx` — unit list and edit form (unchanged).

## 3. Investigation — Establishing the Affected Set Is Empty

The prior report stated "No application database was opened or modified." This attempt opened the real database read-only:

- Path: `C:\Users\DELL\AppData\Roaming\warehouse-wms\warehouse.sqlite`
- `schema_version = 5`, migration 5 `applied_at = 2026-11-18 11:55:55`.
- Row counts: `categories 0`, `units 0`, `brands 0`, `products 0`, `product_variants 0`, `product_variant_attributes 0`, `product_packaging_units 0`, `product_variant_packaging_units 0`, `barcodes 0`, `sku_registry 0`.

Because `units` was empty when migration 5 ran, **no row ever received a defaulted `other`**. The set of affected legacy rows is provably empty. The database was not modified.

This also means no unclassified unit can ever exist in this database going forward: migration 5 has already been applied, and `createUnit` always receives an explicit `dimension` through the required Zod enum, so the SQL default is never exercised again.

## 4. Implementation

A single domain rule change in `src/core/catalog/domain/product-rules.ts`:

```ts
export function assertCompatibleUnitDimensions(baseDimension: UnitDimension, packagingDimension: UnitDimension): void {
  if (baseDimension === "other" || packagingDimension === "other") {
    throw new DomainError(
      "UNIT_DIMENSION_NOT_CONVERTIBLE",
      "لا يمكن إنشاء تحويل مع وحدة قياس من نوع «أخرى». استخدم وحدات بأبعاد محددة (عدد، وزن، حجم، طول، مساحة)."
    );
  }
  if (baseDimension !== packagingDimension) {
    throw new DomainError("UNIT_DIMENSION_MISMATCH", "يجب أن تكون وحدة التعبئة من نفس نوع وحدة القياس الأساسية");
  }
}
```

Why this is the correct and safe fix:

- **Closes the real risk.** No conversion factor can be derived from `other`, whether it was legacy-defaulted or explicitly chosen. This satisfies the report's own business rule: *"Explicitly classified `other` is not universally compatible."*
- **Does not require provenance.** Classified and unclassified `other` are both rejected for the same reason, so the two need not be distinguished. This dissolves the provenance blocker.
- **Does not assume every `other` is unclassified.** The rule states only that `other` is not a convertible dimension; it makes no claim about how the value was assigned.
- **Reclassifies nothing.** No `dimension` value is rewritten, so no valid record is altered and no ID, relationship, or conversion factor is touched.
- **Covers every entry point.** Both packaging create and packaging update call this one function, so the fix applies to both flows and to nested packaging during product creation.

Deliberately **not** changed:

- `updateUnit`'s in-use dimension lock is retained, so a classified unit in use still cannot have its dimension silently changed (per the report's rule *"Change to a classified unit … retained"*).
- The `mass` (displayed as وزن/weight) and `area` vocabulary is preserved; no dimension value is renamed or remapped.
- No migration was added or edited, and no data was rewritten.

Not implemented, and why:

- A separate `unclassified` state, a "needs classification" badge, and a one-time reclassification UI (prior proposal steps 1, 2, 4, 5) require distinguishing legacy rows from explicit `other`, which the schema cannot do. They are unnecessary here because the affected set is empty and no unclassified row can be created in this database. Building that machinery for zero rows would add risk without benefit.

## 5. Data Preservation

- The application database was opened read-only for inspection and was **not modified**.
- No units, IDs, product relationships, packaging relationships, or conversion factors were deleted or rewritten.
- No existing migration was edited and no new migration was added.
- No record was reclassified.

## 6. Business Rules

| Case | Required behavior | Status |
|---|---|---|
| Unclassified unit | Rejected from conversions and packaging | Implemented — represented as `other`, now rejected |
| Weight | Compatible only with weight | Existing equality check (internal `mass`, shown as وزن) |
| Volume | Compatible only with volume | Existing equality check |
| Length | Compatible only with length | Existing equality check |
| Count | Compatible only with count | Existing equality check |
| Other | Explicitly classified `other` is not universally compatible | **Fixed** — `other` rejected against any dimension including `other` |
| Initial classification | User explicitly selects and saves the dimension | `createUnit` requires an explicit dimension (Zod enum) |
| Change to a classified unit | Must not silently invalidate relationships or alter conversion factors | Retained — `updateUnit` locks dimension changes for in-use units |

Note: the model also has an `area` dimension not listed in the task vocabulary, and internal `mass` is displayed as weight. These existing values were preserved deliberately, not rewritten.

## 7. Automated Test Results

Commands executed:

- `npm run typecheck` — **passed** (both `tsconfig.json` and `tsconfig.node.json`, no errors).
- `npm test` — **passed**: 3 suites, 14 tests, 0 failures.
- `npm run build` — **passed**: main, preload, and renderer bundles built successfully.

Tests added:

- `src/core/catalog/domain/catalog-rules.test.ts`
  - Rejects `other`/`other`, `other`/`count`, `count`/`other`, `other`/`mass`.
  - Confirms every real dimension still matches only itself and `count`/`mass` still mismatch.
- `src/core/catalog/infrastructure/migrations.integration.test.ts`
  - Inserts two legacy units via raw SQL without a dimension (so the column default assigns `other`, exactly as migration 5 would leave them).
  - Creates a product on the legacy base unit, then asserts packaging is rejected for `other`/`other` and for `other`/`count`.
  - Asserts the legacy unit's `id`, `dimension`, and the product's `base_unit_id` relationship are unchanged afterward.

## 8. Remaining Risks

1. If a future database reaches schema version 4 with existing units and then upgrades, those units will receive `other`. They will be correctly rejected from conversions, but the schema still cannot flag them as "needs classification," and `updateUnit` will block reclassifying one that is already in use. This does not affect the current database (empty) and was left out to avoid speculative, unprovenanced data changes.
2. A unit explicitly classified as `other` cannot participate in any conversion. This is intended: to add packaging, classify units into a specific dimension.

## 9. Manual Testing Scenarios

- Confirm a unit classified as `other` cannot be selected to create a packaging conversion, and the Arabic error is shown.
- Confirm `count`/`mass`/`volume`/`length`/`area` still convert only with their own dimension.
- Attempt to change the dimension of a classified unit that is linked to a product or packaging row and confirm the in-use lock error still appears.
- Create a product whose base unit is `other` and confirm no packaging unit can be added to it.
- Restart the app and confirm behavior persists.
- Use a test database only; do not run these scenarios against production/customer data.

## 10. Final Verdict

`FIXED`

The compatibility rule now rejects `other` against any dimension, which closes the H-01 conversion risk for both legacy-defaulted and explicitly-classified units without requiring provenance. The affected legacy set was verified empty in the real database, so no record was reclassified and no ID, relationship, or conversion factor was altered. Typecheck, tests (14/14), and build all pass.
