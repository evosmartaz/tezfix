import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import type MapView from 'react-native-maps';
import { MapPin, Polygon, TfMapView, colors } from '@tezfiks/mobile';
import { brandFill, cellPolygon, groupByRing, pulsePhase, regionForCells, ringOpacity } from '../lib/hexagons';

export interface SearchHexMapProps {
  cells: string[];
  center: { lat: number; lng: number };
  centerCell: string | null;
  /** Re-render period of the pulse (ms). */
  tickMs?: number;
}

/**
 * Board 02 B4 map: the H3 cells covered by the dispatch so far, the newest ring pulsing, older rings as a fading trail,
 * the request pin in the middle. The camera follows the covered area as rings grow.
 */
export function SearchHexMap({ cells, center, centerCell, tickMs = 250 }: SearchHexMapProps) {
  const mapRef = useRef<MapView>(null);
  const [phase, setPhase] = useState(0);
  const rings = useMemo(() => groupByRing(cells, centerCell), [cells, centerCell]);
  const newest = rings.length ? rings[rings.length - 1].ring : 0;
  const polygons = useMemo(() => rings.map((r) => ({ ring: r.ring, cells: r.cells.map((c) => ({ cell: c, coords: cellPolygon(c) })) })), [rings]);

  useEffect(() => {
    const id = setInterval(() => setPhase(pulsePhase(Date.now())), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  useEffect(() => {
    const region = regionForCells(cells);
    if (region) mapRef.current?.animateToRegion?.(region, 600);
  }, [cells]);

  const initial = regionForCells(cells) ?? { latitude: center.lat, longitude: center.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  return (
    <TfMapView ref={mapRef} initialRegion={initial} style={styles.map} scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}>
      {polygons.map((r) =>
        r.cells.map(({ cell, coords }) => (
          <Polygon
            key={cell}
            coordinates={coords}
            fillColor={brandFill(ringOpacity(r.ring, newest, phase))}
            strokeColor={colors.primary}
            strokeWidth={r.ring === newest ? 2 : 1}
            testID={`hex-${cell}`}
          />
        )),
      )}
      <MapPin coordinate={{ latitude: center.lat, longitude: center.lng }} kind="target" />
    </TfMapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
