import { v7 } from 'uuid';
import { randomBytes } from 'node:crypto';

/** Time-ordered UUID v7 (index friendly, sortable by creation). */
export function newId(): string {
  return v7();
}

/** URL-safe random token. */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}
