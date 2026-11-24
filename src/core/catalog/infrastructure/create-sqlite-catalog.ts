import type Database from "better-sqlite3";
import { createBrandUseCases } from "../application/brands";
import { createCategoryUseCases } from "../application/categories";
import { systemClock, systemIds, type Clock, type IdGenerator, type ImageStorage, type TransactionEffects, type UnitOfWork } from "../application/ports";
import { createProductUseCases } from "../application/products";
import { createUnitUseCases } from "../application/units";
import { SqliteBarcodeRepository } from "./sqlite-barcode-repository";
import { SqliteCategoryRepository } from "./sqlite-category-repository";
import { SqliteProductRepository } from "./sqlite-product-repository";
import { SqliteBrandRepository, SqliteUnitRepository } from "./sqlite-reference-repository";
import { SqlitePackagingRepository, SqliteVariantRepository } from "./sqlite-variant-repository";

type Cleanup = () => void;
type CleanupScope = { commit: Cleanup[]; rollback: Cleanup[] };

class SqliteUnitOfWork implements UnitOfWork {
  private scope?: CleanupScope;

  constructor(private readonly db: Database.Database) {}

  run<T>(work: (effects: TransactionEffects) => T): T {
    const parent = this.scope;
    if (this.db.inTransaction !== Boolean(parent)) {
      throw new Error("Catalog unit of work requires ownership of the active transaction");
    }

    const scope: CleanupScope = { commit: [], rollback: [] };
    this.scope = scope;
    let result: T;
    try {
      result = this.db.transaction(() => work({
        onCommit: cleanup => scope.commit.push(cleanup),
        onRollback: cleanup => scope.rollback.push(cleanup),
      }))();
    } catch (error) {
      this.scope = parent;
      // A failed outer rollback leaves the database outcome uncertain. Keep the files.
      if (parent || !this.db.inTransaction) this.cleanup(scope.rollback);
      throw error;
    }

    this.scope = parent;
    if (parent) {
      parent.commit.push(...scope.commit);
      parent.rollback.push(...scope.rollback);
    } else {
      this.cleanup(scope.commit);
    }
    return result;
  }

  private cleanup(callbacks: readonly Cleanup[]): void {
    for (const callback of callbacks) {
      try {
        callback();
      } catch {
        // Retaining an unreferenced file is safer than reporting a committed write as failed.
      }
    }
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
  const catalogImages: ImageStorage = {
    save: input => images.save(input),
    read: path => images.read(path),
    remove(path) {
      // Historical rows can share a path. Windows filenames are case-insensitive.
      const referenced = db.prepare(`
        SELECT 1 FROM products WHERE image_path = ? COLLATE NOCASE
        UNION ALL
        SELECT 1 FROM brands WHERE image_path = ? COLLATE NOCASE
        LIMIT 1`
      ).get(path, path);
      if (!referenced) images.remove(path);
    },
  };
  return {
    runMutation: <T>(work: () => T): T => uow.run(work),
    ...createCategoryUseCases({ categories, clock, ids }),
    ...createUnitUseCases({ units, clock, ids }),
    ...createBrandUseCases({ brands, images: catalogImages, clock, ids, uow }),
    ...createProductUseCases({
      categories,
      units,
      brands,
      products,
      variants,
      packaging,
      barcodes,
      images: catalogImages,
      clock,
      ids,
      uow
    })
  };
}

export type CatalogUseCases = ReturnType<typeof createSqliteCatalog>;
