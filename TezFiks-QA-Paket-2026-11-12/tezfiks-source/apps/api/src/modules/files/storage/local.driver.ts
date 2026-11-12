import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { StorageDriver } from './storage.driver';

/** Stores objects on a local disk volume (STORAGE_LOCAL_DIR). */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  /** Resolves a key inside the root; rejects keys that escape it. */
  private path(key: string): string {
    const p = resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return p;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
