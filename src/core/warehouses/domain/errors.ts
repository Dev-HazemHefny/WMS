import { AppError } from "../../shared/errors/app-error";

export class WarehouseDomainError extends AppError {
  constructor(code: string, message: string) {
    super(message, code);
    this.name = "WarehouseDomainError";
  }
}
