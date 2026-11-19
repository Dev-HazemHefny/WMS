import { ConversionFactor } from "../../../shared/catalog/conversion";
import type {
  PackagingListItem,
  PackagingListQuery,
  PackagingUnit,
  PackagingView,
  Page,
  VariantAttribute,
  VariantListItem,
  VariantListQuery
} from "../../../shared/catalog/types";
import type { PackagingRepository, StoredVariant, VariantRepository } from "../domain/repositories";
import { likeTerm, pageClause, readCount, rethrowDb, type SqlDatabase } from "./sql";

interface VariantRow {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  base_unit_id: string;
  attributes_signature: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

interface PackagingRow {
  id: string;
  owner_id: string;
  unit_id: string;
  numerator: number;
  denominator: number;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  unit_name: string;
  unit_symbol: string;
}

function mapPackaging(row: PackagingRow, ownerType: "product" | "variant"): PackagingView {
  const factor = ConversionFactor.of(row.numerator, row.denominator);
  return {
    id: row.id,
    ownerType,
    ownerId: row.owner_id,
    unitId: row.unit_id,
    unitName: row.unit_name,
    unitSymbol: row.unit_symbol,
    numerator: factor.numerator,
    denominator: factor.denominator,
    factorLabel: factor.format(),
    status: row.status
  };
}

export class SqliteVariantRepository implements VariantRepository {
  constructor(private readonly db: SqlDatabase) {}

  insert(variant: StoredVariant): void {
    const write = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO product_variants
        (id, product_id, sku, name, base_unit_id, attributes_signature, status, created_at, updated_at)
        VALUES (@id, @productId, @sku, @name, @baseUnitId, @attributesSignature, @status, @createdAt, @updatedAt)`).run(variant);
      const insertAttribute = this.db.prepare(`INSERT INTO product_variant_attributes (id, variant_id, name, value) VALUES (?, ?, ?, ?)`);
      for (const attribute of variant.attributes) insertAttribute.run(attribute.id, variant.id, attribute.name, attribute.value);
    });
    try {
      write();
    } catch (error) {
      rethrowDb(error);
    }
  }

  update(variant: StoredVariant): void {
    const write = this.db.transaction(() => {
      this.db.prepare(`UPDATE product_variants
        SET sku=@sku, name=@name, base_unit_id=@baseUnitId, attributes_signature=@attributesSignature, status=@status, updated_at=@updatedAt
        WHERE id=@id`).run(variant);
      this.db.prepare("DELETE FROM product_variant_attributes WHERE variant_id = ?").run(variant.id);
      const insertAttribute = this.db.prepare(`INSERT INTO product_variant_attributes (id, variant_id, name, value) VALUES (?, ?, ?, ?)`);
      for (const attribute of variant.attributes) insertAttribute.run(attribute.id, variant.id, attribute.name, attribute.value);
    });
    try {
      write();
    } catch (error) {
      rethrowDb(error);
    }
  }

  delete(id: string): void {
    try {
      this.db.prepare("DELETE FROM product_variants WHERE id = ?").run(id);
    } catch (error) {
      rethrowDb(error);
    }
  }

  findById(id: string): StoredVariant | null {
    const row = this.db.prepare("SELECT * FROM product_variants WHERE id = ?").get(id) as VariantRow | undefined;
    if (!row) return null;
    return this.hydrate(row);
  }

  listByProduct(productId: string): StoredVariant[] {
    const rows = this.db.prepare("SELECT * FROM product_variants WHERE product_id = ? ORDER BY name COLLATE NOCASE").all(productId) as VariantRow[];
    return rows.map((row) => this.hydrate(row));
  }

  list(query: VariantListQuery): Page<VariantListItem> {
    const term = likeTerm(query.search);
    const filters = `WHERE (? IS NULL OR v.name LIKE ? ESCAPE '\\' OR v.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR v.attributes_signature LIKE ? ESCAPE '\\')
      AND (? IS NULL OR v.status = ?)
      AND (? IS NULL OR v.product_id = ?)`;
    const params = [term, term, term, term, term, query.status ?? null, query.status ?? null, query.productId ?? null, query.productId ?? null];
    const from = `FROM product_variants v JOIN products p ON p.id = v.product_id JOIN units u ON u.id = v.base_unit_id`;
    const total = readCount(this.db, `SELECT COUNT(*) AS total ${from} ${filters}`, params);
    const { limit, offset } = pageClause(query.page, query.pageSize);
    const rows = this.db.prepare(`SELECT v.id, v.product_id, p.name AS product_name, v.sku, v.name, v.attributes_signature, v.status, u.name AS unit_name
      ${from} ${filters} ORDER BY p.name COLLATE NOCASE, v.name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<{
      id: string;
      product_id: string;
      product_name: string;
      sku: string;
      name: string;
      attributes_signature: string;
      status: "active" | "inactive";
      unit_name: string;
    }>;
    return {
      items: rows.map((row) => ({
        id: row.id,
        productId: row.product_id,
        productName: row.product_name,
        sku: row.sku,
        name: row.name,
        attributeSummary: row.attributes_signature.split("|").map((part) => part.replace("=", ": ")).join("، "),
        status: row.status,
        baseUnitName: row.unit_name
      })),
      total,
      page: query.page,
      pageSize: query.pageSize
    };
  }

