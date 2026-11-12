import { Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NOTIFICATION_CHANNELS } from '@tezfiks/mobile';

/** Marks the local notification that only plays the offer sound (the modal shows the offer itself). */
export const OFFER_ALERT_KIND = 'offer-alert';
export const OFFER_VIBRATION = [0, 400, 200, 400, 200, 400];

const shown = new Map<string, string>();

/**
 * New offer: vibrate and play the offers channel sound (max importance) through a local notification on
 * `offers_v1`. Never throws.
 */
export async function playOfferAlert(offerId: string, content: { title: string; body: string }): Promise<void> {
  try {
    Vibration.vibrate(OFFER_VIBRATION);
  } catch {
    // no vibrator
  }
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body, sound: 'default', data: { kind: OFFER_ALERT_KIND, offerId } },
      trigger: { channelId: NOTIFICATION_CHANNELS.offers },
    });
    shown.set(offerId, id);
  } catch {
    // notifications unavailable
  }
}

/** Removes the alert notification once the offer is answered or gone. */
export async function clearOfferAlert(offerId: string): Promise<void> {
  try {
    Vibration.cancel();
  } catch {
    // ignore
  }
  const id = shown.get(offerId);
  if (!id) return;
  shown.delete(offerId);
  try {
    await Notifications.dismissNotificationAsync(id);
  } catch {
    // already gone
  }
}

/**
 * Foreground presentation: offer alerts go to the tray with sound but without a heads-up banner (the modal is on
 * screen); every other notification is shown normally.
 */
export function installNotificationHandler(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async (n) => {
        const kind = (n.request.content.data as { kind?: string } | null)?.kind;
        const offerAlert = kind === OFFER_ALERT_KIND;
        return { shouldShowBanner: !offerAlert, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
      },
    });
  } catch {
    // not available
  }
}
