import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * none  = public
 * user  = mobile/panel user access token (phone login)
 * admin = TezFiks admin access token
 * any   = user or admin
 */
export type AuthKind = 'none' | 'user' | 'admin' | 'any';

/** Non-JSON endpoints (HTML test checkout page, binary file download, redirects). */
export type RawKind = 'html' | 'binary' | 'redirect';

export interface Endpoint {
  readonly method: HttpMethod;
  /** Path relative to the API prefix (/tezfix/api), using :param placeholders. */
  readonly path: string;
  readonly auth: AuthKind;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly response: z.ZodType;
  /** Client sends an Idempotency-Key header; the server replays the stored result for a repeated key. */
  readonly idempotent?: boolean;
  /** Body is multipart/form-data (file upload); `body` describes the non-file fields. */
  readonly multipart?: boolean;
  readonly raw?: RawKind;
  readonly summary?: string;
}

/** Identity helper that keeps literal types of an endpoint definition. */
export function endpoint<const E extends Endpoint>(e: E): E {
  return e;
}

type ParamsPart<E> = E extends { params: infer S extends z.ZodType } ? { params: z.input<S> } : { params?: undefined };
type QueryPart<E> = E extends { query: infer S extends z.ZodType }
  ? {} extends z.input<S>
    ? { query?: z.input<S> }
    : { query: z.input<S> }
  : { query?: undefined };
type BodyPart<E> = E extends { multipart: true }
  ? { formData: FormData }
  : E extends { body: infer S extends z.ZodType }
    ? {} extends z.input<S>
      ? { body?: z.input<S> }
      : { body: z.input<S> }
    : { body?: undefined };

export interface CallOptions {
  /** Stable key for retries of the same logical operation (idempotent endpoints). Generated when omitted. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type EndpointInput<E extends Endpoint> = ParamsPart<E> & QueryPart<E> & BodyPart<E> & CallOptions;
export type EndpointOutput<E extends Endpoint> = z.output<E['response']>;
export type EndpointBody<E extends Endpoint> = E extends { body: infer S extends z.ZodType } ? z.output<S> : never;
export type EndpointQuery<E extends Endpoint> = E extends { query: infer S extends z.ZodType } ? z.output<S> : never;
export type EndpointParams<E extends Endpoint> = E extends { params: infer S extends z.ZodType } ? z.output<S> : never;

/** Recursively collects every Endpoint object from a nested api tree. */
export function collectEndpoints(tree: unknown, prefix = ''): Array<{ name: string; endpoint: Endpoint }> {
  const out: Array<{ name: string; endpoint: Endpoint }> = [];
  if (!tree || typeof tree !== 'object') return out;
  const obj = tree as Record<string, unknown>;
  if (typeof obj.method === 'string' && typeof obj.path === 'string' && 'response' in obj) {
    out.push({ name: prefix, endpoint: obj as unknown as Endpoint });
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    out.push(...collectEndpoints(value, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}
