import React, { forwardRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, Polygon, Polyline, PROVIDER_GOOGLE, UrlTile, type MapViewProps } from 'react-native-maps';
import { getExtra } from '../config';
import { colors } from '../theme/tokens';
import { AppText } from '../ui/Text';
import { BAKU_REGION, OSM_TILE_URL, hexagonCoordinates, type LatLng, type MapRegion } from './geo';

export interface TfMapViewProps extends Omit<MapViewProps, 'provider' | 'mapType' | 'style'> {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  initialRegion?: MapRegion;
  /** Overrides build-time detection (tests). */
  useGoogleTiles?: boolean;
}

/**
 * Google map when the build has GOOGLE_MAPS_ANDROID_KEY; otherwise `mapType="none"` plus OpenStreetMap tiles,
 * so maps work in the emulator without a key.
 */
export const TfMapView = forwardRef<MapView, TfMapViewProps>(function TfMapView(
  { children, style, initialRegion = BAKU_REGION, useGoogleTiles, ...rest },
  ref,
) {
  const google = useGoogleTiles ?? getExtra().hasGoogleMapsKey;
  return (
    <View style={[styles.wrap, style]}>
      <MapView
        ref={ref}
        {...rest}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        mapType={google ? 'standard' : 'none'}
        initialRegion={initialRegion}
        toolbarEnabled={false}
        testID="tf-map"
      >
        {google ? null : <UrlTile urlTemplate={OSM_TILE_URL} maximumZ={19} flipY={false} shouldReplaceMapContent />}
        {children}
      </MapView>
      {google ? null : (
        <View style={styles.attribution} pointerEvents="none">
          <AppText variant="caption" color="textMuted">
            © OpenStreetMap
          </AppText>
        </View>
      )}
    </View>
  );
});

export interface H3HexagonsProps {
  cells: string[];
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

/** H3 cells as polygons (searching animation rings, dispatch coverage). */
export function H3Hexagons({ cells, fillColor = 'rgba(47, 91, 255, 0.18)', strokeColor = colors.primary, strokeWidth = 1 }: H3HexagonsProps) {
  return (
    <>
      {cells.map((cell) => (
        <Polygon key={cell} coordinates={hexagonCoordinates(cell)} fillColor={fillColor} strokeColor={strokeColor} strokeWidth={strokeWidth} />
      ))}
    </>
  );
}

export interface RouteLineProps {
  coordinates: LatLng[];
  color?: string;
  width?: number;
}

export function RouteLine({ coordinates, color = colors.primary, width = 5 }: RouteLineProps) {
  if (coordinates.length < 2) return null;
  return <Polyline coordinates={coordinates} strokeColor={color} strokeWidth={width} />;
}

export interface PinProps {
  coordinate: LatLng;
  /** "handyman" = dark dot (board 02 B5), "target" = green dot. */
  kind?: 'handyman' | 'target';
  title?: string;
  rotation?: number;
}

export function MapPin({ coordinate, kind = 'target', title, rotation }: PinProps) {
  return (
    <Marker coordinate={coordinate} title={title} rotation={rotation} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
      <View style={[styles.pin, kind === 'handyman' ? styles.pinDark : styles.pinGreen]} />
    </Marker>
  );
}

export { Marker, Polyline, Polygon };

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', backgroundColor: '#E6EAF3' },
  attribution: { position: 'absolute', right: 6, bottom: 4, backgroundColor: 'rgba(255,255,255,0.75)', paddingHorizontal: 4, borderRadius: 4 },
  pin: { width: 22, height: 22, borderRadius: 11, borderWidth: 4, borderColor: '#FFFFFF' },
  pinDark: { backgroundColor: colors.dark },
  pinGreen: { backgroundColor: colors.primary },
});
