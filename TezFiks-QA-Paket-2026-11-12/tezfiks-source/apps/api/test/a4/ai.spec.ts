import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { ClassifyPhotoResponseSchema } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { categoryId, createUser } from '../helpers/factories';
import { AiService, ANTHROPIC_CLIENT, AI_RATE_LIMIT } from '../../src/modules/ai/ai.service';
import { createFakeAnthropic, createFileRow, testImage } from './helpers';

describe('AiService without an Anthropic key', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it('returns unavailable and logs the call', async () => {
    const ai = t.app.get(AiService);
    expect(ai.enabled).toBe(false);
    const u = await createUser(t);
    const fileId = await createFileRow(t, u.userId);
    const out = await ai.classify({ userId: u.userId, fileId, image: await testImage(200, 150), locale: 'az' });
    expect(out).toEqual({ status: 'unavailable', categoryId: null, slug: null, confidence: null, candidates: [] });
    ClassifyPhotoResponseSchema.parse(out);
    const rows = await t.prisma.aiClassification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: u.userId, fileId, model: 'claude-haiku-5-5', error: 'not_configured', resultSlug: null });
  });
});

describe('AiService with a (fake) Anthropic client', () => {
  const fake = createFakeAnthropic();
  let t: TestApp;
  let ai: AiService;
  let image: Buffer;
  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(ANTHROPIC_CLIENT).useValue(fake.client));
    ai = t.app.get(AiService);
    image = await testImage();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    fake.reset();
  });

  async function setup() {
    const u = await createUser(t);
    const fileId = await createFileRow(t, u.userId);
    return { userId: u.userId, fileId };
  }

  it('sends the expected request: model, cached system prompt, resized JPEG, note, structured output with enums, timeout/retry', async () => {
    const { userId, fileId } = await setup();
    await t.prisma.category.update({ where: { slug: 'tiling' }, data: { active: false } });
    fake.returns({ category: 'plumbing', confidence: 'high', candidates: ['plumbing'] });
    await ai.classify({ userId, fileId, image, note: 'Mətbəxdə kran damcılayır, şüşə yox', locale: 'az' });

    expect(fake.calls).toHaveLength(1);
    const { params, options } = fake.calls[0]!;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.max_tokens).toBeGreaterThanOrEqual(512);
    expect(params).not.toHaveProperty('temperature');
    expect(params.output_config.effort).toBe('low');
    expect(options).toEqual({ timeout: 10_000, maxRetries: 1 });

    // system prompt: one cached text block listing active SERVICE categories with names and keywords
    expect(params.system).toHaveLength(1);
    const sys = params.system[0];
    expect(sys.type).toBe('text');
    expect(sys.cache_control).toEqual({ type: 'ephemeral' });
    expect(sys.text).toContain('- plumbing | vertical: HOME | az: Santexnik | ru: Сантехник | en: Plumber');
    expect(sys.text).toContain('kanalizasiya');
    expect(sys.text).toContain('- battery |');
    expect(sys.text).not.toContain('- home-systems |');
    expect(sys.text).not.toContain('- tiling |');
    expect(sys.text).toMatch(/unsure/);
    expect(sys.text).toMatch(/other/);

    // user turn: the image (re-encoded JPEG, max 1280 px) then the text with the note
    const content = params.messages[0].content;
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0].role).toBe('user');
    expect(content[0].type).toBe('image');
    expect(content[0].source.type).toBe('base64');
    expect(content[0].source.media_type).toBe('image/jpeg');
    const meta = await sharp(Buffer.from(content[0].source.data, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(960);
    expect(content[1].type).toBe('text');
    expect(content[1].text).toContain('Mətbəxdə kran damcılayır, şüşə yox');

    // structured output with real enums
    const format = params.output_config.format;
    expect(format.type).toBe('json_schema');
    expect(typeof format.parse).toBe('function');
    const props = format.schema.properties;
    expect(format.schema.additionalProperties).toBe(false);
    expect(format.schema.required).toEqual(['category', 'confidence', 'candidates']);
    expect(props.category.enum).toEqual(expect.arrayContaining(['plumbing', 'battery', 'other', 'unsure']));
    expect(props.category.enum).not.toContain('home-systems');
    expect(props.category.enum).not.toContain('tiling');
    expect(props.confidence.enum).toEqual(['high', 'medium', 'low']);
    expect(props.candidates.type).toBe('array');
    expect(props.candidates.items.enum).toContain('plumbing');
    expect(props.candidates.items.enum).not.toContain('other');
  });

  it('keeps the system prompt byte-identical between calls (prompt cache)', async () => {
    const { userId, fileId } = await setup();
    fake.returns({ category: 'plumbing', confidence: 'high', candidates: [] });
    await ai.classify({ userId, fileId, image, note: 'one', locale: 'az' });
    await ai.classify({ userId, fileId, image, note: 'two', locale: 'ru' });
    expect(fake.calls[0]!.params.system[0].text).toBe(fake.calls[1]!.params.system[0].text);
  });

  it('limits the catalogue to the requested vertical', async () => {
    const { userId, fileId } = await setup();
    fake.returns({ category: 'battery', confidence: 'high', candidates: ['battery'] });
    const out = await ai.classify({ userId, fileId, image, vertical: 'AUTO', locale: 'en' });
    expect(out.slug).toBe('battery');
    const { params } = fake.calls[0]!;
    expect(params.system[0].text).toContain('- battery |');
    expect(params.system[0].text).not.toContain('- plumbing |');
    expect(params.output_config.format.schema.properties.category.enum).not.toContain('plumbing');
    expect(params.messages[0].content[1].text).toContain('AUTO');
  });

  it('maps high confidence to ok with localized candidates and logs the call', async () => {
    const { userId, fileId } = await setup();
    fake.returns({ category: 'plumbing', confidence: 'high', candidates: ['heating', 'plumbing'] }, { usage: { input_tokens: 1234, output_tokens: 56 } });
    const out = await ai.classify({ userId, fileId, image, locale: 'ru' });
    const plumbing = await categoryId(t, 'plumbing');
    const heating = await categoryId(t, 'heating');
    expect(out).toEqual({
      status: 'ok',
      categoryId: plumbing,
      slug: 'plumbing',
      confidence: 'high',
      candidates: [
        { categoryId: plumbing, slug: 'plumbing', name: 'Сантехник' },
        { categoryId: heating, slug: 'heating', name: 'Котлы и отопление' },
      ],
    });
    ClassifyPhotoResponseSchema.parse(out);
    const row = await t.prisma.aiClassification.findFirstOrThrow({ where: { fileId } });
    expect(row).toMatchObject({
      userId,
      model: 'claude-haiku-5-5',
      resultSlug: 'plumbing',
      confidence: 'high',
      inputTokens: 1234,
      outputTokens: 56,
      error: null,
      finalCategoryId: null,
    });
    expect(row.candidates).toEqual(['plumbing', 'heating']);
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('maps medium confidence to ok', async () => {
    const { userId, fileId } = await setup();
    fake.returns({ category: 'tire', confidence: 'medium', candidates: [] });
    const out = await ai.classify({ userId, fileId, image, locale: 'az' });
    expect(out).toMatchObject({ status: 'ok', slug: 'tire', confidence: 'medium' });
    expect(out.candidates.map((c) => c.slug)).toEqual(['tire']);
    expect(out.candidates[0]!.name).toBe('Təkər / Vulkanizasiya');
  });

  it('maps low confidence to unsure with candidates (chosen slug first, max 3)', async () => {
    const { userId, fileId } = await setup();
    fake.returns({ category: 'electrical', confidence: 'low', candidates: ['electrical', 'home-appliances', 'smart-home', 'tv-electronics'] });
    const out = await ai.classify({ userId, fileId, image, locale: 'en' });
    expect(out.status).toBe('unsure');
    expect(out.categoryId).toBeNull();
    expect(out.slug).toBeNull();
    expect(out.confidence).toBe('low');
    expect(out.candidates.map((c) => c.slug)).toEqual(['electrical', 'home-appliances', 'smart-home']);
    expect(out.candidates[0]!.name).toBe('Electrician');
    const row = await t.prisma.aiClassification.findFirstOrThrow({ where: { fileId } });
    expect(row).toMatchObject({ resultSlug: 'electrical', confidence: 'low' });
  });

  it('maps "unsure" and "other" to unsure, even with high confidence', async () => {
    const { userId, fileId } = await setup();
    fake.returns({ category: 'unsure', confidence: 'high', candidates: ['painting', 'wallpaper'] });
    const a = await ai.classify({ userId, fileId, image, locale: 'az' });
    expect(a).toMatchObject({ status: 'unsure', categoryId: null, slug: null, confidence: 'high' });
    expect(a.candidates.map((c) => c.slug)).toEqual(['painting', 'wallpaper']);

    fake.returns({ category: 'other', confidence: 'medium', candidates: [] });
    const b = await ai.classify({ userId, fileId, image, locale: 'az' });
    expect(b).toEqual({ status: 'unsure', categoryId: null, slug: null, confidence: 'medium', candidates: [] });
    const rows = await t.prisma.aiClassification.findMany({ where: { fileId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.resultSlug)).toEqual(['unsure', 'other']);
  });

  it('refusal -> unavailable and logged', async () => {
    const { userId, fileId } = await setup();
    fake.returns(null, { stop_reason: 'refusal', usage: { input_tokens: 900, output_tokens: 0 } });
    const out = await ai.classify({ userId, fileId, image, locale: 'az' });
    expect(out).toEqual({ status: 'unavailable', categoryId: null, slug: null, confidence: null, candidates: [] });
    const row = await t.prisma.aiClassification.findFirstOrThrow({ where: { fileId } });
    expect(row).toMatchObject({ error: 'refusal', resultSlug: null, inputTokens: 900 });
  });

  it('timeout, connection errors, API errors and parse failures -> unavailable and logged', async () => {
    const { userId, fileId } = await setup();
    const cases: Array<[unknown, RegExp]> = [
      [new Anthropic.APIConnectionTimeoutError(), /^timeout$/],
      [new Anthropic.APIConnectionError({ message: 'socket hang up' }), /^connection_error/],
      [Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', new Headers()), /^api_error 529/],
      [new Anthropic.AnthropicError('Failed to parse structured output: bad json'), /^parse_error/],
      [new Error('boom'), /^error: boom/],
    ];
    for (const [err] of cases) {
      fake.throws(err);
      const out = await ai.classify({ userId, fileId, image, locale: 'az' });
      expect(out.status).toBe('unavailable');
    }
    const rows = await t.prisma.aiClassification.findMany({ where: { fileId }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(cases.length);
    rows.forEach((r, i) => expect(r.error).toMatch(cases[i]![1]));
  });

  it('output that does not match the schema -> unavailable (parse_error)', async () => {
    const { userId, fileId } = await setup();
    for (const bad of [null, { category: 'not-a-slug', confidence: 'high', candidates: [] }, { category: 'plumbing', confidence: 'very', candidates: [] }]) {
      fake.returns(bad, { stop_reason: 'end_turn' });
      expect((await ai.classify({ userId, fileId, image, locale: 'az' })).status).toBe('unavailable');
    }
    fake.returns(null, { stop_reason: 'max_tokens' });
    expect((await ai.classify({ userId, fileId, image, locale: 'az' })).status).toBe('unavailable');
    const rows = await t.prisma.aiClassification.findMany({ where: { fileId } });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.error?.startsWith('parse_error'))).toBe(true);
  });

  it('an undecodable image -> unavailable without calling Claude', async () => {
    const { userId, fileId } = await setup();
    const out = await ai.classify({ userId, fileId, image: Buffer.from('not an image'), locale: 'az' });
    expect(out.status).toBe('unavailable');
    expect(fake.calls).toHaveLength(0);
    const row = await t.prisma.aiClassification.findFirstOrThrow({ where: { fileId } });
    expect(row.error).toMatch(/^image_invalid/);
  });

  it('never sends KYC files', async () => {
    const u = await createUser(t);
    for (const kind of ['KYC_ID_FRONT', 'KYC_SELFIE', 'KYC_TRADE_PROOF', 'COMPANY_DOC'] as const) {
      const fileId = await createFileRow(t, u.userId, kind);
      await expect(ai.classify({ userId: u.userId, fileId, image, locale: 'az' })).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    }
    expect(fake.calls).toHaveLength(0);
    expect(await t.prisma.aiClassification.count()).toBe(0);
  });

  it("rejects unknown files and other users' files", async () => {
    const owner = await createUser(t);
    const other = await createUser(t);
    const fileId = await createFileRow(t, owner.userId);
    await expect(ai.classify({ userId: other.userId, fileId, image, locale: 'az' })).rejects.toMatchObject({ code: 'FILE_NOT_OWNED' });
    await expect(ai.classify({ userId: owner.userId, fileId: crypto.randomUUID(), image, locale: 'az' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.calls).toHaveLength(0);
  });

  it(`rate limits to ${AI_RATE_LIMIT} classifications per user per window`, async () => {
    const { userId, fileId } = await setup();
    const small = await testImage(64, 64);
    fake.returns({ category: 'plumbing', confidence: 'high', candidates: [] });
    for (let i = 0; i < AI_RATE_LIMIT; i++) await ai.classify({ userId, fileId, image: small, locale: 'az' });
    await expect(ai.classify({ userId, fileId, image: small, locale: 'az' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fake.calls).toHaveLength(AI_RATE_LIMIT);
    // a small image is not enlarged
    const meta = await sharp(Buffer.from(fake.calls[0]!.params.messages[0].content[0].source.data, 'base64')).metadata();
    expect(meta.width).toBe(64);
  });

  it('records the category the customer finally chose', async () => {
    const { userId, fileId } = await setup();
    fake.returns({ category: 'plumbing', confidence: 'low', candidates: ['plumbing'] });
    await ai.classify({ userId, fileId, image, locale: 'az' });
    const heating = await categoryId(t, 'heating');
    await ai.recordFinalCategory(userId, fileId, heating);
    const row = await t.prisma.aiClassification.findFirstOrThrow({ where: { fileId } });
    expect(row.finalCategoryId).toBe(heating);
  });
});
