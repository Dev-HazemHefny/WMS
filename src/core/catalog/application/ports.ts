export interface Clock {
  nowIso(): string;
}

export interface IdGenerator {
  next(): string;
}

export interface UnitOfWork {
  run<T>(work: () => T): T;
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
