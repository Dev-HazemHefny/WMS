import { ConversionFactor } from "./conversion";
import { CatalogValidationError } from "./errors";

const SCALE = 1_000n;

/**
 * Quantity stored as an integer number of thousandths.
 * Conversion multiplies the scaled value and rejects any remainder.
 */
export class Quantity {
  private constructor(readonly minor: bigint) {
    if (minor > 9223372036854775807n) throw new CatalogValidationError("QUANTITY_OVERFLOW", "الكمية تتجاوز الحد المسموح");
  }

  static parse(input: string, allowDecimal: boolean, allowZero = false): Quantity {
    let raw = input.trim().replace(/\s/g, "");
    if (/^\d+,\d+$/.test(raw)) raw = raw.replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(raw)) {
      throw new CatalogValidationError("INVALID_QUANTITY", "الكمية غير صالحة");
    }
    const [whole, fraction = ""] = raw.split(".");
    if (fraction.length > 3) {
      throw new CatalogValidationError("QUANTITY_PRECISION", "دقة الكمية تتجاوز ثلاث خانات عشرية");
    }
    if (!allowDecimal && /[1-9]/.test(fraction)) {
      throw new CatalogValidationError("DECIMAL_NOT_ALLOWED", "هذا الصنف لا يسمح بالكميات العشرية");
    }
    const minor = BigInt(whole) * SCALE + BigInt((fraction + "000").slice(0, 3));
    if (minor === 0n && !allowZero) throw new CatalogValidationError("INVALID_QUANTITY", "يجب أن تكون الكمية أكبر من صفر");
    return new Quantity(minor);
  }

  /** Converts a packaging quantity into base-unit quantity without rounding. */
  toBase(factor: ConversionFactor, allowDecimal: boolean): Quantity {
    const product = this.minor * BigInt(factor.numerator);
    const denominator = BigInt(factor.denominator);
    if (product % denominator !== 0n) {
      throw new CatalogValidationError("INEXACT_CONVERSION", "لا يمكن تحويل الكمية بدقة باستخدام عامل التحويل الحالي");
    }
    const minor = product / denominator;
    if (minor <= 0n) throw new CatalogValidationError("INVALID_QUANTITY", "يجب أن تكون الكمية أكبر من صفر");
    if (!allowDecimal && minor % SCALE !== 0n) {
      throw new CatalogValidationError("DECIMAL_NOT_ALLOWED", "ناتج التحويل يحتوي على كمية عشرية وهذا الصنف لا يسمح بذلك");
    }
    return new Quantity(minor);
  }

  format(): string {
    const whole = this.minor / SCALE;
    const fraction = (this.minor % SCALE).toString().padStart(3, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  }
}
