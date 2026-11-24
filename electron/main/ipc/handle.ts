import type { ZodIssue, ZodType, ZodTypeDef } from "zod";
import { AppError } from "../../../src/core/shared/errors/app-error";
import { CatalogValidationError } from "../../../src/shared/catalog/errors";
import type { IpcResult } from "../../../src/shared/ipc/result";

type Executor<TInput, TOutput> = (input: TInput) => TOutput | Promise<TOutput>;
type IpcError = Extract<IpcResult<never>, { ok: false }>["error"];
export type ValidationErrorMapper = (issues: readonly ZodIssue[]) => IpcError;

/** Maps every known error to a safe renderer-facing payload. */
export function toIpcError(error: unknown): IpcError {
  if (error instanceof AppError)
    return { code: error.code, message: error.message };
  if (error instanceof CatalogValidationError)
    return { code: error.code, message: error.message };
  // Unexpected error: hide internal details from the renderer.
  return { code: "INTERNAL_ERROR", message: "حدث خطأ غير متوقع" };
}

/**
 * Wraps a use-case execution behind a typed IPC boundary.
 *
 * - Validates input with Zod.
 * - Maps domain/validation errors to an Arabic user-facing message.
 * - Never leaks stack traces or internal database details to the renderer.
 */
export function handle<Parsed, Raw, TOutput>(deps: {
  schema: ZodType<Parsed, ZodTypeDef, Raw>;
  execute: Executor<NoInfer<Parsed>, TOutput>;
  validationError?: ValidationErrorMapper;
}): (input: unknown) => Promise<IpcResult<TOutput>> {
  return async (raw: unknown) => {
    try {
      const parsed = deps.schema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: deps.validationError?.(parsed.error.issues) ?? {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "بيانات الطلب غير صالحة",
          },
        };
      }

      const data = await deps.execute(parsed.data);
      return { ok: true, data };
    } catch (error) {
      const mapped = toIpcError(error);
      if (mapped.code === "INTERNAL_ERROR")
        console.error(
          JSON.stringify({
            level: "error",
            event: "ipc.failed",
            type: error instanceof Error ? error.name : "unknown",
          }),
        );
      return { ok: false, error: mapped };
    }
  };
}
