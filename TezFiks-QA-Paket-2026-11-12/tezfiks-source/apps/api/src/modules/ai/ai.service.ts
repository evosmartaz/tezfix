import { Inject, Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import sharp from 'sharp';
import { isKycFileKind, type AiConfidence, type ClassifyPhotoResponse, type Locale, type Vertical } from '@tezfiks/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { RateLimiter } from '../../infra/rate-limiter';
import { ApiException } from '../../common/http/api-exception';
import { CategoriesService, type CategoryRow } from '../categories/categories.service';
import {
  AI_MAX_CANDIDATES,
  buildSystemPrompt,
  buildUserText,
  classificationJsonSchema,
  classificationSchema,
  type ClassificationOutput,
} from './ai.prompt';

/** The Anthropic client (or null when ANTHROPIC_API_KEY is not set). Tests override this provider with a fake. */
export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');
export interface AnthropicMessagesClient {
  messages: Pick<Anthropic['messages'], 'parse'>;
}

export const AI_TIMEOUT_MS = 10_000;
export const AI_MAX_RETRIES = 1;
export const AI_MAX_TOKENS = 1024;
export const AI_IMAGE_MAX_PX = 1280;
export const AI_JPEG_QUALITY = 80;
/** Per-user limit on classification calls (spec §15: per-user rate limits on AI). */
export const AI_RATE_LIMIT = 20;
export const AI_RATE_WINDOW_SEC = 600;

export interface ClassifyInput {
  userId: string;
  fileId: string;
  image: Buffer;
  note?: string | null;
  vertical?: Vertical | null;
  locale: Locale;
}

const UNAVAILABLE: ClassifyPhotoResponse = { status: 'unavailable', categoryId: null, slug: null, confidence: null, candidates: [] };

export function createAnthropicClient(env: Env): AnthropicMessagesClient | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES });
}

function describeError(e: unknown): string {
  let s: string;
  if (e instanceof Anthropic.APIConnectionTimeoutError) s = 'timeout';
  else if (e instanceof Anthropic.APIUserAbortError) s = 'aborted';
  else if (e instanceof Anthropic.APIConnectionError) s = `connection_error: ${e.message}`;
  else if (e instanceof Anthropic.APIError) s = `api_error ${e.status ?? ''}: ${e.message}`;
  else if (e instanceof Anthropic.AnthropicError) s = `parse_error: ${e.message}`;
  else if (e instanceof Error) s = `${e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'error'}: ${e.message}`;
  else s = `error: ${String(e)}`;
  return s.slice(0, 500);
}

