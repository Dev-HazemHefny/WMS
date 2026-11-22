import { ZodError } from "zod";
import type { ZodType } from "zod";
import { AppError } from "../../../src/core/shared/errors/app-error";
import { CatalogValidationError } from "../../../src/shared/catalog/errors";
import type { IpcResult } from "../../../src/shared/ipc/result";

export type ZodSchema = ZodType<unknown, any, unknown>;

type Executor<TInput, TOutput> = (input: TInput) => TOutput | Promise<TOutput>;
type IpcError = Extract<IpcResult<never>, { ok: false }>["error"];

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
export function handle<TInput, TOutput>(deps: {
  schema: ZodSchema;
  execute: Executor<TInput, TOutput>;
}): (input: unknown) => Promise<IpcResult<TOutput>> {
  return async (raw: unknown) => {
    const parsed = deps.schema.safeParse(raw);
    if (!parsed.success) {
      const first = (parsed.error as ZodError).issues[0];
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: first?.message ?? "بيانات الطلب غير صالحة",
        },
      };
    }

    try {
      const data = await deps.execute(parsed.data as TInput);
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
