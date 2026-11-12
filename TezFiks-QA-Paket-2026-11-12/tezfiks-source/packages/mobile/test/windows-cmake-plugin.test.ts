/* eslint-disable @typescript-eslint/no-require-imports */
const plugin = require('../plugins/with-windows-cmake') as {
  pickCmake(names: string[]): string | null;
  setProperties(existing: string, values: Record<string, string>): string;
  escapeProperty(v: string): string;
};

describe('with-windows-cmake config plugin helpers', () => {
  it('picks the newest CMake 3.x that bundles a long-path-capable ninja', () => {
    expect(plugin.pickCmake(['3.22.1', '3.31.6', '3.30.5', '4.1.2'])).toBe('3.31.6');
    expect(plugin.pickCmake(['3.22.1', '3.18.1'])).toBeNull();
    expect(plugin.pickCmake([])).toBeNull();
    expect(plugin.pickCmake(['readme.txt', '3.30.0'])).toBe('3.30.0');
  });

  it('escapes Windows paths for .properties files', () => {
    expect(plugin.escapeProperty('C:\\Android\\Sdk')).toBe('C\\:\\\\Android\\\\Sdk');
  });

  it('sets keys and keeps unrelated lines', () => {
    const out = plugin.setProperties('sdk.dir=old\nfoo=bar\n', { 'sdk.dir': 'C:\\Sdk', 'cmake.dir': 'C:\\Sdk\\cmake\\3.31.6' });
    expect(out).toBe('foo=bar\nsdk.dir=C\\:\\\\Sdk\ncmake.dir=C\\:\\\\Sdk\\\\cmake\\\\3.31.6\n');
    expect(plugin.setProperties('', { a: 'b' })).toBe('a=b\n');
  });
});
