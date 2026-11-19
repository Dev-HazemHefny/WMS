import type { Barcode, BarcodeView, Page, PageQuery } from "../../../shared/catalog/types";
import type { BarcodeRepository } from "../domain/repositories";
import { likeTerm, pageClause, readCount, rethrowDb, type SqlDatabase } from "./sql";

interface BarcodeRow {
  id: string;
  code: string;
  product_id: string | null;
  variant_id: string | null;
  product_packaging_unit_id: string | null;
  variant_packaging_unit_id: string | null;
  created_at: string;
}

const viewSql = `
  SELECT b.id, b.code, b.product_id, b.variant_id, b.product_packaging_unit_id, b.variant_packaging_unit_id, b.created_at,
    COALESCE(vp.name, dp.name) AS product_name,
    v.name AS variant_name,
    COALESCE(pu.name, vu.name) AS packaging_name
  FROM barcodes b
  LEFT JOIN products dp ON dp.id = b.product_id
  LEFT JOIN product_variants v ON v.id = b.variant_id
  LEFT JOIN products vp ON vp.id = v.product_id
  LEFT JOIN product_packaging_units pp ON pp.id = b.product_packaging_unit_id
  LEFT JOIN units pu ON pu.id = pp.unit_id
  LEFT JOIN product_variant_packaging_units vpck ON vpck.id = b.variant_packaging_unit_id
  LEFT JOIN units vu ON vu.id = vpck.unit_id
`;

function mapBarcode(row: BarcodeRow): Barcode {
  return {
    id: row.id,
    code: row.code,
    productId: row.product_id,
    variantId: row.variant_id,
    productPackagingUnitId: row.product_packaging_unit_id,
    variantPackagingUnitId: row.variant_packaging_unit_id,
    createdAt: row.created_at
  };
}

function mapView(row: BarcodeRow & { product_name: string; variant_name: string | null; packaging_name: string | null }): BarcodeView {
  return {
    ...mapBarcode(row),
    productName: row.product_name,
    variantName: row.variant_name,
    packagingLabel: row.packaging_name
  };
}

export class SqliteBarcodeRepository implements BarcodeRepository {
  constructor(private readonly db: SqlDatabase) {}

  insert(barcode: Barcode): void {
    try {
      this.db.prepare(`INSERT INTO barcodes
        (id, code, product_id, variant_id, product_packaging_unit_id, variant_packaging_unit_id, created_at)
        VALUES (@id, @code, @productId, @variantId, @productPackagingUnitId, @variantPackagingUnitId, @createdAt)`).run(barcode);
    } catch (error) {
      rethrowDb(error);
    }
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM barcodes WHERE id = ?").run(id);
  }

  findById(id: string): Barcode | null {
    const row = this.db.prepare("SELECT * FROM barcodes WHERE id = ?").get(id) as BarcodeRow | undefined;
    return row ? mapBarcode(row) : null;
  }

  findByCode(code: string): Barcode | null {
    const row = this.db.prepare("SELECT * FROM barcodes WHERE code = ?").get(code) as BarcodeRow | undefined;
    return row ? mapBarcode(row) : null;
  }

  list(query: PageQuery): Page<BarcodeView> {
    const term = likeTerm(query.search);
    const filters = `WHERE (? IS NULL OR code LIKE ? ESCAPE '\\' OR product_name LIKE ? ESCAPE '\\' OR IFNULL(variant_name,'') LIKE ? ESCAPE '\\')`;
    const params = [term, term, term, term];
    const source = `SELECT * FROM (${viewSql}) barcode_view`;
    const total = readCount(this.db, `SELECT COUNT(*) AS total FROM (${source} ${filters}) counted`, params);
    const { limit, offset } = pageClause(query.page, query.pageSize);
    const rows = this.db.prepare(`${source} ${filters} ORDER BY product_name COLLATE NOCASE, code LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<BarcodeRow & {
      product_name: string;
      variant_name: string | null;
      packaging_name: string | null;
    }>;
    return { items: rows.map(mapView), total, page: query.page, pageSize: query.pageSize };
  }

  listForProduct(productId: string): BarcodeView[] {
    const rows = this.db.prepare(`${viewSql} WHERE b.product_id = ? OR v.product_id = ? ORDER BY b.code`).all(productId, productId) as Array<BarcodeRow & {
      product_name: string;
      variant_name: string | null;
      packaging_name: string | null;
    }>;
    return rows.map(mapView);
  }

  listForVariant(variantId: string): BarcodeView[] {
    const rows = this.db.prepare(`${viewSql} WHERE b.variant_id = ? ORDER BY b.code`).all(variantId) as Array<BarcodeRow & {
      product_name: string;
      variant_name: string | null;
      packaging_name: string | null;
    }>;
    return rows.map(mapView);
  }

  findViewByCode(code: string): BarcodeView | null {
    const row = this.db.prepare(`${viewSql} WHERE b.code = ?`).get(code) as (BarcodeRow & {
      product_name: string;
      variant_name: string | null;
      packaging_name: string | null;
    }) | undefined;
    return row ? mapView(row) : null;
  }
}
