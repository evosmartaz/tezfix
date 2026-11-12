import type { Language, Messages } from './index';
export declare function messages(lng: string): { common: Messages; server: Record<string, Messages> };
export declare function translate(lng: string, key: string, vars?: Record<string, string | number>): string;
export declare function loadServerMessages(lng: Language): Record<string, Messages>;
export declare function clearCache(): void;
