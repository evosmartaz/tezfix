/** Failure of a page data load (serializable: rendered by <LoadError>). */
export interface AdminLoadError {
  ok: false;
  /** API error code; NOT_FOUND also covers HTTP 404 from endpoints that are not deployed yet. */
  code: string;
  status: number;
  /** Already localized. */
  message: string;
}

export type Loaded<T> = { ok: true; data: T } | AdminLoadError;
