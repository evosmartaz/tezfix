import sharp from 'sharp';
import { io, type Socket } from 'socket.io-client';
import { api, type ClientToServerEvents, type FileKind, type FileRef, type ServerToClientEvents, type SocketAck } from '@tezfiks/shared';
import type { TestApp } from '../helpers/app';
import { BAKU, categoryId, createUser, tokenFor, type CreatedUser } from '../helpers/factories';

// ------------------------------------------------------------------ files

export function pngBuffer(seed = 0): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: (seed * 37) % 256, g: 169, b: 113 } } })
    .png()
    .toBuffer();
}

/** Multipart upload through the typed client (api.files.upload). */
export async function upload(t: TestApp, token: string, kind: FileKind, seed = 0): Promise<FileRef> {
  const buffer = await pngBuffer(seed);
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), 'photo.png');
  return t.client(token).call(api.files.upload, { formData: fd });
}

export interface KycBodyOpts {
  subject?: 'HANDYMAN' | 'COMPANY';
  companyId?: string;
  tradeProofs?: number;
  companyDocs?: number;
}

/** Uploads a full KYC file set as the caller and returns a valid submit body. */
export async function kycBody(t: TestApp, token: string, opts: KycBodyOpts = {}) {
  const [front, back, selfie, turn, blink] = await Promise.all([
    upload(t, token, 'KYC_ID_FRONT', 1),
    upload(t, token, 'KYC_ID_BACK', 2),
    upload(t, token, 'KYC_SELFIE', 3),
    upload(t, token, 'KYC_SELFIE_TURN', 4),
    upload(t, token, 'KYC_SELFIE_BLINK', 5),
  ]);
  const tradeProofs = await Promise.all(Array.from({ length: opts.tradeProofs ?? 0 }, (_, i) => upload(t, token, 'KYC_TRADE_PROOF', 10 + i)));
  const companyDocs = await Promise.all(Array.from({ length: opts.companyDocs ?? 0 }, (_, i) => upload(t, token, 'COMPANY_DOC', 20 + i)));
  return {
    subject: opts.subject ?? ('HANDYMAN' as const),
    ...(opts.companyId ? { companyId: opts.companyId } : {}),
    idFrontFileId: front.id,
    idBackFileId: back.id,
    selfie: { frontFileId: selfie.id, turnFileId: turn.id, blinkFileId: blink.id },
    selfieChecks: {
      front: { faces: 1, rotationY: 0, eyesOpenMin: 0.9, ok: true },
      turn: { faces: 1, rotationY: 32, eyesOpenMin: 0.8, ok: true },
      blink: { faces: 1, rotationY: 2, eyesOpenMin: 0.05, ok: true },
    },
    tradeProofFileIds: tradeProofs.map((f) => f.id),
    companyDocFileIds: companyDocs.map((f) => f.id),
    consent: { policyVersion: 'kyc-2026-10', locale: 'az' as const, accepted: true as const },
  };
}

// ------------------------------------------------------------- onboarding

export interface ProUser extends CreatedUser {
  token: string;
}

/** A fresh user with a PRO session (no handyman profile yet). */
export async function proUser(t: TestApp, data: { firstName?: string; lastName?: string } = {}): Promise<ProUser> {
  const u = await createUser(t, data);
  return { ...u, token: await tokenFor(t, u.userId, 'PRO') };
}

/** Onboards a DRAFT solo handyman through the API. */
export async function onboardSolo(
  t: TestApp,
  u: ProUser,
  data: { trades?: string[]; radiusKm?: number; firstName?: string; lastName?: string } = {},
) {
  const tradeIds = await Promise.all((data.trades ?? ['plumbing']).map((s) => categoryId(t, s)));
  return t.client(u.token).call(api.pro.onboardSolo, {
    body: {
      firstName: data.firstName ?? 'Elvin',
      lastName: data.lastName ?? 'Məmmədov',
      tradeIds,
      serviceRadiusKm: data.radiusKm ?? 10,
      base: BAKU.center,
    },
  });
}

let voenSeq = 0;
export function uniqueVoen(): string {
  voenSeq += 1;
  return String(1_700_000_000 + ((Date.now() % 100_000) * 100 + voenSeq) % 299_999_999).padStart(10, '0').slice(0, 10);
}

/** Registers a DRAFT company through the API (caller becomes MANAGER). */
export async function onboardCompany(t: TestApp, u: ProUser, data: { name?: string; voen?: string; trades?: string[] } = {}) {
  const tradeIds = await Promise.all((data.trades ?? ['electrical', 'plumbing']).map((s) => categoryId(t, s)));
  return t.client(u.token).call(api.pro.onboardCompany, {
    body: {
      firstName: 'Fuad',
      lastName: 'İdarəçi',
      company: {
        name: data.name ?? 'Usta Servis MMC',
        legalForm: 'MMC',
        voen: data.voen ?? uniqueVoen(),
        tradeIds,
        base: BAKU.center,
        baseAddress: 'Nizami küçəsi 10, Bakı',
      },
    },
  });
}

/** Sets a handyman profile's wallet funding check helper: available balance of a ledger account. */
export async function available(t: TestApp, accountId: string): Promise<number> {
  return (await t.ledger.balance(accountId)).available;
}

// ---------------------------------------------------------------- sockets

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const SOCKET_PATH = '/tezfix/api/socket.io';
const open: ClientSocket[] = [];

export function connectSocket(t: TestApp, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket: ClientSocket = io(t.origin, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: { token },
      forceNew: true,
      reconnection: false,
      timeout: 5000,
    });
    open.push(socket);
    const timer = setTimeout(() => reject(new Error('connect timeout')), 8000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

export function closeAllSockets(): void {
  for (const s of open.splice(0)) s.close();
}

export function disconnected(s: ClientSocket, ms = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!s.connected) return resolve('already');
    const timer = setTimeout(() => reject(new Error('still connected')), ms);
    s.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

export function emitAck(socket: ClientSocket, event: keyof ClientToServerEvents, payload: unknown): Promise<SocketAck> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 5000);
    (socket.emit as (ev: string, p: unknown, cb: (r: SocketAck) => void) => void)(event, payload, (r: SocketAck) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/** True if `event` arrives within `ms`. */
export function receives(socket: ClientSocket, event: keyof ServerToClientEvents, ms = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      socket.off(event as never, handler as never);
      resolve(false);
    }, ms);
    socket.once(event as never, handler as never);
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
