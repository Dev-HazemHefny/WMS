import { z } from "zod";

const MAX_NAME = 200;
const MAX_CODE = 64;
const MAX_DESCRIPTION = 2000;
const MAX_ATTRIBUTE = 40;
const MAX_ATTRIBUTES = 8;
const MAX_IMAGE_BYTES = 1_500_000;

const requiredArabic = (label: string) => `${label} مطلوب`;
const tooLongArabic = (label: string) => `${label} طويل جدًا`;

const nonEmptyTrimmed = (label: string) =>
  z
    .string()
    .min(1, requiredArabic(label))
    .max(MAX_NAME, tooLongArabic(label))
    .transform((v) => v.trim());

const codeField = (label: string) =>
  z
    .string()
    .min(1, requiredArabic(label))
    .max(MAX_CODE, tooLongArabic(label))
    .regex(
      /^[\p{L}\p{N}][\p{L}\p{N}\-_.\/]{0,63}$/u,
      `${label} غير صالح. استخدم حروفًا أو أرقامًا بدون مسافات`
    )
    .transform((v) => v.trim());

const optionalDescription = () =>
  z
    .string()
    .max(MAX_DESCRIPTION, "الوصف طويل جدًا")
    .nullable()
    .optional()
    .transform((v: string | null | undefined): string | null => {
      if (v == null) return null;
      const trimmed = v.trim();
      return trimmed ? trimmed : null;
    });

const imageDataUrl = () =>
  z
    .string()
    .nullable()
    .optional()
    .refine(
      (v) => v == null || /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.test(v ?? ""),
      "صيغة الصورة غير مدعومة. استخدم PNG أو JPEG أو WEBP"
    )
    .refine(
      (v) => {
        if (v == null) return true;
        const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
        if (!match) return false;
        const bytes = Math.floor((match[2].length * 3) / 4);
        return bytes <= MAX_IMAGE_BYTES;
      },
      "حجم الصورة يتجاوز 1.5 ميجابايت"
    );

