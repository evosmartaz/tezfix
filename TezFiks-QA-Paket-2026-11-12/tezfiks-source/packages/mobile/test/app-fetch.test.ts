import { api, ApiError, createApiClient } from '@tezfiks/shared';
import { createAppFetch } from '../src/api/fetch';
import { createMobileRuntime } from '../src/runtime';
import { createMemoryStorage } from '../src/storage';
import { makeMe } from './fixtures';

const BASE = 'http://10.0.2.2:3000/tezfix/api';
const FILE_REF = { id: '22222222-2222-4222-8222-222222222222', kind: 'KYC_ID_FRONT', url: 'http://x/f1.jpg', contentType: 'image/jpeg', width: 1600, height: 1200 };

/** Records every request and answers through `FakeXhr.respond` (default: 200 with the file ref). */
class FakeXhr {
  static instances: FakeXhr[] = [];
  static respond: (x: FakeXhr) => void = (x) => x.reply(200, JSON.stringify(FILE_REF), 'Content-Type: application/json\r\nX-Test: 1');
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  aborted = false;
  status = 0;
  statusText = '';
  responseText = '';
  private rawHeaders = '';
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key.toLowerCase()] = value;
  }
  getAllResponseHeaders() {
    return this.rawHeaders;
  }
  send(body: unknown) {
    this.body = body;
    queueMicrotask(() => FakeXhr.respond(this));
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  reply(status: number, text: string, rawHeaders = '') {
    this.status = status;
    this.statusText = status === 200 ? 'OK' : '';
    this.responseText = text;
    this.rawHeaders = rawHeaders;
    this.onload?.();
  }
}

function photoForm(): FormData {
  const fd = new FormData();
  fd.append('kind', 'KYC_ID_FRONT');
  fd.append('file', { uri: 'file:///data/kyc.jpg', name: 'kyc.jpg', type: 'image/jpeg' } as unknown as Blob);
  return fd;
}

const realXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
beforeEach(() => {
  FakeXhr.instances = [];
  FakeXhr.respond = (x) => x.reply(200, JSON.stringify(FILE_REF), 'Content-Type: application/json\r\nX-Test: 1');
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
});
afterAll(() => {
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = realXhr;
});

/** Behaves like expo/fetch: rejects multipart bodies with React Native file parts while encoding them. */
function expoLikeFetch(): jest.Mock {
  return jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body instanceof FormData) throw new Error('Unsupported FormDataPart implementation');
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}
const asFetch = (m: jest.Mock) => m as unknown as typeof fetch;

describe('createAppFetch', () => {
  it('sends a multipart request again over XMLHttpRequest when expo/fetch cannot encode its { uri } file parts', async () => {
    const base = expoLikeFetch();
    const body = photoForm();
    const res = await createAppFetch(asFetch(base))(`${BASE}/files`, { method: 'POST', headers: { Authorization: 'Bearer t', Accept: 'application/json' }, body });
    expect(base).toHaveBeenCalledTimes(1);
    expect(FakeXhr.instances).toHaveLength(1);
    const x = FakeXhr.instances[0]!;
    expect(x.method).toBe('POST');
    expect(x.url).toBe(`${BASE}/files`);
    expect(x.headers).toMatchObject({ authorization: 'Bearer t', accept: 'application/json' });
    expect(x.body).toBe(body);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.headers.get('x-test')).toBe('1');
    expect(await res.json()).toEqual(FILE_REF);
  });

  it('keeps multipart requests on the base fetch when it can send them (React Native fetch, test fakes)', async () => {
    const base = jest.fn(async () => new Response(JSON.stringify(FILE_REF), { status: 200 }));
    const res = await createAppFetch(asFetch(base))(`${BASE}/files`, { method: 'POST', body: photoForm() });
    expect(base).toHaveBeenCalledTimes(1);
    expect(FakeXhr.instances).toHaveLength(0);
    expect(await res.json()).toEqual(FILE_REF);
  });

  it('keeps every other request on the base fetch', async () => {
    const base = expoLikeFetch();
    const res = await createAppFetch(asFetch(base))(`${BASE}/me`, { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
    expect(base).toHaveBeenCalledTimes(1);
    expect(FakeXhr.instances).toHaveLength(0);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('never resends after any other failure (the request may have reached the server)', async () => {
    const base = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(createAppFetch(asFetch(base))(`${BASE}/files`, { method: 'POST', body: photoForm() })).rejects.toThrow('Network request failed');
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it('resolves 204 answers with an empty body', async () => {
    FakeXhr.respond = (x) => x.reply(204, '');
    const res = await createAppFetch(asFetch(expoLikeFetch()))(`${BASE}/files`, { method: 'POST', body: photoForm() });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('an XHR network failure surfaces as ApiError NETWORK through the API client', async () => {
    FakeXhr.respond = (x) => x.onerror?.();
    const client = createApiClient({ baseUrl: BASE, fetch: createAppFetch(asFetch(expoLikeFetch())) });
    const err = await client.call(api.files.upload, { formData: photoForm() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NETWORK');
  });

  it('XHR error statuses keep the API error body', async () => {
    FakeXhr.respond = (x) => x.reply(413, JSON.stringify({ error: { code: 'FILE_TOO_LARGE', message: 'too large' } }), 'Content-Type: application/json');
    const client = createApiClient({ baseUrl: BASE, fetch: createAppFetch(asFetch(expoLikeFetch())) });
    const err = await client.call(api.files.upload, { formData: photoForm() }).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(413);
    expect((err as ApiError).code).toBe('FILE_TOO_LARGE');
  });

  it('aborting the signal aborts the XHR and rejects', async () => {
    FakeXhr.respond = () => undefined; // never answers
    const controller = new AbortController();
    const pending = createAppFetch(asFetch(expoLikeFetch()))(`${BASE}/files`, { method: 'POST', body: photoForm(), signal: controller.signal });
    for (let i = 0; i < 5 && FakeXhr.instances.length === 0; i++) await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
    expect(FakeXhr.instances[0]!.aborted).toBe(true);
  });
});

describe('mobile runtime default transport', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function signedInRuntime() {
    const rt = createMobileRuntime({ app: 'PRO', apiUrl: BASE, storage: createMemoryStorage(), getLocale: () => 'az' });
    await rt.auth.getState().signIn({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: 'x', refreshExpiresAt: 'y' }, makeMe());
    return rt;
  }

  it('with expo/fetch as the global fetch, photo uploads still reach the API (over XMLHttpRequest)', async () => {
    globalThis.fetch = asFetch(expoLikeFetch());
    const rt = await signedInRuntime();
    const ref = await rt.api.call(api.files.upload, { formData: photoForm() });
    expect(ref).toEqual(FILE_REF);
    expect(FakeXhr.instances).toHaveLength(1);
    expect(FakeXhr.instances[0]!.url).toBe(`${BASE}${api.files.upload.path}`);
    expect(FakeXhr.instances[0]!.headers.authorization).toBe('Bearer a');
    expect(FakeXhr.instances[0]!.headers['accept-language']).toBe('az');
  });

  it('uses the global fetch read at call time, so a fetch installed later (tests, polyfills) is honoured', async () => {
    const rt = await signedInRuntime();
    const later = jest.fn(async () => new Response(JSON.stringify(FILE_REF), { status: 200 }));
    globalThis.fetch = asFetch(later);
    expect(await rt.api.call(api.files.upload, { formData: photoForm() })).toEqual(FILE_REF);
    expect(later).toHaveBeenCalledTimes(1);
    expect(FakeXhr.instances).toHaveLength(0);
  });
});
