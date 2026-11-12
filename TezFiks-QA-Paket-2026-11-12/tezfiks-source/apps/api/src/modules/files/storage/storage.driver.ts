/** Injection token of the active StorageDriver (local disk or S3-compatible). */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/** Object storage port. Keys look like "<kind>/<yyyy>/<mm>/<uuid>.jpg". */
export interface StorageDriver {
  readonly name: 'local' | 's3' | string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Returns the object bytes, or null when the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  /** Deletes the object; deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
}
