export interface Clock {
  nowIso(): string;
}

export interface IdGenerator {
  next(): string;
}

export interface TransactionEffects {
  onCommit(cleanup: () => void): void;
  onRollback(cleanup: () => void): void;
}

export interface UnitOfWork {
  run<T>(work: (effects: TransactionEffects) => T): T;
}

export interface ImageStorage {
  save(input: { dataUrl: string; folder: string; fileName: string }): string;
  read(relativePath: string): string | null;
  remove(relativePath: string): void;
}

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString()
};

export const systemIds: IdGenerator = {
  next: () => crypto.randomUUID()
};
