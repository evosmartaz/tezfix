/** Failure of a company page data load (serializable: rendered by <CompanyLoadError>). */
export interface CompanyLoadError {
  ok: false;
  /** API error code; NOT_FOUND also covers HTTP 404 from endpoints that are not deployed yet (lanes B3/B4). */
  code: string;
  status: number;
  /** Already localized. */
  message: string;
}

export type Loaded<T> = { ok: true; data: T } | CompanyLoadError;
