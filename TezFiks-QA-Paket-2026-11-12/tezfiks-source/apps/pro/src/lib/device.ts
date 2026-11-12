/**
 * Battery optimization guidance per manufacturer (device setup screen). Aggressive OEM battery savers kill the
 * location foreground service and delay offer pushes; each brand hides the switch in a different place.
 */
export type BatteryBrand = 'samsung' | 'xiaomi' | 'huawei' | 'oppo' | 'vivo' | 'oneplus' | 'google' | 'generic';

const BRANDS: Array<[BatteryBrand, RegExp]> = [
  ['samsung', /samsung/i],
  ['xiaomi', /xiaomi|redmi|poco/i],
  ['huawei', /huawei|honor/i],
  ['oneplus', /oneplus/i],
  ['oppo', /oppo|realme/i],
  ['vivo', /vivo|iqoo/i],
  ['google', /google/i],
];

export function batteryBrand(manufacturer: string | null | undefined, brand?: string | null): BatteryBrand {
  const text = `${manufacturer ?? ''} ${brand ?? ''}`;
  for (const [key, re] of BRANDS) if (re.test(text)) return key;
  return 'generic';
}

/** i18n key of the guidance text for a brand ("device.battery.<brand>"). */
export function batteryGuideKey(manufacturer: string | null | undefined, brand?: string | null): string {
  return `device.battery.${batteryBrand(manufacturer, brand)}`;
}

/** Android settings intents tried in order to open the battery optimization list (falls back to the app settings). */
export const BATTERY_SETTINGS_INTENTS = [
  'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
  'android.settings.BATTERY_SAVER_SETTINGS',
] as const;