  findBySignature(productId: string, signature: string): string | null {
    const row = this.db.prepare("SELECT id FROM product_variants WHERE product_id = ? AND attributes_signature = ?").get(productId, signature) as { id: string } | undefined;
    return row?.id ?? null;
  }

  countDependents(id: string): { barcodes: number; packaging: number } {
    return this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM barcodes WHERE variant_id = ?) AS barcodes,
      (SELECT COUNT(*) FROM product_variant_packaging_units WHERE variant_id = ?) AS packaging`).get(id, id) as { barcodes: number; packaging: number };
  }

  private hydrate(row: VariantRow): StoredVariant {
    const attributes = this.db.prepare("SELECT id, name, value FROM product_variant_attributes WHERE variant_id = ? ORDER BY name COLLATE NOCASE").all(row.id) as VariantAttribute[];
    return {
      id: row.id,
      productId: row.product_id,
      sku: row.sku,
      name: row.name,
      baseUnitId: row.base_unit_id,
      attributesSignature: row.attributes_signature,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attributes
    };
  }
}

export class SqlitePackagingRepository implements PackagingRepository {
  constructor(private readonly db: SqlDatabase) {}

  insert(unit: PackagingUnit): void {
    const table = unit.ownerType === "product" ? "product_packaging_units" : "product_variant_packaging_units";
    const ownerColumn = unit.ownerType === "product" ? "product_id" : "variant_id";
    try {
      this.db.prepare(`INSERT INTO ${table}
        (id, ${ownerColumn}, unit_id, conversion_numerator, conversion_denominator, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(unit.id, unit.ownerId, unit.unitId, unit.numerator, unit.denominator, unit.status, unit.createdAt, unit.updatedAt);
    } catch (error) {
      rethrowDb(error);
    }
  }

  update(unit: PackagingUnit): void {
    const table = unit.ownerType === "product" ? "product_packaging_units" : "product_variant_packaging_units";
    try {
      this.db.prepare(`UPDATE ${table}
        SET unit_id=?, conversion_numerator=?, conversion_denominator=?, status=?, updated_at=?
        WHERE id=?`).run(unit.unitId, unit.numerator, unit.denominator, unit.status, unit.updatedAt, unit.id);
    } catch (error) {
      rethrowDb(error);
    }
  }

  delete(id: string): void {
    const current = this.findById(id);
    if (!current) return;
    const table = current.ownerType === "product" ? "product_packaging_units" : "product_variant_packaging_units";
    try {
      this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    } catch (error) {
      rethrowDb(error);
    }
  }

  findById(id: string): PackagingUnit | null {
    const product = this.db.prepare("SELECT * FROM product_packaging_units WHERE id = ?").get(id) as (PackagingRow & { product_id: string }) | undefined;
    if (product) return this.mapUnit(product, "product", product.product_id);
    const variant = this.db.prepare("SELECT * FROM product_variant_packaging_units WHERE id = ?").get(id) as (PackagingRow & { variant_id: string }) | undefined;
    if (variant) return this.mapUnit(variant, "variant", variant.variant_id);
    return null;
  }

  listForOwner(ownerType: "product" | "variant", ownerId: string): PackagingView[] {
    const table = ownerType === "product" ? "product_packaging_units" : "product_variant_packaging_units";
    const column = ownerType === "product" ? "product_id" : "variant_id";
    const rows = this.db.prepare(`SELECT p.id, p.${column} AS owner_id, p.unit_id, p.conversion_numerator AS numerator,
      p.conversion_denominator AS denominator, p.status, p.created_at, p.updated_at, u.name AS unit_name, u.symbol AS unit_symbol
      FROM ${table} p JOIN units u ON u.id = p.unit_id
      WHERE p.${column} = ? ORDER BY u.name COLLATE NOCASE`).all(ownerId) as PackagingRow[];
    return rows.map((row) => mapPackaging(row, ownerType));
  }

