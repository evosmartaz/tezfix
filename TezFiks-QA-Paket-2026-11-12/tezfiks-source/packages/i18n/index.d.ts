export type Language = 'az' | 'ru' | 'en';
export type Namespace = 'common' | 'customer' | 'pro' | 'panel';
export type Messages = { [key: string]: string | Messages };
export declare const resources: Record<Language, Record<Namespace, Messages>>;
export declare const LANGUAGES: Language[];
export declare const NAMESPACES: Namespace[];
export declare const DEFAULT_LANGUAGE: 'az';
