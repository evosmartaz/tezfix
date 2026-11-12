import { Injectable } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import type { AddressInput, CustomerAccount as CustomerAccountDto, CustomerType, LegalForm, SavedAddress } from '@tezfiks/shared';
import { PrismaService, inTx, type Db, type Tx } from '../../infra/prisma.service';
import { ApiException } from '../../common/http/api-exception';
import { iso, ratingAvg } from '../../common/mapping';
import { newId } from '../../infra/ids';
import { Clock } from '../../infra/clock';
import { LedgerService } from '../ledger/ledger.service';
import type { Address, CustomerAccount } from '../../generated/prisma/client';

/** Max saved addresses per customer account (soft-deleted ones do not count). */
export const MAX_SAVED_ADDRESSES = 50;

export interface UpsertAccountInput {
  type: CustomerType;
  companyName?: string;
  voen?: string;
  legalForm?: LegalForm;
  contactPerson?: string;
}

type AddressFields = {
  lat?: number;
  lng?: number;
  formatted?: string;
  placeId?: string | null;
  district?: string | null;
  street?: string | null;
  building?: string | null;
  block?: string | null;
  entrance?: string | null;
  floor?: string | null;
  apartment?: string | null;
  intercom?: string | null;
  note?: string | null;
  label?: string | null;
  isSite?: boolean;
};

const TEXT_FIELDS = ['placeId', 'district', 'street', 'building', 'block', 'entrance', 'floor', 'apartment', 'intercom', 'note', 'label'] as const;

/**
 * Locks the acting user's row (FOR SHARE) inside a transaction and refuses users that are not ACTIVE.
 * Closes the race with account deletion / blocking (A1 deleteAccount takes FOR UPDATE on the same row).
 */
export async function lockActiveUser(tx: Tx, userId: string, mode: 'SHARE' | 'UPDATE' = 'SHARE'): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<{ status: string }>>(
    `SELECT status::text AS status FROM users WHERE id = $1::uuid FOR ${mode === 'UPDATE' ? 'UPDATE' : 'SHARE'}`,
    userId,
  );
  const status = rows[0]?.status;
  if (status === 'ACTIVE') return;
  if (status === 'BLOCKED') throw new ApiException('USER_BLOCKED');
  throw new ApiException('FORBIDDEN', { reason: 'USER_NOT_ACTIVE' });
}

