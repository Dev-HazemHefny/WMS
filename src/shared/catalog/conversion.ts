import { CatalogValidationError } from "./errors";

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/** Exact positive conversion factor stored as a reduced integer ratio. */
export class ConversionFactor {
  private constructor(
    readonly numerator: number,
    readonly denominator: number
  ) {}

  static of(numerator: number, denominator: number): ConversionFactor {
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator <= 0 || denominator <= 0) {
      throw new CatalogValidationError("INVALID_FACTOR", "عامل التحويل يجب أن يكون رقمًا موجبًا");
    }
    const divisor = gcd(BigInt(numerator), BigInt(denominator));
    return new ConversionFactor(Number(BigInt(numerator) / divisor), Number(BigInt(denominator) / divisor));
  }

  static parse(input: string): ConversionFactor {
    let raw = input.trim().replace(/\s/g, "");
    if (!raw) throw new CatalogValidationError("INVALID_FACTOR", "عامل التحويل مطلوب");
    if (/^\d+,\d+$/.test(raw)) raw = raw.replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(raw)) {
      throw new CatalogValidationError("INVALID_FACTOR", "عامل التحويل يجب أن يكون رقمًا موجبًا");
    }
    const [whole, fraction = ""] = raw.split(".");
    if (fraction.length > 6) {
      throw new CatalogValidationError("FACTOR_PRECISION", "عامل التحويل يتجاوز ست خانات عشرية");
    }
    if (/^0+$/.test(whole) && (!fraction || /^0+$/.test(fraction))) {
      throw new CatalogValidationError("INVALID_FACTOR", "عامل التحويل يجب أن يكون أكبر من صفر");
    }
    const scale = 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole) * scale + BigInt(fraction || "0");
    const divisor = gcd(numerator, scale);
    const reducedNumerator = numerator / divisor;
    const reducedDenominator = scale / divisor;
    if (!isSafe(reducedNumerator) || !isSafe(reducedDenominator)) {
      throw new CatalogValidationError("INVALID_FACTOR", "عامل التحويل كبير جدًا");
    }
    return new ConversionFactor(Number(reducedNumerator), Number(reducedDenominator));
  }

  isWhole(): boolean {
    return this.denominator === 1;
  }

  format(): string {
    if (this.denominator === 1) return String(this.numerator);
    const numerator = BigInt(this.numerator);
    const denominator = BigInt(this.denominator);
    const whole = numerator / denominator;
    let remainder = numerator % denominator;
    let digits = "";
    for (let place = 0; place < 6 && remainder !== 0n; place += 1) {
      remainder *= 10n;
      digits += (remainder / denominator).toString();
      remainder %= denominator;
    }
    if (remainder !== 0n) return `${this.numerator}/${this.denominator}`;
    const trimmed = digits.replace(/0+$/, "");
    return trimmed ? `${whole}.${trimmed}` : whole.toString();
  }
}

function isSafe(value: bigint): boolean {
  return value <= BigInt(Number.MAX_SAFE_INTEGER);
}
