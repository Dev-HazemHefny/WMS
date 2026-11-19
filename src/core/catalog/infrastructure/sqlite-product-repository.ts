import type { Page, Product, ProductListItem, ProductListQuery, ProductLookup } from "../../../shared/catalog/types";
import type { ProductRepository } from "../domain/repositories";
import { likeTerm, pageClause, readCount, rethrowDb, type SqlDatabase } from "./sql";

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  category_id: string;
  base_unit_id: string;
  description: string | null;
  image_path: string | null;
  brand_id: string | null;
  product_type: "simple" | "with_variants";
  allow_decimal_quantity: number;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    categoryId: row.category_id,
    baseUnitId: row.base_unit_id,
    description: row.description,
    imagePath: row.image_path,
    brandId: row.brand_id,
    productType: row.product_type,
    allowDecimalQuantity: row.allow_decimal_quantity === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteProductRepository implements ProductRepository {
  constructor(private readonly db: SqlDatabase) {}

  insert(product: Product): void {
    try {
      this.db.prepare(`INSERT INTO products
        (id, name, sku, category_id, base_unit_id, description, image_path, brand_id, product_type, allow_decimal_quantity, status, created_at, updated_at)
        VALUES (@id, @name, @sku, @categoryId, @baseUnitId, @description, @imagePath, @brandId, @productType, @allowDecimalQuantity, @status, @createdAt, @updatedAt)`)
        .run({ ...product, allowDecimalQuantity: product.allowDecimalQuantity ? 1 : 0 });
    } catch (error) {
      rethrowDb(error);
    }
  }

  update(product: Product): void {
    try {
      this.db.prepare(`UPDATE products SET
        name=@name, sku=@sku, category_id=@categoryId, base_unit_id=@baseUnitId, description=@description,
        image_path=@imagePath, brand_id=@brandId, product_type=@productType, allow_decimal_quantity=@allowDecimalQuantity,
        status=@status, updated_at=@updatedAt
        WHERE id=@id`).run({ ...product, allowDecimalQuantity: product.allowDecimalQuantity ? 1 : 0 });
    } catch (error) {
      rethrowDb(error);
    }
  }

  delete(id: string): void {
    try {
      this.db.prepare("DELETE FROM products WHERE id = ?").run(id);
    } catch (error) {
      rethrowDb(error);
    }
  }

  findById(id: string): Product | null {
    const row = this.db.prepare("SELECT * FROM products WHERE id = ?").get(id) as ProductRow | undefined;
    return row ? mapProduct(row) : null;
  }

  list(query: ProductListQuery): Page<ProductListItem> {
    const term = likeTerm(query.search);
    const filters = `WHERE (? IS NULL OR p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'
        OR IFNULL(b.name,'') LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM barcodes bc
          WHERE bc.code LIKE ? ESCAPE '\\' AND (
            bc.product_id = p.id OR bc.variant_id IN (SELECT id FROM product_variants WHERE product_id = p.id)
          )
        ))
      AND (? IS NULL OR p.status = ?)
      AND (? IS NULL OR p.category_id = ?)
      AND (? IS NULL OR p.brand_id = ?)
      AND (? IS NULL OR p.product_type = ?)`;
    const params = [
      term, term, term, term, term, term,
      query.status ?? null, query.status ?? null,
      query.categoryId ?? null, query.categoryId ?? null,
      query.brandId ?? null, query.brandId ?? null,
      query.productType ?? null, query.productType ?? null
    ];
    const from = `FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = p.base_unit_id
      LEFT JOIN brands b ON b.id = p.brand_id`;
    const total = readCount(this.db, `SELECT COUNT(*) AS total ${from} ${filters}`, params);
    const { limit, offset } = pageClause(query.page, query.pageSize);
    const rows = this.db.prepare(`SELECT p.id, p.name, p.sku, c.name AS category_name, b.name AS brand_name,
      u.name AS unit_name, u.symbol AS unit_symbol, p.product_type, p.status, p.updated_at
      ${from} ${filters}
      ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<{
      id: string;
      name: string;
      sku: string;
      category_name: string;
      brand_name: string | null;
      unit_name: string;
      unit_symbol: string;
      product_type: "simple" | "with_variants";
      status: "active" | "inactive";
      updated_at: string;
    }>;
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        sku: row.sku,
        categoryName: row.category_name,
        brandName: row.brand_name,
        baseUnitName: row.unit_name,
        baseUnitSymbol: row.unit_symbol,
        productType: row.product_type,
        status: row.status,
        updatedAt: row.updated_at
      })),
      total,
      page: query.page,
      pageSize: query.pageSize
    };
  }

  lookup(): ProductLookup[] {
    const rows = this.db.prepare(`SELECT id, name, sku, product_type, status, base_unit_id FROM products ORDER BY name COLLATE NOCASE`).all() as Array<{
      id: string;
      name: string;
      sku: string;
      product_type: "simple" | "with_variants";
      status: "active" | "inactive";
      base_unit_id: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      productType: row.product_type,
      status: row.status,
      baseUnitId: row.base_unit_id
    }));
  }

  countDependents(id: string): { variants: number; barcodes: number; packaging: number } {
    const row = this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM product_variants WHERE product_id = ?) AS variants,
      (SELECT COUNT(*) FROM barcodes WHERE product_id = ?) AS barcodes,
      (SELECT COUNT(*) FROM product_packaging_units WHERE product_id = ?) AS packaging`).get(id, id, id) as {
      variants: number;
      barcodes: number;
      packaging: number;
    };
    return row;
  }

  skuOwner(sku: string): { ownerType: "product" | "variant"; ownerId: string } | null {
    const row = this.db.prepare("SELECT owner_type, owner_id FROM sku_registry WHERE sku = ?").get(sku) as
      | { owner_type: "product" | "variant"; owner_id: string }
      | undefined;
    return row ? { ownerType: row.owner_type, ownerId: row.owner_id } : null;
  }
}
