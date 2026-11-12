import sharp from 'sharp';
import type { FileKind } from '@tezfiks/shared';
import type { TestApp } from '../helpers/app';

/** Recorded call of the injectable geo fetch. */
export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | null;
}

export type FetchHandler = (call: FetchCall) => Promise<Response> | Response;

/** A fake fetch that records every call and answers with `handler` (replaceable per test). */
export function createFakeFetch() {
  const calls: FetchCall[] = [];
  let handler: FetchHandler = () => jsonResponse({}, 500);
  const fn = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const call: FetchCall = {
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      signal: init?.signal ?? null,
    };
    calls.push(call);
    return handler(call);
  };
  return {
    fn,
    calls,
    respond(h: FetchHandler) {
      handler = h;
    },
    reset() {
      calls.length = 0;
      handler = () => jsonResponse({}, 500);
    },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fake Anthropic client: records parse() params/options and answers with the configured behaviour. */
export function createFakeAnthropic() {
  const calls: Array<{ params: Record<string, any>; options: Record<string, any> | undefined }> = [];
  let behaviour: () => Promise<unknown> = async () => {
    throw new Error('fake anthropic: no behaviour configured');
  };
  const client = {
    messages: {
      parse: async (params: Record<string, any>, options?: Record<string, any>) => {
        calls.push({ params, options });
        return behaviour();
      },
    },
  };
  return {
    client,
    calls,
    /** Resolve with a parsed message. */
    returns(output: unknown, extra: { stop_reason?: string; usage?: { input_tokens: number; output_tokens: number } } = {}) {
      behaviour = async () => ({
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: output === null ? [] : [{ type: 'text', text: JSON.stringify(output), parsed_output: output }],
        stop_reason: extra.stop_reason ?? 'end_turn',
        stop_details: null,
        usage: extra.usage ?? { input_tokens: 1500, output_tokens: 40 },
        parsed_output: output,
      });
    },
    throws(error: unknown) {
      behaviour = async () => {
        throw error;
      };
    },
    reset() {
      calls.length = 0;
      behaviour = async () => {
        throw new Error('fake anthropic: no behaviour configured');
      };
    },
  };
}

/** A test photo (PNG) of the given size. */
export async function testImage(width = 2000, height = 1500): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 120, g: 140, b: 160 } } })
    .png()
    .toBuffer();
}

let fileSeq = 0;
/** Inserts a File row (no stored bytes needed: the classifier receives the image buffer). */
export async function createFileRow(t: TestApp, ownerUserId: string, kind: FileKind = 'REQUEST_PHOTO'): Promise<string> {
  fileSeq += 1;
  const f = await t.prisma.file.create({
    data: {
      ownerUserId,
      kind,
      storageKey: `test/a4/${Date.now()}-${fileSeq}-${Math.random().toString(36).slice(2)}.jpg`,
      contentType: 'image/jpeg',
      size: 1000,
      sha256: 'a4-test',
      width: 2000,
      height: 1500,
    },
  });
  return f.id;
}
