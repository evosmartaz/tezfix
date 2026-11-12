import { tzFold } from '@tezfiks/shared';

export const NAME_MAX = 60;

export interface NameErrors {
  firstName?: string;
  lastName?: string;
}

/** PATCH /me name rules (1–60 characters after trimming); Azerbaijani letters pass through untouched. */
export function validateNames(firstName: string, lastName: string): NameErrors {
  const e: NameErrors = {};
  const f = firstName.trim();
  const l = lastName.trim();
  if (!f) e.firstName = 'auth.firstNameRequired';
  else if (f.length > NAME_MAX) e.firstName = 'profile.nameTooLong';
  if (!l) e.lastName = 'auth.lastNameRequired';
  else if (l.length > NAME_MAX) e.lastName = 'profile.nameTooLong';
  return e;
}

/** PATCH /me body with only what changed (null when nothing changed). */
export function profilePatch(
  current: { firstName: string | null; lastName: string | null },
  next: { firstName: string; lastName: string; photoFileId?: string | null },
): { firstName?: string; lastName?: string; photoFileId?: string | null } | null {
  const body: { firstName?: string; lastName?: string; photoFileId?: string | null } = {};
  const f = next.firstName.trim();
  const l = next.lastName.trim();
  if (f !== (current.firstName ?? '')) body.firstName = f;
  if (l !== (current.lastName ?? '')) body.lastName = l;
  if (next.photoFileId !== undefined) body.photoFileId = next.photoFileId;
  return Object.keys(body).length ? body : null;
}

/** "Type SİL to confirm": case- and dotted/dotless-i-insensitive (sil, SIL, SİL all match). */
export function deleteConfirmMatches(typed: string, word: string): boolean {
  const a = tzFold(typed ?? '');
  return a.length > 0 && a === tzFold(word);
}
