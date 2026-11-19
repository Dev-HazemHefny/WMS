/**
 * Backwards-compatible aggregator for the reference-data use cases.
 * Prefer importing from `./units` or `./brands` directly in new code.
 */
export { createUnitUseCases, type UnitUseCases } from "./units";
export { createBrandUseCases, type BrandUseCases } from "./brands";
