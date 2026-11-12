import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CustomerAssignment } from '@tezfiks/shared';
import { MapPin, RouteLine, TfMapView, regionForPoints } from '@tezfiks/mobile';
import { remainingRoute, routeCoordinates, type MapPoint } from '../lib/tracking';

export interface TrackingMapProps {
  assignment: CustomerAssignment;
  /** The request address (the pin the handyman drives to). */
  target: { lat: number; lng: number } | null;
  height?: number;
}

/** Board 02 B5: the route polyline still ahead of the handyman, his live position (dark dot) and the address (green dot). */
export function TrackingMap({ assignment, target, height = 300 }: TrackingMapProps) {
  const route = useMemo(() => routeCoordinates(assignment.route), [assignment.route]);
  const live: MapPoint | null = assignment.location ? { latitude: assignment.location.lat, longitude: assignment.location.lng } : null;
  const ahead = useMemo(() => remainingRoute(route, live), [route, live?.latitude, live?.longitude]);
  const dest: MapPoint | null = target ? { latitude: target.lat, longitude: target.lng } : null;
  const region = useMemo(
    () => regionForPoints([...(dest ? [dest] : []), ...(live ? [live] : []), ...(route.length ? [route[0]] : [])]),
    // Re-fit only when the set of anchor points changes noticeably (not on every ping).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dest?.latitude, dest?.longitude, route.length, !!live],
  );
  return (
    <View style={[styles.box, { height }]} testID="tracking-map">
      <TfMapView initialRegion={region} region={region}>
        {ahead.length >= 2 ? <RouteLine coordinates={ahead} /> : null}
        {dest ? <MapPin coordinate={dest} kind="target" /> : null}
        {live ? <MapPin coordinate={live} kind="handyman" rotation={assignment.location?.heading ?? undefined} /> : null}
      </TfMapView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 20, overflow: 'hidden' },
});
