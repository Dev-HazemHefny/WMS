export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "حدث خطأ غير متوقع. حاول مرة أخرى.";
}

export function confirmDelete(message: string): boolean {
  return window.confirm(message);
}