/** "Şəkil ilə tap": Claude Haiku picks the service category of a REQUEST_PHOTO. Every call is logged in AiClassification. */
@Injectable()
export class AiService {
  private readonly log = new Logger('AiService');

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(ANTHROPIC_CLIENT) private readonly client: AnthropicMessagesClient | null,
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly limiter: RateLimiter,
  ) {}

  get enabled(): boolean {
    return this.client !== null;
  }

  get model(): string {
    return this.env.ANTHROPIC_MODEL;
  }

  /**
   * Classifies a photo. Throws NOT_FOUND (unknown file), FILE_NOT_OWNED, FILE_TYPE_NOT_ALLOWED (KYC files are never
   * sent to Claude) and RATE_LIMITED; every other failure (no key, timeout, refusal, parse error, API error) returns
   * status 'unavailable' so the app shows the manual picker.
   */
  async classify(input: ClassifyInput): Promise<ClassifyPhotoResponse> {
    const file = await this.prisma.file.findUnique({ where: { id: input.fileId }, select: { id: true, kind: true, ownerUserId: true, deletedAt: true } });
    if (!file || file.deletedAt) throw new ApiException('NOT_FOUND', { entity: 'file', id: input.fileId });
    if (isKycFileKind(file.kind)) throw new ApiException('FILE_TYPE_NOT_ALLOWED', { reason: 'kyc_file' });
    if (file.ownerUserId !== input.userId) throw new ApiException('FILE_NOT_OWNED');
    await this.limiter.enforce(`ai:${input.userId}`, AI_RATE_LIMIT, AI_RATE_WINDOW_SEC);

    const model = this.model;
    if (!this.client) {
      await this.record(input, model, { error: 'not_configured' });
      return UNAVAILABLE;
    }

    let jpeg: Buffer;
    try {
      jpeg = await sharp(input.image)
        .rotate()
        .resize({ width: AI_IMAGE_MAX_PX, height: AI_IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: AI_JPEG_QUALITY })
        .toBuffer();
    } catch (e) {
      await this.record(input, model, { error: `image_invalid: ${(e as Error).message}`.slice(0, 500) });
      return UNAVAILABLE;
    }

    const services = await this.categories.activeServices(input.vertical ?? undefined);
    if (!services.length) {
      await this.record(input, model, { error: 'no_categories' });
      return UNAVAILABLE;
    }
    const slugs = services.map((s) => s.slug);
    const schema = classificationSchema(slugs);

    const started = performance.now();
    let output: ClassificationOutput;
    let usage: { input_tokens?: number | null; output_tokens?: number | null } | undefined;
    try {
      const res = await this.client.messages.parse(
        {
          model,
          max_tokens: AI_MAX_TOKENS,
          system: [{ type: 'text', text: buildSystemPrompt(services), cache_control: { type: 'ephemeral' } }],
          output_config: { effort: 'low', format: jsonSchemaOutputFormat(classificationJsonSchema(slugs), { transform: false }) },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
                { type: 'text', text: buildUserText(input.note, input.vertical) },
              ],
            },
          ],
        },
        { timeout: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES },
      );
      usage = res.usage;
      const latencyMs = Math.round(performance.now() - started);
      if (res.stop_reason === 'refusal') {
        await this.record(input, model, { error: 'refusal', latencyMs, usage });
        return UNAVAILABLE;
      }
      const parsed = schema.safeParse(res.parsed_output);
      if (!parsed.success) {
        await this.record(input, model, { error: `parse_error: stop_reason=${String(res.stop_reason)}`, latencyMs, usage });
        return UNAVAILABLE;
      }
      output = parsed.data;
      return await this.finish(input, model, services, output, latencyMs, usage);
    } catch (e) {
      const latencyMs = Math.round(performance.now() - started);
      const error = describeError(e);
      this.log.warn(`classification failed: ${error}`);
      await this.record(input, model, { error, latencyMs, usage });
      return UNAVAILABLE;
    }
  }

  /** Stores the category the customer finally chose for a classified photo (called by the request flow). */
  async recordFinalCategory(userId: string, fileId: string, categoryId: string): Promise<void> {
    await this.prisma.aiClassification.updateMany({ where: { userId, fileId, finalCategoryId: null }, data: { finalCategoryId: categoryId } });
  }

  private async finish(
    input: ClassifyInput,
    model: string,
    services: CategoryRow[],
    out: ClassificationOutput,
    latencyMs: number,
    usage: { input_tokens?: number | null; output_tokens?: number | null } | undefined,
  ): Promise<ClassifyPhotoResponse> {
    const bySlug = new Map(services.map((s) => [s.slug, s]));
    const chosen = bySlug.get(out.category) ?? null;
    const slugs: string[] = [];
    for (const s of [...(chosen ? [chosen.slug] : []), ...out.candidates]) {
      if (bySlug.has(s) && !slugs.includes(s)) slugs.push(s);
    }
    const candidates = slugs.slice(0, AI_MAX_CANDIDATES).map((s) => {
      const c = bySlug.get(s)!;
      return { categoryId: c.id, slug: c.slug, name: this.categories.name(c, input.locale) };
    });
    await this.record(input, model, {
      resultSlug: out.category,
      confidence: out.confidence,
      candidates: candidates.map((c) => c.slug),
      latencyMs,
      usage,
    });
    const confidence: AiConfidence = out.confidence;
    if (chosen && (confidence === 'high' || confidence === 'medium')) {
      return { status: 'ok', categoryId: chosen.id, slug: chosen.slug, confidence, candidates };
    }
    return { status: 'unsure', categoryId: null, slug: null, confidence, candidates };
  }

  private async record(
    input: ClassifyInput,
    model: string,
    data: {
      resultSlug?: string;
      confidence?: string;
      candidates?: string[];
      latencyMs?: number;
      usage?: { input_tokens?: number | null; output_tokens?: number | null };
      error?: string;
    },
  ): Promise<void> {
    try {
      await this.prisma.aiClassification.create({
        data: {
          userId: input.userId,
          fileId: input.fileId,
          model,
          resultSlug: data.resultSlug ?? null,
          confidence: data.confidence ?? null,
          candidates: data.candidates ?? undefined,
          latencyMs: data.latencyMs ?? null,
          inputTokens: data.usage?.input_tokens ?? null,
          outputTokens: data.usage?.output_tokens ?? null,
          error: data.error ?? null,
        },
      });
    } catch (e) {
      this.log.error(`failed to log classification: ${(e as Error).message}`);
    }
  }
}
