type Constructor<T> = new (...args: never[]) => T;

export class Container {
  private readonly instances = new Map<string, unknown>();

  register<T>(key: string, instance: T): void {
    if (this.instances.has(key)) throw new Error(`Dependency already registered: ${key}`);
    this.instances.set(key, instance);
  }

  resolve<T>(key: string): T {
    if (!this.instances.has(key)) throw new Error(`Dependency not registered: ${key}`);
    return this.instances.get(key) as T;
  }
}

export type { Constructor };