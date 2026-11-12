import { ImageManipulator } from 'expo-image-manipulator';
import { api } from '@tezfiks/shared';
import { fitWithin, prepareImageForUpload, uploadImage, UPLOAD_MAX_SIDE } from '../src/images';
import { createMobileRuntime } from '../src/runtime';
import { createMemoryStorage } from '../src/storage';
import { makeMe } from './fixtures';

const BASE = 'http://10.0.2.2:3000/tezfix/api';
const sizes = (require('expo-image-manipulator') as { __sizes: Map<string, { width: number; height: number }> }).__sizes;
const manipulate = ImageManipulator.manipulate as unknown as jest.Mock;

/** Multipart parts of a FormData body (React Native's FormData keeps them in getParts()/_parts). */
function partsOf(body: unknown): Array<{ fieldName: string; string?: string; uri?: string; name?: string; type?: string }> {
  const fd = body as { getParts?: () => unknown[]; _parts?: Array<[string, unknown]> };
  if (fd.getParts) return fd.getParts() as never;
  return (fd._parts ?? []).map(([fieldName, v]) => (typeof v === 'string' ? { fieldName, string: v } : { fieldName, ...(v as object) }));
}

beforeEach(() => {
  sizes.clear();
  manipulate.mockClear();
});

describe('fitWithin', () => {
  it('fits the longest side and leaves small images alone', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ height: 1600 });
    expect(fitWithin(1600, 1600, 1600)).toBeNull();
    expect(fitWithin(800, 600, 1600)).toBeNull();
    expect(fitWithin(0, 0, 1600)).toBeNull();
  });
});

describe('prepareImageForUpload (spec §13: resize before upload)', () => {
  it('downscales a large camera photo so the longest side is 1600 px and re-encodes it as JPEG', async () => {
    sizes.set('file:///dcim/IMG_0001.HEIC', { width: 4032, height: 3024 });
    const out = await prepareImageForUpload({ uri: 'file:///dcim/IMG_0001.HEIC', mimeType: 'image/heic', fileName: 'IMG_0001.HEIC', width: 4032, height: 3024 });
    const ctx = manipulate.mock.results[0].value as { resize: jest.Mock; renderAsync: jest.Mock };
    expect(ctx.resize).toHaveBeenCalledWith({ width: UPLOAD_MAX_SIDE });
    expect(ctx.renderAsync).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ mimeType: 'image/jpeg', fileName: 'IMG_0001.jpg', width: 1600, height: 1200 });
    expect(out.uri).toMatch(/^file:\/\/\/cache\/manipulated-\d+\.jpg$/);
    const saved = (await ctx.renderAsync.mock.results[0].value) as { saveAsync: jest.Mock };
    expect(saved.saveAsync).toHaveBeenCalledWith({ compress: 0.8, format: 'jpeg' });
  });

  it('fits portrait photos by height', async () => {
    sizes.set('file:///p.jpg', { width: 3000, height: 4000 });
    const out = await prepareImageForUpload({ uri: 'file:///p.jpg', width: 3000, height: 4000 });
    expect(Math.max(out.width ?? 0, out.height ?? 0)).toBe(1600);
    expect(out.height).toBe(1600);
  });

  it('measures the image when the picker gave no size, then resizes', async () => {
    sizes.set('file:///unknown.png', { width: 5000, height: 2500 });
    const out = await prepareImageForUpload({ uri: 'file:///unknown.png', mimeType: 'image/png' });
    const ctx = manipulate.mock.results[0].value as { resize: jest.Mock };
    expect(ctx.resize).toHaveBeenCalledWith({ width: 1600 });
    expect(out).toMatchObject({ width: 1600, height: 800, mimeType: 'image/jpeg', fileName: 'upload.jpg' });
  });

  it('keeps the size of small images but still re-encodes them', async () => {
    sizes.set('file:///small.jpg', { width: 800, height: 800 });
    const out = await prepareImageForUpload({ uri: 'file:///small.jpg', width: 800, height: 800, fileName: 'a.jpeg' });
    const ctx = manipulate.mock.results[0].value as { resize: jest.Mock };
    expect(ctx.resize).not.toHaveBeenCalled();
    expect(out).toMatchObject({ width: 800, height: 800, fileName: 'a.jpg' });
  });

  it('falls back to the original image when the manipulator fails', async () => {
    manipulate.mockImplementationOnce(() => {
      throw new Error('decode failed');
    });
    const original = { uri: 'file:///broken.jpg', mimeType: 'image/jpeg', fileName: 'broken.jpg' };
    await expect(prepareImageForUpload(original)).resolves.toBe(original);
  });
});

describe('uploadImage', () => {
  async function runtimeWithUpload() {
    const bodies: unknown[] = [];
    const fetchFn = jest.fn(async (_url: string, init: RequestInit) => {
      bodies.push(init.body);
      return new Response(
        JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', kind: 'PROFILE_PHOTO', url: 'http://x/f1.jpg', contentType: 'image/jpeg', width: 1600, height: 1200 }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const rt = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage: createMemoryStorage(), fetch: fetchFn, getLocale: () => 'az' });
    await rt.auth.getState().signIn({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: 'x', refreshExpiresAt: 'y' }, makeMe());
    return { rt, bodies, fetchFn };
  }

  it('uploads the resized JPEG as multipart kind + file', async () => {
    const { rt, bodies, fetchFn } = await runtimeWithUpload();
    sizes.set('file:///big.jpg', { width: 4000, height: 3000 });
    const ref = await uploadImage(rt.api, { uri: 'file:///big.jpg', mimeType: 'image/jpeg', fileName: 'big.jpg', width: 4000, height: 3000 }, 'PROFILE_PHOTO');
    expect(ref.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(String((fetchFn as unknown as jest.Mock).mock.calls[0][0])).toBe(`${BASE}${api.files.upload.path}`);
    const parts = partsOf(bodies[0]);
    expect(parts.find((p) => p.fieldName === 'kind')?.string).toBe('PROFILE_PHOTO');
    const file = parts.find((p) => p.fieldName === 'file');
    expect(file?.uri).toMatch(/manipulated-\d+\.jpg$/);
    expect(file).toMatchObject({ name: 'big.jpg', type: 'image/jpeg' });
  });

  it('can skip resizing', async () => {
    const { rt, bodies } = await runtimeWithUpload();
    await uploadImage(rt.api, { uri: 'file:///raw.png', mimeType: 'image/png' }, 'REQUEST_PHOTO', { resize: false });
    expect(manipulate).not.toHaveBeenCalled();
    expect(partsOf(bodies[0]).find((p) => p.fieldName === 'file')).toMatchObject({ uri: 'file:///raw.png', name: 'upload.png', type: 'image/png' });
  });
});
