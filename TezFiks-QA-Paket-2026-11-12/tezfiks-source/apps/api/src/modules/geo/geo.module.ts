import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { GEO_FETCH, GeoService, type GeoFetch } from './geo.service';

const defaultFetch: GeoFetch = (input, init) => fetch(input, init);

/** Lane A4: geocoding, autocomplete, routes/ETA provider (Google with fallback), H3 helpers. Exports GeoService. */
@Module({
  controllers: [GeoController],
  providers: [GeoService, { provide: GEO_FETCH, useValue: defaultFetch }],
  exports: [GeoService],
})
export class GeoModule {}
