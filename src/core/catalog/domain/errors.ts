import { AppError } from "../../shared/errors/app-error";

export class DomainError extends AppError {
  constructor(code: string, message: string) {
    super(message, code);
  }
}