/** Customer account (individual or company) and address book. Exported: requireAccount is used by the request flow. */
@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly clock: Clock,
  ) {}

  async findAccount(userId: string, db: Db = this.prisma): Promise<CustomerAccount | null> {
    return db.customerAccount.findUnique({ where: { ownerUserId: userId } });
  }

  /** The caller's customer account; CUSTOMER_ACCOUNT_REQUIRED when the account-type step was not done yet. */
  async requireAccount(userId: string, db: Db = this.prisma): Promise<CustomerAccount> {
    const acc = await this.findAccount(userId, db);
    if (!acc) throw new ApiException('CUSTOMER_ACCOUNT_REQUIRED');
    return acc;
  }

  async view(acc: CustomerAccount): Promise<CustomerAccountDto> {
    return {
      id: acc.id,
      type: acc.type,
      companyName: acc.companyName ?? null,
      voen: acc.voen ?? null,
      legalForm: acc.legalForm ?? null,
      contactPerson: acc.contactPerson ?? null,
      ratingAvg: ratingAvg(acc.ratingSum, acc.ratingCount),
      ratingCount: acc.ratingCount,
      wallet: await this.ledger.summary(acc.walletAccountId),
    };
  }

  async getAccount(userId: string): Promise<{ account: CustomerAccountDto | null }> {
    const acc = await this.findAccount(userId);
    return { account: acc ? await this.view(acc) : null };
  }

  /**
   * Creates the account (with its WALLET ledger account) on the first call, or switches it between INDIVIDUAL and
   * COMPANY. The wallet always stays the same. Switching to INDIVIDUAL clears the company fields.
   */
  async upsertAccount(userId: string, body: UpsertAccountInput): Promise<CustomerAccountDto> {
    const acc = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId, 'UPDATE');
      const existing = await tx.customerAccount.findUnique({ where: { ownerUserId: userId } });
      const contactPerson = body.contactPerson ?? existing?.contactPerson ?? null;
      const data =
        body.type === 'COMPANY'
          ? {
              type: 'COMPANY' as const,
              companyName: body.companyName ?? existing?.companyName ?? null,
              voen: body.voen ?? existing?.voen ?? null,
              legalForm: body.legalForm ?? existing?.legalForm ?? null,
              contactPerson,
            }
          : { type: 'INDIVIDUAL' as const, companyName: null, voen: null, legalForm: null, contactPerson };
      if (data.type === 'COMPANY' && (!data.companyName || !data.voen)) {
        throw new ApiException('VALIDATION_FAILED', { field: 'companyName', reason: 'company_fields_required' });
      }
      if (existing) return tx.customerAccount.update({ where: { id: existing.id }, data });
      const id = newId();
      const wallet = await this.ledger.ensureAccount('CUSTOMER_ACCOUNT', id, 'WALLET', { allowNegative: false }, tx);
      return tx.customerAccount.create({ data: { id, ownerUserId: userId, walletAccountId: wallet.id, ...data } });
    });
    return this.view(acc);
  }

  // ------------------------------------------------------------------ addresses

  addressView(a: Address): SavedAddress {
    return {
      id: a.id,
      lat: a.lat,
      lng: a.lng,
      formatted: a.formatted,
      placeId: a.placeId ?? null,
      district: a.district ?? null,
      street: a.street ?? null,
      building: a.building ?? null,
      block: a.block ?? null,
      entrance: a.entrance ?? null,
      floor: a.floor ?? null,
      apartment: a.apartment ?? null,
      intercom: a.intercom ?? null,
      note: a.note ?? null,
      label: a.label ?? null,
      isSite: a.isSite,
      createdAt: iso(a.createdAt),
    };
  }

  async listAddresses(userId: string): Promise<{ items: SavedAddress[] }> {
    const acc = await this.requireAccount(userId);
    const rows = await this.prisma.address.findMany({
      where: { customerAccountId: acc.id, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return { items: rows.map((r) => this.addressView(r)) };
  }

  /** Saves an address (cell7/cell9 computed from the pin). Also used by request creation ("save to address book"). */
  async createAddress(customerAccountId: string, input: AddressInput & { label?: string | null; isSite?: boolean }, db: Db = this.prisma): Promise<Address> {
    const count = await db.address.count({ where: { customerAccountId, deletedAt: null } });
    if (count >= MAX_SAVED_ADDRESSES) throw new ApiException('VALIDATION_FAILED', { reason: 'too_many_addresses', max: MAX_SAVED_ADDRESSES });
    const fields = this.normalize(input as AddressFields);
    return db.address.create({
      data: {
        customerAccountId,
        lat: input.lat,
        lng: input.lng,
        cell7: latLngToCell(input.lat, input.lng, 7),
        cell9: latLngToCell(input.lat, input.lng, 9),
        formatted: input.formatted,
        placeId: fields.placeId ?? null,
        district: fields.district ?? null,
        street: fields.street ?? null,
        building: fields.building ?? null,
        block: fields.block ?? null,
        entrance: fields.entrance ?? null,
        floor: fields.floor ?? null,
        apartment: fields.apartment ?? null,
        intercom: fields.intercom ?? null,
        note: fields.note ?? null,
        label: fields.label ?? null,
        isSite: input.isSite ?? false,
      },
    });
  }

  async addAddress(userId: string, input: AddressInput & { label?: string | null; isSite?: boolean }): Promise<SavedAddress> {
    const acc = await this.requireAccount(userId);
    return this.addressView(await this.createAddress(acc.id, input));
  }

  async updateAddress(userId: string, id: string, patch: AddressFields): Promise<SavedAddress> {
    const acc = await this.requireAccount(userId);
    const row = await this.ownAddress(acc.id, id);
    if ((patch.lat === undefined) !== (patch.lng === undefined)) {
      throw new ApiException('VALIDATION_FAILED', { field: 'lat', reason: 'lat_and_lng_together' });
    }
    const fields = this.normalize(patch);
    const data: Record<string, unknown> = {};
    for (const k of TEXT_FIELDS) if (k in fields) data[k] = fields[k] ?? null;
    if (patch.formatted !== undefined) data.formatted = patch.formatted;
    if (patch.isSite !== undefined) data.isSite = patch.isSite;
    if (patch.lat !== undefined && patch.lng !== undefined) {
      data.lat = patch.lat;
      data.lng = patch.lng;
      data.cell7 = latLngToCell(patch.lat, patch.lng, 7);
      data.cell9 = latLngToCell(patch.lat, patch.lng, 9);
    }
    const updated = await this.prisma.address.update({ where: { id: row.id }, data });
    return this.addressView(updated);
  }

  async deleteAddress(userId: string, id: string): Promise<{ ok: true }> {
    const acc = await this.requireAccount(userId);
    const row = await this.ownAddress(acc.id, id);
    await this.prisma.address.update({ where: { id: row.id }, data: { deletedAt: this.clock.now() } });
    return { ok: true };
  }

  private async ownAddress(customerAccountId: string, id: string): Promise<Address> {
    const row = await this.prisma.address.findUnique({ where: { id } });
    if (!row || row.customerAccountId !== customerAccountId || row.deletedAt) throw new ApiException('NOT_FOUND', { entity: 'address', id });
    return row;
  }

  /** Empty strings become null; only keys present in the input are returned. */
  private normalize(input: AddressFields): Partial<Record<(typeof TEXT_FIELDS)[number], string | null>> {
    const out: Partial<Record<(typeof TEXT_FIELDS)[number], string | null>> = {};
    for (const k of TEXT_FIELDS) {
      if (!(k in input) || input[k] === undefined) continue;
      const v = input[k];
      out[k] = typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
    }
    return out;
  }
}
