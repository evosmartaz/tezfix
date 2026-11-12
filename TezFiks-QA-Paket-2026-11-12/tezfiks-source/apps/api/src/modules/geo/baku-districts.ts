import { haversineMeters, type LatLng, type Locale } from '@tezfiks/shared';

export interface BakuDistrict {
  slug: string;
  centroid: LatLng;
  names: Record<Locale, string>;
}

/**
 * The 12 administrative raions of Baku with approximate centroids of their populated areas
 * (used only when Google geocoding is unavailable).
 */
export const BAKU_DISTRICTS: readonly BakuDistrict[] = [
  { slug: 'binagadi', centroid: { lat: 40.4600, lng: 49.8300 }, names: { az: 'Binəqədi rayonu', ru: 'Бинагадинский район', en: 'Binagadi district' } },
  { slug: 'garadagh', centroid: { lat: 40.3000, lng: 49.6500 }, names: { az: 'Qaradağ rayonu', ru: 'Гарадагский район', en: 'Garadagh district' } },
  { slug: 'khatai', centroid: { lat: 40.3800, lng: 49.9350 }, names: { az: 'Xətai rayonu', ru: 'Хатаинский район', en: 'Khatai district' } },
  { slug: 'khazar', centroid: { lat: 40.4200, lng: 50.1600 }, names: { az: 'Xəzər rayonu', ru: 'Хазарский район', en: 'Khazar district' } },
  { slug: 'narimanov', centroid: { lat: 40.4050, lng: 49.8750 }, names: { az: 'Nərimanov rayonu', ru: 'Наримановский район', en: 'Narimanov district' } },
  { slug: 'nasimi', centroid: { lat: 40.3920, lng: 49.8300 }, names: { az: 'Nəsimi rayonu', ru: 'Насиминский район', en: 'Nasimi district' } },
  { slug: 'nizami', centroid: { lat: 40.4080, lng: 49.9350 }, names: { az: 'Nizami rayonu', ru: 'Низаминский район', en: 'Nizami district' } },
  { slug: 'pirallahi', centroid: { lat: 40.4700, lng: 50.3200 }, names: { az: 'Pirallahı rayonu', ru: 'Пираллахинский район', en: 'Pirallahi district' } },
  { slug: 'sabunchu', centroid: { lat: 40.4450, lng: 49.9900 }, names: { az: 'Sabunçu rayonu', ru: 'Сабунчинский район', en: 'Sabunchu district' } },
  { slug: 'sabail', centroid: { lat: 40.3670, lng: 49.8450 }, names: { az: 'Səbail rayonu', ru: 'Сабаильский район', en: 'Sabail district' } },
  { slug: 'surakhani', centroid: { lat: 40.4000, lng: 50.0300 }, names: { az: 'Suraxanı rayonu', ru: 'Сураханский район', en: 'Surakhani district' } },
  { slug: 'yasamal', centroid: { lat: 40.3850, lng: 49.8000 }, names: { az: 'Yasamal rayonu', ru: 'Ясамальский район', en: 'Yasamal district' } },
];

/** Beyond this distance from every centroid the point is not considered to be in Baku. */
export const BAKU_DISTRICT_MAX_DISTANCE_M = 25_000;

/** Nearest Baku district by centroid, or null when the point is far from Baku. */
export function nearestBakuDistrict(point: LatLng): BakuDistrict | null {
  let best: BakuDistrict | null = null;
  let bestD = Infinity;
  for (const d of BAKU_DISTRICTS) {
    const dist = haversineMeters(point, d.centroid);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best && bestD <= BAKU_DISTRICT_MAX_DISTANCE_M ? best : null;
}
