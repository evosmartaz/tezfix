import type { LatLng } from '@tezfiks/shared';
import { DEMO_CUSTOMER } from './demo.constants';

/** Demo seed people (spec 17, plan lane B6). Phones are valid Azerbaijani mobiles reserved for the demo (docs/demo.md). */
export const SEED_PEOPLE = {
  elvin: { phone: '+994502000001', firstName: 'Elvin', lastName: 'Məmmədov' },
  samir: { phone: '+994502000002', firstName: 'Samir', lastName: 'Quliyev' },
  vuqar: { phone: '+994502000003', firstName: 'Vüqar', lastName: 'Nəbiyev' },
  rauf: { phone: '+994502000011', firstName: 'Rauf', lastName: 'Hüseynov' },
  tural: { phone: '+994502000012', firstName: 'Tural', lastName: 'Əliyev' },
  kamran: { phone: '+994502000013', firstName: 'Kamran', lastName: 'Səfərov' },
  nizami: { phone: '+994552000021', firstName: 'Nizami', lastName: 'Talıbov' },
  aysel: { phone: '+994552000022', firstName: 'Aysel', lastName: 'Qasımova' },
  kontur: { phone: '+994552000023', firstName: 'Leyla', lastName: 'Rzayeva' },
  demo: { phone: DEMO_CUSTOMER.phone, firstName: DEMO_CUSTOMER.firstName, lastName: DEMO_CUSTOMER.lastName },
} as const;

export type SeedPersonKey = keyof typeof SEED_PEOPLE;

/** Places around the Baku centre (all inside the res-7 rings that dispatch reaches first). */
export const SEED_PLACES = {
  /** Elvin's base: Sahil, ~400 m from Fountain Square. */
  elvinBase: { lat: 40.3758, lng: 49.8489 },
  /** FixPro MMC office (Nərimanov). */
  fixproBase: { lat: 40.3929, lng: 49.8668 },
  /** Kamran's position when the in-progress job starts. */
  kamranStart: { lat: 40.3912, lng: 49.8721 },
  turalStart: { lat: 40.3935, lng: 49.8642 },
  nizamiHome: { lat: 40.3769, lng: 49.8462, street: 'Nizami küçəsi', building: '67', district: 'Səbail' },
  ayselHome: { lat: 40.3804, lng: 49.8513, street: 'Rəşid Behbudov küçəsi', building: '12', district: 'Səbail' },
  konturOffice: { lat: 40.3851, lng: 49.8592, street: 'Bülbül prospekti', building: '25', district: 'Nəsimi' },
} satisfies Record<string, LatLng & Record<string, unknown>>;

export const FIXPRO = {
  name: 'FixPro MMC',
  voen: '1700234561',
  legalForm: 'MMC' as const,
  baseAddress: 'Təbriz küçəsi 44, Nərimanov',
  trades: ['electrical', 'plumbing', 'air-conditioning', 'renovation-crew'],
  serviceRadiusKm: 15,
};

export const KONTUR = { companyName: 'Kontur MMC', voen: '1234567890', legalForm: 'MMC' as const, contactPerson: 'Leyla Rzayeva' };

/** Final wallet balances the demo needs (qəpik, available): Elvin 34 AZN, FixPro 240 AZN. */
export const FINAL_BALANCES = { elvin: 3400, fixpro: 24_000 };

/** Customer wallet funding (qəpik). */
export const CUSTOMER_FUNDING = { nizami: 10_000, aysel: 8_000, kontur: 50_000 };

/** One login line printed by the seed and listed in docs/demo.md. */
export interface DemoLogin {
  phone: string;
  name: string;
  role: string;
  app: 'customer' | 'pro' | 'pro + company panel';
}

export const DEMO_LOGINS: DemoLogin[] = [
  { phone: SEED_PEOPLE.elvin.phone, name: 'Elvin Məmmədov', role: 'Solo handyman (santexnik), APPROVED, 34 AZN', app: 'pro' },
  { phone: SEED_PEOPLE.samir.phone, name: 'Samir Quliyev', role: 'Solo handyman, KYC pending review', app: 'pro' },
  { phone: SEED_PEOPLE.vuqar.phone, name: 'Vüqar Nəbiyev', role: 'Solo handyman, BLOCKED', app: 'pro' },
  { phone: SEED_PEOPLE.rauf.phone, name: 'Rauf Hüseynov', role: 'FixPro MMC manager (İdarəedici), company balance 240 AZN', app: 'pro + company panel' },
  { phone: SEED_PEOPLE.tural.phone, name: 'Tural Əliyev', role: 'FixPro MMC worker', app: 'pro' },
  { phone: SEED_PEOPLE.kamran.phone, name: 'Kamran Səfərov', role: 'FixPro MMC worker (one job en route)', app: 'pro' },
  { phone: SEED_PEOPLE.nizami.phone, name: 'Nizami Talıbov', role: 'Customer (individual), job in progress', app: 'customer' },
  { phone: SEED_PEOPLE.aysel.phone, name: 'Aysel Qasımova', role: 'Customer (individual), open guarantee case', app: 'customer' },
  { phone: SEED_PEOPLE.kontur.phone, name: 'Kontur MMC (Leyla Rzayeva)', role: 'Customer (company, VÖEN 1234567890), B2B project with 2 quotes', app: 'customer' },
  { phone: SEED_PEOPLE.demo.phone, name: 'Demo Müştəri', role: 'Demo customer (admin test requests)', app: 'customer' },
];
