export interface Logger {
  info(message: string, metadata?: unknown): void;
  error(message: string, error?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    info: (message, metadata) => console.info(JSON.stringify({level:"info",scope,message,metadata,time:new Date().toISOString()})),
    error: (message, error) => console.error(JSON.stringify({level:"error",scope,message,error:error instanceof Error?error.message:undefined,time:new Date().toISOString()}))
  };
}