import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, categoryId, createCustomer } from '../helpers/factories';
import { CategoriesService } from '../../src/modules/categories/categories.service';

let t: TestApp;
let svc: CategoriesService;
beforeAll(async () => {
  t = await createTestApp();
  svc = t.app.get(CategoriesService);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const names = (az: string, ru = `${az} ru`, en = `${az} en`) => ({ az, ru, en });

describe('GET /categories (public)', () => {
  it('returns groups and services localized by Accept-Language with all names and keywords', async () => {
    const az = await t.client(null, 'az').call(api.categories.list, {});
    const ru = await t.client(null, 'ru').call(api.categories.list, {});
    const en = await t.client(null, 'en').call(api.categories.list, {});
    const pick = (items: typeof az.items, slug: string) => items.find((c) => c.slug === slug)!;

    expect(pick(az.items, 'plumbing').name).toBe('Santexnik');
    expect(pick(ru.items, 'plumbing').name).toBe('Сантехник');
    expect(pick(en.items, 'plumbing').name).toBe('Plumber');
    const plumbing = pick(az.items, 'plumbing');
    expect(plumbing.names).toEqual({ az: 'Santexnik', ru: 'Сантехник', en: 'Plumber' });
    expect(plumbing.kind).toBe('SERVICE');
    expect(plumbing.keywords).toContain('kran');
    expect(plumbing.featured).toBe(true);
    expect(plumbing.flow).toBe('INSTANT');

    const group = pick(az.items, 'home-systems');
    expect(group.kind).toBe('GROUP');
    expect(group.parentId).toBeNull();
    expect(plumbing.parentId).toBe(group.id);
    expect(pick(en.items, 'renovation-crew').flow).toBe('QUOTE');
    expect(pick(az.items, 'doors-locks').name).toBe('Qapı-kilid');
  });

  it('filters by vertical', async () => {
    const auto = await t.client().call(api.categories.list, { query: { vertical: 'AUTO' } });
    expect(auto.items.length).toBeGreaterThan(0);
    expect(auto.items.every((c) => c.vertical === 'AUTO')).toBe(true);
    expect(auto.items.map((c) => c.slug)).toEqual(expect.arrayContaining(['roadside', 'battery', 'tire']));
    expect(auto.items.some((c) => c.slug === 'plumbing')).toBe(false);

    const home = await t.client().call(api.categories.list, { query: { vertical: 'HOME' } });
    expect(home.items.every((c) => c.vertical === 'HOME')).toBe(true);
    expect(home.items.some((c) => c.slug === 'plumbing')).toBe(true);
  });

  it('hides inactive categories and services of an inactive group', async () => {
    await t.prisma.category.update({ where: { slug: 'plumbing' }, data: { active: false } });
    let out = await t.client().call(api.categories.list, {});
    expect(out.items.some((c) => c.slug === 'plumbing')).toBe(false);
    expect(out.items.some((c) => c.slug === 'electrical')).toBe(true);
    expect(out.items.every((c) => c.active)).toBe(true);

    await t.prisma.category.update({ where: { slug: 'home-systems' }, data: { active: false } });
    out = await t.client().call(api.categories.list, {});
    expect(out.items.some((c) => c.slug === 'home-systems')).toBe(false);
    expect(out.items.some((c) => c.slug === 'electrical')).toBe(false);
    expect(out.items.some((c) => c.slug === 'battery')).toBe(true);
  });

  it('works without a token and with a user token', async () => {
    const c = await createCustomer(t);
    const out = await t.client(c.token).call(api.categories.list, {});
    expect(out.items.length).toBeGreaterThan(40);
  });
});

describe('admin categories', () => {
  it('lists inactive categories too, localized', async () => {
    const { token } = await adminToken(t);
    await t.prisma.category.update({ where: { slug: 'plumbing' }, data: { active: false } });
    const out = await t.client(token, 'en').call(api.adminCategories.list, {});
    const p = out.items.find((c) => c.slug === 'plumbing')!;
    expect(p.active).toBe(false);
    expect(p.name).toBe('Plumber');
  });

  it('creates a group and a service, writes audit rows, and the public list shows them', async () => {
    const { token, adminId } = await adminToken(t);
    const client = t.client(token, 'ru');
    const group = await client.call(api.adminCategories.create, {
      body: { slug: 'pool-services', vertical: 'HOME', kind: 'GROUP', names: { az: 'Hovuz xidmətləri', ru: 'Бассейны', en: 'Pools' }, icon: 'pool' },
    });
    expect(group).toMatchObject({ slug: 'pool-services', kind: 'GROUP', parentId: null, name: 'Бассейны', active: true, flow: 'INSTANT', featured: false });

    const service = await client.call(api.adminCategories.create, {
      body: {
        slug: 'pool-cleaning',
        parentId: group.id,
        vertical: 'HOME',
        kind: 'SERVICE',
        names: { az: 'Hovuz təmizliyi', ru: 'Чистка бассейна', en: 'Pool cleaning' },
        keywords: ['hovuz', ' hovuz ', 'бассейн', ''],
        emergencyAllowed: false,
        sortOrder: 3,
      },
    });
    expect(service).toMatchObject({ parentId: group.id, kind: 'SERVICE', name: 'Чистка бассейна', emergencyAllowed: false, sortOrder: 3 });
    expect(service.keywords).toEqual(['hovuz', 'бассейн']);

    const audits = await t.prisma.auditLog.findMany({ where: { action: 'category.create' }, orderBy: { at: 'asc' } });
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ actorType: 'ADMIN', actorId: adminId, entityType: 'category', entityId: group.id });
    expect(audits[1]!.entityId).toBe(service.id);
    expect((audits[1]!.after as { slug: string }).slug).toBe('pool-cleaning');

    const pub = await t.client(null, 'az').call(api.categories.list, {});
    expect(pub.items.find((c) => c.slug === 'pool-cleaning')?.name).toBe('Hovuz təmizliyi');
  });

  it('keeps Azerbaijani letters intact', async () => {
    const { token } = await adminToken(t);
    const homeId = await categoryId(t, 'home-systems');
    const az = 'Şüşə, çəngəl, ğöü və İı ə';
    const out = await t.client(token).call(api.adminCategories.create, {
      body: { slug: 'az-letters', parentId: homeId, vertical: 'HOME', kind: 'SERVICE', names: { az, ru: 'Ёлка и щётка', en: 'Letters' }, keywords: ['şüşə', 'İşıq'] },
    });
    expect(out.name).toBe(az);
    const row = await t.prisma.category.findUniqueOrThrow({ where: { id: out.id } });
    expect(row.nameAz).toBe(az);
    expect(row.nameRu).toBe('Ёлка и щётка');
    expect(row.keywords).toEqual(['şüşə', 'İşıq']);
  });

  it('validates the tree on create', async () => {
    const { token } = await adminToken(t);
    const c = t.client(token);
    const home = await categoryId(t, 'home-systems');
    const roadside = await categoryId(t, 'roadside');
    const plumbing = await categoryId(t, 'plumbing');
    const base = { vertical: 'HOME' as const, names: names('Yeni') };

    // GROUP cannot have a parent
    await expect(c.call(api.adminCategories.create, { body: { ...base, slug: 'g-with-parent', kind: 'GROUP', parentId: home } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    // SERVICE needs a parent
    await expect(c.call(api.adminCategories.create, { body: { ...base, slug: 's-no-parent', kind: 'SERVICE' } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(c.call(api.adminCategories.create, { body: { ...base, slug: 's-null-parent', kind: 'SERVICE', parentId: null } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // parent must be a GROUP
    await expect(c.call(api.adminCategories.create, { body: { ...base, slug: 's-under-service', kind: 'SERVICE', parentId: plumbing } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // same vertical
    await expect(c.call(api.adminCategories.create, { body: { ...base, slug: 's-wrong-vertical', kind: 'SERVICE', parentId: roadside } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // parent must exist
    await expect(
      c.call(api.adminCategories.create, { body: { ...base, slug: 's-missing-parent', kind: 'SERVICE', parentId: crypto.randomUUID() } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // parent must be active
    await t.prisma.category.update({ where: { id: home }, data: { active: false } });
    await expect(c.call(api.adminCategories.create, { body: { ...base, slug: 's-inactive-parent', kind: 'SERVICE', parentId: home } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // invalid slug format is rejected by the contract
    await expect(c.call(api.adminCategories.create, { body: { ...base, slug: 'Bad Slug', kind: 'GROUP' } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await t.prisma.auditLog.count()).toBe(0);
  });

  it('rejects duplicate slugs with CONFLICT on create and update', async () => {
    const { token } = await adminToken(t);
    const c = t.client(token);
    await expect(c.call(api.adminCategories.create, { body: { slug: 'plumbing', vertical: 'HOME', kind: 'GROUP', names: names('X') } })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    const electrical = await categoryId(t, 'electrical');
    await expect(c.call(api.adminCategories.update, { params: { id: electrical }, body: { slug: 'plumbing' } })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
  });

  it('updates fields, writes before/after audit and changes the public view', async () => {
    const { token, adminId } = await adminToken(t);
    const id = await categoryId(t, 'plumbing');
    const out = await t.client(token, 'en').call(api.adminCategories.update, {
      params: { id },
      body: { names: { az: 'Santexnika ustası', ru: 'Сантехник', en: 'Plumbing pro' }, featured: false, active: false, keywords: ['su'] },
    });
    expect(out).toMatchObject({ id, slug: 'plumbing', name: 'Plumbing pro', featured: false, active: false, keywords: ['su'] });
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'category.update', entityId: id } });
    expect(audit.actorId).toBe(adminId);
    expect(audit.before).toMatchObject({ active: true, names: { en: 'Plumber' } });
    expect(audit.after).toMatchObject({ active: false, names: { en: 'Plumbing pro' } });

    const pub = await t.client().call(api.categories.list, {});
    expect(pub.items.some((c) => c.id === id)).toBe(false);

    // moving a service to another group of the same vertical
    const appliances = await categoryId(t, 'appliances');
    const moved = await t.client(token).call(api.adminCategories.update, { params: { id }, body: { parentId: appliances, active: true } });
    expect(moved.parentId).toBe(appliances);
  });

  it('validates the tree on update', async () => {
    const { token } = await adminToken(t);
    const c = t.client(token);
    const home = await categoryId(t, 'home-systems');
    const plumbing = await categoryId(t, 'plumbing');
    const roadside = await categoryId(t, 'roadside');
    // group with children cannot become a service
    await expect(c.call(api.adminCategories.update, { params: { id: home }, body: { kind: 'SERVICE', parentId: await categoryId(t, 'appliances') } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // group with HOME children cannot switch vertical
    await expect(c.call(api.adminCategories.update, { params: { id: home }, body: { vertical: 'AUTO' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // service cannot move under a group of another vertical
    await expect(c.call(api.adminCategories.update, { params: { id: plumbing }, body: { parentId: roadside } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // service cannot lose its parent
    await expect(c.call(api.adminCategories.update, { params: { id: plumbing }, body: { parentId: null } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // service cannot become a group while keeping a parent
    await expect(c.call(api.adminCategories.update, { params: { id: plumbing }, body: { kind: 'GROUP' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // ... but can become a group when detached
    const g = await c.call(api.adminCategories.update, { params: { id: plumbing }, body: { kind: 'GROUP', parentId: null } });
    expect(g).toMatchObject({ kind: 'GROUP', parentId: null });
    // unknown id
    await expect(c.call(api.adminCategories.update, { params: { id: crypto.randomUUID() }, body: { featured: true } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('lets an OPERATOR manage categories', async () => {
    const { token } = await adminToken(t, { role: 'OPERATOR' });
    const out = await t.client(token).call(api.adminCategories.create, { body: { slug: 'op-group', vertical: 'AUTO', kind: 'GROUP', names: names('Op') } });
    expect(out.vertical).toBe('AUTO');
  });

  it('forbids non-admins', async () => {
    const cust = await createCustomer(t);
    const id = await categoryId(t, 'plumbing');
    const user = t.client(cust.token);
    await expect(user.call(api.adminCategories.list, {})).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(user.call(api.adminCategories.create, { body: { slug: 'x-group', vertical: 'HOME', kind: 'GROUP', names: names('X') } })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(user.call(api.adminCategories.update, { params: { id }, body: { active: false } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(t.client(null).call(api.adminCategories.list, {})).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect((await t.prisma.category.findUniqueOrThrow({ where: { id } })).active).toBe(true);
    expect(await t.prisma.category.count({ where: { slug: 'x-group' } })).toBe(0);
  });
});

describe('CategoriesService', () => {
  it('requireInstantService enforces kind, active and flow', async () => {
    const plumbing = await categoryId(t, 'plumbing');
    await expect(svc.requireInstantService(plumbing)).resolves.toMatchObject({ slug: 'plumbing' });
    await expect(svc.requireInstantService(crypto.randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.requireInstantService('not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.requireInstantService(await categoryId(t, 'home-systems'))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(svc.requireInstantService(await categoryId(t, 'renovation-crew'))).rejects.toMatchObject({ code: 'CATEGORY_REQUIRES_QUOTE' });
    await t.prisma.category.update({ where: { id: plumbing }, data: { active: false } });
    await expect(svc.requireInstantService(plumbing)).rejects.toMatchObject({ code: 'CATEGORY_INACTIVE' });
    // a service under an inactive group is inactive too
    await t.prisma.category.update({ where: { slug: 'home-systems' }, data: { active: false } });
    await expect(svc.requireInstantService(await categoryId(t, 'electrical'))).rejects.toMatchObject({ code: 'CATEGORY_INACTIVE' });
  });

  it('requireQuoteService enforces the QUOTE flow', async () => {
    await expect(svc.requireQuoteService(await categoryId(t, 'renovation-crew'))).resolves.toMatchObject({ flow: 'QUOTE' });
    await expect(svc.requireQuoteService(await categoryId(t, 'plumbing'))).rejects.toMatchObject({ code: 'CATEGORY_NOT_INSTANT' });
    await expect(svc.requireQuoteService(await categoryId(t, 'construction'))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(svc.requireQuoteService(crypto.randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const roofing = await categoryId(t, 'roofing');
    await t.prisma.category.update({ where: { id: roofing }, data: { active: false } });
    await expect(svc.requireQuoteService(roofing)).rejects.toMatchObject({ code: 'CATEGORY_INACTIVE' });
  });

  it('get, getBySlug, ref, refs, name and activeServices', async () => {
    const id = await categoryId(t, 'battery');
    const row = await svc.get(id);
    expect((await svc.getBySlug('battery')).id).toBe(id);
    await expect(svc.get(crypto.randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.getBySlug('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(svc.ref(row, 'ru')).toEqual({ id, slug: 'battery', name: 'Аккумулятор', icon: 'car-battery', vertical: 'AUTO' });
    expect(svc.name(row, 'en')).toBe('Battery & jump start');
    expect(svc.name(row, 'az')).toBe('Akkumulyator');

    const tire = await categoryId(t, 'tire');
    const refs = await svc.refs([id, tire, id, crypto.randomUUID()], 'az');
    expect(refs.size).toBe(2);
    expect(refs.get(tire)?.name).toBe('Təkər / Vulkanizasiya');

    const services = await svc.activeServices('AUTO');
    expect(services.length).toBeGreaterThan(5);
    expect(services.every((s) => s.kind === 'SERVICE' && s.vertical === 'AUTO' && s.active)).toBe(true);
    await t.prisma.category.update({ where: { id }, data: { active: false } });
    expect((await svc.activeServices()).some((s) => s.id === id)).toBe(false);
  });
});
