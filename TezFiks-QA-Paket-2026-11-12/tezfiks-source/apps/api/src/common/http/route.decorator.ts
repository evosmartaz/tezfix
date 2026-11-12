import { applyDecorators, HttpCode, RequestMapping, RequestMethod, SetMetadata } from '@nestjs/common';
import type { Endpoint } from '@tezfiks/shared';

export const ENDPOINT_META = 'tezfiks:endpoint';

/** Every endpoint bound with @Route, for the contract-coverage test. */
export const REGISTERED_ENDPOINTS = new Set<Endpoint>();

/**
 * Binds a controller method to a contract endpoint: HTTP method, path, auth kind, input parsing and
 * (when CONTRACT_VALIDATE_RESPONSES=true) response validation all come from the shared contract.
 * Controllers must use @Controller() without a path.
 */
export function Route(endpoint: Endpoint): MethodDecorator {
  REGISTERED_ENDPOINTS.add(endpoint);
  return applyDecorators(
    RequestMapping({ path: endpoint.path, method: RequestMethod[endpoint.method] }),
    SetMetadata(ENDPOINT_META, endpoint),
    HttpCode(200),
  );
}