export const pageQuerySchema = z.object({
  search: z.string().nullish().transform(value => value ?? undefined),
  status: z.enum(["active", "inactive"]).nullish().transform(value => value ?? undefined),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const idPayloadSchema = z.object({
  id: z.string().min(1, "المعرف مطلوب")
});

export const categoryInputSchema = z.object({
  name: nonEmptyTrimmed("اسم التصنيف"),
  code: codeField("كود التصنيف"),
  description: optionalDescription(),
  parentId: z.string().nullable().optional().transform((v) => (v == null || v === "" ? null : v))
});

export const unitInputSchema = z.object({
  name: nonEmptyTrimmed("اسم الوحدة"),
  symbol: z
    .string()
    .min(1, "رمز الوحدة مطلوب")
    .max(16, "رمز وحدة القياس طويل جدًا")
    .regex(/^[\p{L}\p{N}°%./]{1,16}$/u, "رمز وحدة القياس غير صالح")
    .transform((v) => v.trim()),
  dimension: z.enum(["count", "mass", "volume", "length", "area", "other"]),
  description: optionalDescription()
});

export const brandInputSchema = z.object({
  name: nonEmptyTrimmed("اسم العلامة التجارية"),
  code: codeField("كود العلامة التجارية"),
  description: optionalDescription(),
  imageDataUrl: imageDataUrl()
});

const packagingDraftSchema = z.object({
  unitId: z.string().min(1, "وحدة التعبئة مطلوبة"),
  conversionFactor: z
    .string()
    .min(1, "عامل التحويل مطلوب")
    .refine(
      (v) => {
        const raw = v.trim().replace(/\s/g, "");
        if (!raw) return false;
        if (/^\d+,\d+$/.test(raw)) {
          return /^\d+(\.\d+)?$/.test(raw.replace(",", "."));
        }
        return /^\d+(\.\d+)?$/.test(raw);
      },
      "عامل التحويل يجب أن يكون رقمًا موجبًا"
    )
    .refine(
      (v) => {
        const raw = v.trim().replace(/\s/g, "");
        if (/^0+$/.test(raw.replace(".", "")) || /^0+,0+$/.test(raw)) return false;
        const num = parseFloat(raw.replace(",", "."));
        return Number.isFinite(num) && num > 0;
      },
      "عامل التحويل يجب أن يكون أكبر من صفر"
    )
});

const barcodeDraftSchema = z.object({
  code: z
    .string()
    .min(1, "قيمة الباركود مطلوبة")
    .max(64, "الباركود طويل جدًا")
    .regex(/^[0-9A-Za-z][0-9A-Za-z\-.$/+%]{0,63}$/, "قيمة الباركود غير صالحة")
    .transform((v) => v.trim()),
  packagingUnitId: z.string().nullable().optional().transform((v) => (v == null || v === "" ? null : v))
});

const variantAttributeSchema = z.object({
  name: z.string().min(1, "اسم الخاصية مطلوب").max(MAX_ATTRIBUTE, "اسم الخاصية طويل جدًا").trim(),
  value: z.string().min(1, "قيمة الخاصية مطلوبة").max(MAX_ATTRIBUTE, "قيمة الخاصية طويلة جدًا").trim()
});

const variantDraftSchema = z.object({
  name: nonEmptyTrimmed("اسم المتغير"),
  sku: codeField("كود المتغير"),
  baseUnitId: z.string().nullable().optional(),
  attributes: z
    .array(variantAttributeSchema)
    .min(1, "أضف خاصية واحدة على الأقل للمتغير")
    .max(MAX_ATTRIBUTES, "عدد خصائص المتغير كبير جدًا"),
  packaging: z.array(packagingDraftSchema).default([]),
  barcodes: z.array(barcodeDraftSchema).default([])
});

export const createVariantInputSchema = z.object({
  productId: z.string().min(1, "الصنف مطلوب"),
  name: nonEmptyTrimmed("اسم المتغير"),
  sku: codeField("كود المتغير"),
  baseUnitId: z.string().nullable().optional(),
  attributes: z
    .array(variantAttributeSchema)
    .min(1, "أضف خاصية واحدة على الأقل للمتغير")
    .max(MAX_ATTRIBUTES, "عدد خصائص المتغير كبير جدًا")
});

export const updateVariantInputSchema = z.object({
  id: z.string().min(1, "المعرف مطلوب"),
  name: nonEmptyTrimmed("اسم المتغير"),
  sku: codeField("كود المتغير"),
  baseUnitId: z.string().min(1, "وحدة القياس الأساسية مطلوبة"),
  attributes: z
    .array(variantAttributeSchema)
    .min(1, "أضف خاصية واحدة على الأقل للمتغير")
    .max(MAX_ATTRIBUTES, "عدد خصائص المتغير كبير جدًا")
});

export const productInputSchema = z.object({
  name: nonEmptyTrimmed("اسم الصنف"),
  sku: codeField("كود الصنف"),
  categoryId: z.string().min(1, "التصنيف مطلوب"),
  baseUnitId: z.string().min(1, "وحدة القياس الأساسية مطلوبة"),
  description: optionalDescription(),
  imageDataUrl: imageDataUrl(),
  brandId: z.string().nullable().optional().transform((v) => (v == null || v === "" ? null : v)),
  productType: z.enum(["simple", "with_variants"]),
  allowDecimalQuantity: z.coerce.boolean(),
  packaging: z.array(packagingDraftSchema).default([]),
  barcodes: z.array(barcodeDraftSchema).default([]),
  variants: z.array(variantDraftSchema).default([])
});

export const addPackagingInputSchema = z.object({
  ownerType: z.enum(["product", "variant"]),
  ownerId: z.string().min(1, "المالك مطلوب"),
  unitId: z.string().min(1, "وحدة القياس مطلوبة"),
  conversionFactor: z.string().min(1, "عامل التحويل مطلوب")
});

export const updatePackagingInputSchema = z.object({
  id: z.string().min(1, "المعرف مطلوب"),
  unitId: z.string().min(1, "وحدة القياس مطلوبة"),
  conversionFactor: z.string().min(1, "عامل التحويل مطلوب")
});

export const addBarcodeInputSchema = z.object({
  code: z
    .string()
    .min(1, "قيمة الباركود مطلوبة")
    .max(64, "الباركود طويل جدًا")
    .regex(/^[0-9A-Za-z][0-9A-Za-z\-.$/+%]{0,63}$/, "قيمة الباركود غير صالحة")
    .transform((v) => v.trim()),
  productId: z.string().nullable().optional(),
  variantId: z.string().nullable().optional(),
  packagingUnitId: z.string().nullable().optional()
});

export const mediaReadSchema = z.object({
  relativePath: z.string().min(1, "مسار الصورة مطلوب")
});
