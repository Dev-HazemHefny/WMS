import { AppError } from "../../shared/errors/app-error";

const messages = {
  INVALID_STOCK_IDENTITY: "معرّفات الصنف أو المخزن أو موقع التخزين غير صالحة",
  LOCATION_WAREHOUSE_MISMATCH: "الموقع لا يتبع هذا المخزن",
  INVALID_STOCK_BALANCE: "بيانات رصيد المخزون غير صالحة",
  NEGATIVE_STOCK: "لا يمكن أن يكون رصيد المخزون سالبًا",
  INSUFFICIENT_STOCK: "رصيد المخزون غير كافٍ",
  INCONSISTENT_STOCK_TOTAL: "يجب أن تخص الأرصدة صنفًا واحدًا وألا يتكرر موقع التخزين",
} as const;

export class InventoryDomainError extends AppError {
  constructor(code: keyof typeof messages) {
    super(messages[code], code);
    this.name = "InventoryDomainError";
  }
}