  list(query: PackagingListQuery): Page<PackagingListItem> {
    const term = likeTerm(query.search);
    const sql = `
      SELECT * FROM (
        SELECT p.id, 'product' AS owner_type, p.product_id AS owner_id, pr.name AS owner_name, pr.id AS product_id, pr.name AS product_name,
          p.unit_id, u.name AS unit_name, u.symbol AS unit_symbol, p.conversion_numerator AS numerator, p.conversion_denominator AS denominator, p.status
        FROM product_packaging_units p
        JOIN products pr ON pr.id = p.product_id
        JOIN units u ON u.id = p.unit_id
        UNION ALL
        SELECT p.id, 'variant' AS owner_type, p.variant_id AS owner_id, v.name AS owner_name, pr.id AS product_id, pr.name AS product_name,
          p.unit_id, u.name AS unit_name, u.symbol AS unit_symbol, p.conversion_numerator AS numerator, p.conversion_denominator AS denominator, p.status
        FROM product_variant_packaging_units p
        JOIN product_variants v ON v.id = p.variant_id
        JOIN products pr ON pr.id = v.product_id
        JOIN units u ON u.id = p.unit_id
      ) packaging
      WHERE (? IS NULL OR owner_name LIKE ? ESCAPE '\\' OR product_name LIKE ? ESCAPE '\\' OR unit_name LIKE ? ESCAPE '\\')
        AND (? IS NULL OR status = ?)
        AND (? IS NULL OR product_id = ?)`;
    const params = [term, term, term, term, query.status ?? null, query.status ?? null, query.productId ?? null, query.productId ?? null];
    const total = readCount(this.db, `SELECT COUNT(*) AS total FROM (${sql}) counted`, params);
    const { limit, offset } = pageClause(query.page, query.pageSize);
    const rows = this.db.prepare(`${sql} ORDER BY product_name COLLATE NOCASE, owner_name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<PackagingRow & {
      owner_type: "product" | "variant";
      owner_name: string;
      product_id: string;
      product_name: string;
    }>;
    return {
      items: rows.map((row) => ({
        ...mapPackaging(row, row.owner_type),
        ownerName: row.owner_name,
        productId: row.product_id,
        productName: row.product_name
      })),
      total,
      page: query.page,
      pageSize: query.pageSize
    };
  }

  findByOwnerAndUnit(ownerType: "product" | "variant", ownerId: string, unitId: string): PackagingUnit | null {
    const table = ownerType === "product" ? "product_packaging_units" : "product_variant_packaging_units";
    const column = ownerType === "product" ? "product_id" : "variant_id";
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE ${column} = ? AND unit_id = ?`).get(ownerId, unitId) as (PackagingRow & { product_id?: string; variant_id?: string }) | undefined;
    return row ? this.mapUnit(row, ownerType, ownerId) : null;
  }

  countBarcodeLinks(id: string): number {
    return readCount(this.db, `SELECT
      (SELECT COUNT(*) FROM barcodes WHERE product_packaging_unit_id = ?) +
      (SELECT COUNT(*) FROM barcodes WHERE variant_packaging_unit_id = ?) AS total`, [id, id]);
  }

  hasFractionalForProduct(productId: string): boolean {
    const total = readCount(this.db, `SELECT
      (SELECT COUNT(*) FROM product_packaging_units WHERE product_id = ? AND conversion_denominator != 1) +
      (SELECT COUNT(*) FROM product_variant_packaging_units vp
        JOIN product_variants v ON v.id = vp.variant_id
        WHERE v.product_id = ? AND vp.conversion_denominator != 1) AS total`, [productId, productId]);
    return total > 0;
  }

  private mapUnit(row: { id: string; unit_id: string; conversion_numerator?: number; numerator?: number; conversion_denominator?: number; denominator?: number; status: "active" | "inactive"; created_at: string; updated_at: string }, ownerType: "product" | "variant", ownerId: string): PackagingUnit {
    return {
      id: row.id,
      ownerType,
      ownerId,
      unitId: row.unit_id,
      numerator: row.conversion_numerator ?? row.numerator ?? 0,
      denominator: row.conversion_denominator ?? row.denominator ?? 1,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
