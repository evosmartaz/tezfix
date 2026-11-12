import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createUser, fund, tokenFor } from '../helpers/factories';
import { CustomerService } from '../../src/modules/customer/customer.service';
import { addressAt } from './helpers';

describe('B1 customer account and addresses', () => {
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

  async function newUser() {
    const u = await createUser(t, { firstName: 'Aysel', lastName: 'Qasımova' });
    return { ...u, token: await tokenFor(t, u.userId, 'CUSTOMER') };
  }

  it('getAccount is null before the account-type step', async () => {
    const u = await newUser();
    expect(await t.client(u.token).call(api.customer.getAccount)).toEqual({ account: null });
  });

  it('creates an INDIVIDUAL account with a wallet, then switches to COMPANY and back keeping the wallet', async () => {
    const u = await newUser();
    const c = t.client(u.token);
    const a = await c.call(api.customer.upsertAccount, { body: { type: 'INDIVIDUAL' } });
    expect(a).toMatchObject({ type: 'INDIVIDUAL', companyName: null, voen: null, ratingAvg: null, ratingCount: 0 });
    expect(a.wallet).toMatchObject({ posted: 0, held: 0, available: 0, isDebt: false, currency: 'AZN' });
    const wallet = await t.prisma.ledgerAccount.findUniqueOrThrow({ where: { id: a.wallet.accountId } });
    expect(wallet).toMatchObject({ ownerType: 'CUSTOMER_ACCOUNT', ownerId: a.id, kind: 'WALLET', allowNegative: false });

    await fund(t, a.wallet.accountId, 2500);
    const b = await c.call(api.customer.upsertAccount, {
      body: { type: 'COMPANY', companyName: 'Kontur MMC', voen: '1234567890', legalForm: 'MMC', contactPerson: 'Rəşad Əliyev' },
    });
    expect(b).toMatchObject({ id: a.id, type: 'COMPANY', companyName: 'Kontur MMC', voen: '1234567890', legalForm: 'MMC', contactPerson: 'Rəşad Əliyev' });
    expect(b.wallet.accountId).toBe(a.wallet.accountId);
    expect(b.wallet.posted).toBe(2500);

    const back = await c.call(api.customer.upsertAccount, { body: { type: 'INDIVIDUAL' } });
    expect(back).toMatchObject({ id: a.id, type: 'INDIVIDUAL', companyName: null, voen: null, legalForm: null, contactPerson: 'Rəşad Əliyev' });
    expect(back.wallet.accountId).toBe(a.wallet.accountId);
    expect(await t.prisma.customerAccount.count({ where: { ownerUserId: u.userId } })).toBe(1);
    expect((await c.call(api.customer.getAccount)).account?.id).toBe(a.id);
  });

  it('COMPANY requires companyName and a 10-digit VÖEN', async () => {
    const u = await newUser();
    const c = t.client(u.token);
    await expect(c.call(api.customer.upsertAccount, { body: { type: 'COMPANY', companyName: 'Kontur MMC' } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    await expect(c.call(api.customer.upsertAccount, { body: { type: 'COMPANY', companyName: 'Kontur MMC', voen: '12345' } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await t.prisma.customerAccount.count()).toBe(0);
  });

  it('two concurrent first upserts create one account and one wallet', async () => {
    const u = await newUser();
    const c = t.client(u.token);
    const [a, b] = await Promise.all([
      c.call(api.customer.upsertAccount, { body: { type: 'INDIVIDUAL' } }),
      c.call(api.customer.upsertAccount, { body: { type: 'INDIVIDUAL' } }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await t.prisma.ledgerAccount.count({ where: { ownerType: 'CUSTOMER_ACCOUNT' } })).toBe(1);
  });

  it('address book: create with cells, list, patch (cells recomputed), soft delete, Azerbaijani text intact', async () => {
    const u = await newUser();
    const c = t.client(u.token);
    await expect(c.call(api.customer.listAddresses)).rejects.toMatchObject({ code: 'CUSTOMER_ACCOUNT_REQUIRED', status: 409 });
    await c.call(api.customer.upsertAccount, { body: { type: 'INDIVIDUAL' } });
    const created = await c.call(api.customer.createAddress, {
      body: { ...addressAt(BAKU.center, { street: 'Şəhriyar küçəsi', district: 'Nəsimi rayonu' }), label: 'Ev — İçərişəhər', isSite: false },
    });
    expect(created).toMatchObject({ label: 'Ev — İçərişəhər', street: 'Şəhriyar küçəsi', district: 'Nəsimi rayonu', apartment: 'mənzil 45', isSite: false });
    const row = await t.prisma.address.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.cell7).toBe(latLngToCell(BAKU.center.lat, BAKU.center.lng, 7));
    expect(row.cell9).toBe(latLngToCell(BAKU.center.lat, BAKU.center.lng, 9));

    const patched = await c.call(api.customer.updateAddress, {
      params: { id: created.id },
      body: { lat: BAKU.ahmadli.lat, lng: BAKU.ahmadli.lng, label: 'Ofis', apartment: null },
    });
    expect(patched).toMatchObject({ lat: BAKU.ahmadli.lat, lng: BAKU.ahmadli.lng, label: 'Ofis', apartment: null, street: 'Şəhriyar küçəsi' });
    const row2 = await t.prisma.address.findUniqueOrThrow({ where: { id: created.id } });
    expect(row2.cell7).toBe(latLngToCell(BAKU.ahmadli.lat, BAKU.ahmadli.lng, 7));

    await expect(c.call(api.customer.updateAddress, { params: { id: created.id }, body: { lat: 40.1 } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    expect((await c.call(api.customer.listAddresses)).items.map((a) => a.id)).toEqual([created.id]);
    expect(await c.call(api.customer.deleteAddress, { params: { id: created.id } })).toEqual({ ok: true });
    expect((await c.call(api.customer.listAddresses)).items).toEqual([]);
    expect((await t.prisma.address.findUniqueOrThrow({ where: { id: created.id } })).deletedAt).not.toBeNull();
    await expect(c.call(api.customer.deleteAddress, { params: { id: created.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("another customer's address is NOT_FOUND", async () => {
    const a = await newUser();
    const b = await newUser();
    await t.client(a.token).call(api.customer.upsertAccount, { body: { type: 'INDIVIDUAL' } });
    await t.client(b.token).call(api.customer.upsertAccount, { body: { type: 'INDIVIDUAL' } });
    const addr = await t.client(a.token).call(api.customer.createAddress, { body: addressAt() });
    await expect(t.client(b.token).call(api.customer.updateAddress, { params: { id: addr.id }, body: { label: 'x' } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await expect(t.client(b.token).call(api.customer.deleteAddress, { params: { id: addr.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a blocked user cannot create the account (row lock re-checks users.status)', async () => {
    const u = await newUser();
    await t.prisma.user.update({ where: { id: u.userId }, data: { status: 'BLOCKED' } });
    await expect(t.app.get(CustomerService).upsertAccount(u.userId, { type: 'INDIVIDUAL' })).rejects.toMatchObject({ code: 'USER_BLOCKED' });
  });
});
