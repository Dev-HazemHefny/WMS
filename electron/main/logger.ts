export interface Logger {
  info(message: string, metadata?: unknown): void;
  error(message: string, error?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    info: (message, metadata) => console.info(`[${scope}] ${message}`, metadata ?? ""),
    error: (message, error) => console.error(`[${scope}] ${message}`, error ?? "")
  };
}