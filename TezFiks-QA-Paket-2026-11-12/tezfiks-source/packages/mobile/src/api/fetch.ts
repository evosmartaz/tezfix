/** What expo/fetch throws while encoding a FormData body with React Native file parts, before anything is sent. */
const UNSUPPORTED_FORM_DATA = /Unsupported FormData(Part)? implementation/;

/**
 * Expo SDK 58 replaces the global fetch with expo/fetch, whose FormData encoder rejects React Native file parts
 * ({ uri, name, type }) so every photo upload failed on devices. Requests still go to the global fetch first; when it
 * rejects a multipart body for that reason (it encodes the body before opening the connection, so nothing was sent),
 * the same request is sent over XMLHttpRequest, which reads the file from its uri natively.
 */
export function createAppFetch(base: typeof fetch = (input, init) => globalThis.fetch(input, init)): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await base(input, init);
    } catch (err) {
      const multipart = typeof FormData !== 'undefined' && init?.body instanceof FormData;
      if (multipart && err instanceof Error && UNSUPPORTED_FORM_DATA.test(err.message)) return xhrFetch(String(input), init);
      throw err;
    }
  }) as typeof fetch;
}

/** Statuses whose Response must not carry a body (the Response constructor throws otherwise). */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function parseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return headers;
}

/** A minimal fetch over XMLHttpRequest: method, headers, body, abort signal; resolves with a text-backed Response. */
export function xhrFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const done = () => signal?.removeEventListener?.('abort', onAbort);
    xhr.open(init.method ?? 'GET', url, true);
    new Headers(init.headers).forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.onload = () => {
      done();
      const body = NULL_BODY_STATUSES.has(xhr.status) ? null : xhr.responseText;
      resolve(new Response(body, { status: xhr.status, statusText: xhr.statusText, headers: parseHeaders(xhr.getAllResponseHeaders()) }));
    };
    xhr.onerror = () => {
      done();
      reject(new TypeError('Network request failed'));
    };
    xhr.ontimeout = () => {
      done();
      reject(new TypeError('Network request timed out'));
    };
    xhr.onabort = () => {
      done();
      reject(new Error('Aborted'));
    };
    signal?.addEventListener?.('abort', onAbort);
    xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null);
  });
}
