/**
 * Folds Azerbaijani / Russian text for case- and diacritic-insensitive search.
 * Mirrors the SQL function tz_fold() in the API migration. İ/I/ı become i BEFORE lowercasing.
 */
export function tzFold(input: string): string {
  return input
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ё/g, 'е')
    .trim();
}

/** Uppercases Azerbaijani correctly (i -> İ). Never use textTransform uppercase on az strings. */
export function upperAz(input: string): string {
  return input.toLocaleUpperCase('az');
}

/** "Nizami Talıbov" -> "Nizami T." */
export function shortName(firstName: string, lastName?: string | null): string {
  const l = (lastName ?? '').trim();
  return l ? `${firstName.trim()} ${l.charAt(0).toLocaleUpperCase('az')}.` : firstName.trim();
}

export function initials(firstName: string, lastName?: string | null): string {
  return `${firstName.trim().charAt(0)}${(lastName ?? '').trim().charAt(0)}`.toLocaleUpperCase('az');
}

/** 1000 -> "#1000" */
export function formatRequestNumber(n: number): string {
  return `#${n}`;
}
