import type Database from "better-sqlite3";
import { createBrandUseCases } from "../application/brands";
import { createCategoryUseCases } from "../application/categories";
import { systemClock, systemIds, type Clock, type IdGenerator, type ImageStorage, type UnitOfWork } from "../application/ports";
import { createProductUseCases } from "../application/products";
import { createUnitUseCases } from "../application/units";
import { SqliteBarcodeRepository } from "./sqlite-barcode-repository";
import { SqliteCategoryRepository } from "./sqlite-category-repository";
import { SqliteProductRepository } from "./sqlite-product-repository";
import { SqliteBrandRepository, SqliteUnitRepository } from "./sqlite-reference-repository";
import { SqlitePackagingRepository, SqliteVariantRepository } from "./sqlite-variant-repository";

class SqliteUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database.Database) {}

  run<T>(work: () => T): T {
    return this.db.transaction(work)();
  }
}

export function createSqliteCatalog(
  db: Database.Database,
  images: ImageStorage,
  clock: Clock = systemClock,
  ids: IdGenerator = systemIds
) {
  const categories = new SqliteCategoryRepository(db);
  const units = new SqliteUnitRepository(db);
  const brands = new SqliteBrandRepository(db);
  const products = new SqliteProductRepository(db);
  const variants = new SqliteVariantRepository(db);
  const packaging = new SqlitePackagingRepository(db);
  const barcodes = new SqliteBarcodeRepository(db);
  const uow = new SqliteUnitOfWork(db);
  return {
    ...createCategoryUseCases({ categories, clock, ids }),
    ...createUnitUseCases({ units, clock, ids }),
    ...createBrandUseCases({ brands, images, clock, ids }),
    ...createProductUseCases({
      categories,
      units,
      brands,
      products,
      variants,
      packaging,
      barcodes,
      images,
      clock,
      ids,
      uow
    })
  };
}

export type CatalogUseCases = ReturnType<typeof createSqliteCatalog>;
