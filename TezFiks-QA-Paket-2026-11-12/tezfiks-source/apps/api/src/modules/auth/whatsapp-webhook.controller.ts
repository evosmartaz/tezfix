import { Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { maskPhone } from '@tezfiks/shared';
import { ENV, type Env } from '../../config/env';
import { ApiException } from '../../common/http/api-exception';

interface WhatsAppStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string }>;
}

interface WhatsAppWebhookBody {
  entry?: Array<{ changes?: Array<{ value?: { statuses?: WhatsAppStatus[] } }> }>;
}

/** Verifies a Meta "X-Hub-Signature-256: sha256=<hex>" header over the raw request body. */
export function verifyMetaSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string | undefined): boolean {
  if (!rawBody || !header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const actual = Buffer.from(header.slice('sha256='.length).toLowerCase());
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Meta WhatsApp Cloud API webhook (delivery statuses of login-code messages). Not part of the client contract. */
@Controller()
export class WhatsAppWebhookController {
  private readonly log = new Logger('WhatsAppWebhook');

  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('webhooks/whatsapp')
  verify(@Query() query: Record<string, string | undefined>, @Res() res: Response): void {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'] ?? '';
    const expected = this.env.WHATSAPP_VERIFY_TOKEN;
    const ok =
      mode === 'subscribe' &&
      !!expected &&
      typeof token === 'string' &&
      token.length === expected.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) throw new ApiException('FORBIDDEN');
    res.status(200).type('text/plain').send(String(challenge));
  }

  @Post('webhooks/whatsapp')
  @HttpCode(200)
  receive(@Req() req: Request & { rawBody?: Buffer }) {
    if (!verifyMetaSignature(req.rawBody, req.headers['x-hub-signature-256'] as string | undefined, this.env.WHATSAPP_APP_SECRET)) {
      throw new ApiException('FORBIDDEN');
    }
    const body = (req.body ?? {}) as WhatsAppWebhookBody;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const s of change.value?.statuses ?? []) {
          const to = s.recipient_id ? maskPhone(`+${s.recipient_id}`) : '?';
          const err = s.errors?.length ? ` errors=${JSON.stringify(s.errors.map((e) => ({ code: e.code, title: e.title })))}` : '';
          if (s.status === 'failed') this.log.warn(`message ${s.id ?? '?'} to ${to}: failed${err}`);
          else this.log.log(`message ${s.id ?? '?'} to ${to}: ${s.status ?? 'unknown'}`);
        }
      }
    }
    return { ok: true };
  }
}
