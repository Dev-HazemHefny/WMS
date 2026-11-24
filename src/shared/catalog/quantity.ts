import { ConversionFactor } from "./conversion";
import { CatalogValidationError } from "./errors";

const SCALE = 1_000n;
const MIN_SCALED = -(2n ** 63n);
const MAX_SCALED = -MIN_SCALED - 1n;

/** Formats exact thousandths, including diagnostic totals outside the storage range. */
export function formatScaledQuantity(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const magnitude = minor < 0n ? -minor : minor;
  const fraction = (magnitude % SCALE).toString().padStart(3, "0");
  return `${sign}${magnitude / SCALE}.${fraction}`;
}

function invalidQuantity(): never {
  throw new CatalogValidationError("INVALID_QUANTITY", "الكمية غير صالحة");
}

function parseMinor(input: string): bigint {
  const parts = /^(-?)(\d+)(?:\.(\d+))?$/.exec(input);
  if (!parts) invalidQuantity();
  const [, sign, whole, fraction = ""] = parts;
  if (fraction.length > 3) {
    throw new CatalogValidationError("QUANTITY_PRECISION", "دقة الكمية تتجاوز ثلاث خانات عشرية");
  }
  const magnitude = BigInt(whole) * SCALE + BigInt(fraction.padEnd(3, "0"));
  return sign === "-" ? -magnitude : magnitude;
}

function assertDecimalAllowed(minor: bigint, allowDecimal: boolean, message: string): void {
  if (!allowDecimal && minor % SCALE !== 0n) {
    throw new CatalogValidationError("DECIMAL_NOT_ALLOWED", message);
  }
}

/**
 * Quantity stored as an integer number of thousandths.
 * Conversion multiplies the scaled value and rejects any remainder.
 */
export class Quantity {
  private constructor(readonly minor: bigint) {
    if (typeof minor !== "bigint") invalidQuantity();
    if (minor < MIN_SCALED || minor > MAX_SCALED) {
      throw new CatalogValidationError("QUANTITY_OVERFLOW", "الكمية تتجاوز الحد المسموح");
    }
    Object.freeze(this);
  }

  static fromDecimal(input: string): Quantity {
    if (typeof input !== "string" || input.trim() !== input) invalidQuantity();
    return Quantity.fromScaled(parseMinor(input));
  }

  static fromScaled(scaled: bigint | number): Quantity {
    if (typeof scaled !== "bigint" && !Number.isSafeInteger(scaled)) invalidQuantity();
    return new Quantity(BigInt(scaled));
  }

  static parse(input: string, allowDecimal: boolean, allowZero = false): Quantity {
    let raw = input.trim().replace(/\s/g, "");
    if (/^\d+,\d+$/.test(raw)) raw = raw.replace(",", ".");
    if (raw.startsWith("-")) invalidQuantity();
    const minor = parseMinor(raw);
    assertDecimalAllowed(minor, allowDecimal, "هذا الصنف لا يسمح بالكميات العشرية");
    if (minor === 0n && !allowZero) throw new CatalogValidationError("INVALID_QUANTITY", "يجب أن تكون الكمية أكبر من صفر");
    return Quantity.fromScaled(minor);
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
    assertDecimalAllowed(minor, allowDecimal, "ناتج التحويل يحتوي على كمية عشرية وهذا الصنف لا يسمح بذلك");
    return Quantity.fromScaled(minor);
  }

  assertDecimalAllowed(allowDecimal: boolean): void {
    assertDecimalAllowed(this.minor, allowDecimal, "هذا الصنف لا يسمح بالكميات العشرية");
  }

  add(other: Quantity): Quantity {
    return Quantity.fromScaled(this.minor + other.minor);
  }

  subtract(other: Quantity): Quantity {
    return Quantity.fromScaled(this.minor - other.minor);
  }

  compare(other: Quantity): -1 | 0 | 1 {
    if (this.minor === other.minor) return 0;
    return this.minor < other.minor ? -1 : 1;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  toDecimalString(): string {
    return formatScaledQuantity(this.minor);
  }

  format(): string {
    return this.toDecimalString().replace(/0+$/, "").replace(/\.$/, "");
  }
}
