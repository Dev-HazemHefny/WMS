import { DomainError } from "./errors";

const CODE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\-_.\/]{0,63}$/u;
const BARCODE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z\-.$/+%]{0,63}$/;
const SYMBOL_PATTERN = /^[\p{L}\p{N}°%./]{1,16}$/u;

export function parseRequiredText(value: string, label: string, max = 200): string {
  const text = value.trim();
  if (!text) throw new DomainError("REQUIRED", `${label} مطلوب`);
  if (text.length > max) throw new DomainError("TOO_LONG", `${label} طويل جدًا`);
  return text;
}

export function parseOptionalText(value: string | null | undefined, max = 2000): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new DomainError("TOO_LONG", "الوصف طويل جدًا");
  return text;
}

export function parseCode(value: string, label = "الكود"): string {
  const code = value.trim();
  if (!CODE_PATTERN.test(code)) {
    throw new DomainError("INVALID_CODE", `${label} غير صالح. استخدم حروفًا أو أرقامًا بدون مسافات`);
  }
  return code;
}

export function parseSku(value: string): string {
  return parseCode(value, "كود الصنف");
}

export function parseSymbol(value: string): string {
  const symbol = value.trim();
  if (!SYMBOL_PATTERN.test(symbol)) throw new DomainError("INVALID_SYMBOL", "رمز وحدة القياس غير صالح");
  return symbol;
}

export function parseBarcode(value: string): string {
  const code = value.trim();
  if (!BARCODE_PATTERN.test(code)) {
    throw new DomainError("INVALID_BARCODE", "قيمة الباركود غير صالحة");
  }
  return code;
}

export function parseAttributes(attributes: Array<{ name: string; value: string }>): {
  items: Array<{ name: string; value: string }>;
  signature: string;
} {
  if (attributes.length === 0) {
    throw new DomainError("ATTRIBUTES_REQUIRED", "أضف خاصية واحدة على الأقل للمتغير");
  }
  if (attributes.length > 8) throw new DomainError("ATTRIBUTES_LIMIT", "عدد خصائص المتغير كبير جدًا");

  const items = attributes.map((attribute) => ({
    name: parseRequiredText(attribute.name, "اسم الخاصية", 40),
    value: parseRequiredText(attribute.value, "قيمة الخاصية", 40)
  }));
  const names = new Set<string>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    if (names.has(key)) throw new DomainError("DUPLICATE_ATTRIBUTE", "لا يمكن تكرار اسم الخاصية داخل المتغير نفسه");
    names.add(key);
  }
  const signature = items
    .map((item) => `${item.name.toLowerCase()}=${item.value.toLowerCase()}`)
    .sort()
    .join("|");
  return { items, signature };
}

export function assertValidImageDataUrl(dataUrl: string): "png" | "jpg" | "webp" {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) {
    throw new DomainError("INVALID_IMAGE", "صيغة الصورة غير مدعومة. استخدم PNG أو JPEG أو WEBP");
  }
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > 1_500_000) throw new DomainError("IMAGE_TOO_LARGE", "حجم الصورة يتجاوز 1.5 ميجابايت");
  if (match[1] === "png") return "png";
  if (match[1] === "webp") return "webp";
  return "jpg";
}
