/* eslint-disable @typescript-eslint/no-require-imports */
import { Linking } from 'react-native';
import { openNavigation } from '../src/linking';

type ManifestJson = {
  manifest: {
    application?: Array<{ $?: Record<string, string> }>;
    queries?: Array<{ intent?: Array<{ action?: Array<{ $: Record<string, string> }>; data?: Array<{ $: Record<string, string> }> }> }>;
  };
};

const cleartext = require('../plugins/with-dev-cleartext') as {
  urlHost(u: string): { scheme: string; host: string } | null;
  cleartextHosts(apiUrl: string): string[];
  networkSecurityXml(hosts: string[]): string;
  debugNetworkSecurityXml(): string;
  applyToManifest(m: ManifestJson): ManifestJson;
};
const queries = require('../plugins/with-navigation-queries') as {
  addNavigationQueries(m: ManifestJson, schemes?: string[]): ManifestJson;
};

describe('with-dev-cleartext config plugin', () => {
  it('parses hosts without the WHATWG URL implementation', () => {
    expect(cleartext.urlHost('http://10.0.2.2:3000/tezfix/api')).toEqual({ scheme: 'http', host: '10.0.2.2' });
    expect(cleartext.urlHost('https://Evosmart.AZ/tezfix/api')).toEqual({ scheme: 'https', host: 'evosmart.az' });
    expect(cleartext.urlHost('http://[::1]:3000')).toEqual({ scheme: 'http', host: '::1' });
    expect(cleartext.urlHost('not a url')).toBeNull();
  });

  it('allows cleartext only for an http dev API and the developer-machine aliases', () => {
    expect(cleartext.cleartextHosts('http://10.0.2.2:3000/tezfix/api')).toEqual(['10.0.2.2', 'localhost', '127.0.0.1']);
    expect(cleartext.cleartextHosts('http://192.168.1.20:3000/tezfix/api')).toEqual(['192.168.1.20', '10.0.2.2', 'localhost', '127.0.0.1']);
    expect(cleartext.cleartextHosts('https://evosmart.az/tezfix/api')).toEqual([]);
    expect(cleartext.cleartextHosts('')).toEqual([]);
  });

  it('writes a release config that blocks cleartext except for the listed hosts', () => {
    const xml = cleartext.networkSecurityXml(['10.0.2.2', 'localhost']);
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(xml).toContain('<domain-config cleartextTrafficPermitted="true">');
    expect(xml).toContain('<domain includeSubdomains="false">10.0.2.2</domain>');
    expect(xml).toContain('<domain includeSubdomains="false">localhost</domain>');
    expect(xml).not.toMatch(/base-config cleartextTrafficPermitted="true"/);

    const prod = cleartext.networkSecurityXml([]);
    expect(prod).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(prod).not.toContain('domain-config');
  });

  it('lets debug builds load the bundle from Metro over http', () => {
    expect(cleartext.debugNetworkSecurityXml()).toContain('<base-config cleartextTrafficPermitted="true" />');
  });

  it('points <application> at the config and removes the global usesCleartextTraffic flag', () => {
    const m: ManifestJson = { manifest: { application: [{ $: { 'android:name': '.MainApplication', 'android:usesCleartextTraffic': 'true' } }] } };
    cleartext.applyToManifest(m);
    expect(m.manifest.application?.[0].$).toEqual({ 'android:name': '.MainApplication', 'android:networkSecurityConfig': '@xml/network_security_config' });
    expect(() => cleartext.applyToManifest({ manifest: {} })).toThrow(/no <application>/);
  });
});

describe('with-navigation-queries config plugin', () => {
  it('declares package visibility for navigation schemes once, keeping existing queries', () => {
    const m: ManifestJson = {
      manifest: { queries: [{ intent: [{ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': 'https' } }] }] }] },
    };
    queries.addNavigationQueries(m);
    const schemes = (m.manifest.queries ?? []).flatMap((q) => (q.intent ?? []).flatMap((i) => (i.data ?? []).map((d) => d.$['android:scheme'])));
    expect(schemes).toEqual(['https', 'google.navigation', 'geo', 'waze']);
    queries.addNavigationQueries(m);
    expect(m.manifest.queries).toHaveLength(2);
  });
});

describe('openNavigation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('opens Google Maps navigation directly (no canOpenURL, which needs package visibility)', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const can = jest.spyOn(Linking, 'canOpenURL');
    await openNavigation(40.4093, 49.8671);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('google.navigation:q=40.4093,49.8671');
    expect(can).not.toHaveBeenCalled();
  });

  it('falls back to web directions when no app handles the navigation link', async () => {
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValueOnce(new Error('No Activity found to handle Intent'))
      .mockResolvedValueOnce(undefined);
    await openNavigation(40.4093, 49.8671);
    expect(open).toHaveBeenLastCalledWith('https://www.google.com/maps/dir/?api=1&destination=40.4093,49.8671');
  });
});
