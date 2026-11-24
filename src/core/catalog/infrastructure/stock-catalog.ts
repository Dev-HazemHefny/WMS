import type Database from "better-sqlite3";
import { Quantity } from "../../../shared/catalog/quantity";
import { ConversionFactor } from "../../../shared/catalog/conversion";
import { AppError } from "../../shared/errors/app-error";
import type { StockLine } from "../../../shared/ipc/stock";
import type { StockCatalog, StockItemDirectory } from "../public";
function fail(code: string): never {
  throw new AppError(code, code);
}
const selectStockItem = `SELECT coalesce(v.base_unit_id,p.base_unit_id) unit,
  p.allow_decimal_quantity decimals,s.product_id product,s.variant_id variant
  FROM stock_items s LEFT JOIN product_variants v ON v.id=s.variant_id
  JOIN products p ON p.id=coalesce(s.product_id,v.product_id)
  JOIN units u ON u.id=coalesce(v.base_unit_id,p.base_unit_id) WHERE s.id=?`;

export function createStockCatalog(db: Database.Database): StockCatalog & StockItemDirectory {
  const get = <T>(sql: string, ...args: unknown[]) =>
    db.prepare(sql).get(...args) as T | undefined;
  function resolveStockItem(line: StockLine, count: boolean) {
    const owner =
      get<{
        unit: string;
        decimals: number;
        product: string | null;
        variant: string | null;
      }>(
        `${selectStockItem} AND p.status='active' AND coalesce(v.status,'active')='active' AND u.status='active'`,
        line.item,
      ) ?? fail("ITEM_UNAVAILABLE");
    let factor = ConversionFactor.of(1, 1),
      enteredUnit = owner.unit;
    if (line.packaging) {
      const table = owner.variant
        ? "product_variant_packaging_units"
        : "product_packaging_units";
      const col = owner.variant ? "variant_id" : "product_id";
      const pack =
        get<{ n: number; d: number; unit: string }>(
          `SELECT conversion_numerator n,conversion_denominator d,unit_id unit FROM ${table} k JOIN units u ON u.id=k.unit_id JOIN units b ON b.id=? WHERE k.id=? AND k.${col}=? AND k.status='active' AND u.status='active' AND u.dimension=b.dimension AND u.dimension<>'other'`,
          owner.unit,
          line.packaging,
          owner.variant ?? owner.product,
        ) ?? fail("INVALID_PACKAGE");
      factor = ConversionFactor.of(pack.n, pack.d);
      enteredUnit = pack.unit;
    }
    const entered = Quantity.parse(
      line.quantity,
      Boolean(owner.decimals),
      count,
    );
    const base =
      entered.minor === 0n
        ? 0n
        : entered.toBase(factor, Boolean(owner.decimals)).minor;
    return {
      base,
      snapshot: JSON.stringify({
        ...line,
        enteredUnit,
        baseUnit: owner.unit,
        numerator: factor.numerator,
        denominator: factor.denominator,
        base: base.toString(),
      }),
    };
  }
  return {
    findStockItem(itemId) {
      const owner = get<{ unit: string }>(selectStockItem, itemId);
      return owner ? { baseUnitId: owner.unit } : null;
    },
    resolveStockItem,
    resolveBarcode(code: string) {
      return (
        get<{ item: string; packaging: string | null }>(
          "SELECT s.id item,coalesce(b.product_packaging_unit_id,b.variant_packaging_unit_id) packaging FROM barcodes b JOIN stock_items s ON s.product_id=b.product_id OR s.variant_id=b.variant_id WHERE b.code=?",
          code,
        ) ?? fail("BARCODE_NOT_FOUND")
      );
    },
  };
}
