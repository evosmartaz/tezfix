import { describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import * as f from './admin-fixtures';

/** The fixtures used by the admin page/component tests must be exactly what the contract allows. */
describe('admin fixtures match the contract', () => {
  const cases: Array<[string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, unknown]> = [
    ['dashboard', api.admin.dashboard.response, f.dashboard],
    ['public config', api.health.config.response, f.publicConfig],
    ['handymen page', api.admin.handymen.response, f.handymenPage],
    ['handyman detail', api.admin.handyman.response, f.handymanDetail],
    ['settings', api.admin.settings.response, f.settingsResponse],
    ['admins', api.admin.admins.response, f.adminUsers],
    ['categories', api.adminCategories.list.response, f.categories],
    ['live map', api.admin.liveMap.response, f.liveMap],
    ['demo state', api.admin.demoState.response, f.demoState],
    ['request detail', api.admin.request.response, f.requestDetail],
    ['companies page', api.admin.companies.response, f.companiesPage],
    ['customers page', api.admin.customers.response, f.customersPage],
    ['customer detail', api.admin.customer.response, f.customerDetail],
    ['ledger page', api.admin.ledger.response, f.ledgerPage],
    ['payments page', api.admin.payments.response, f.paymentsPage],
    ['payouts page', api.admin.payouts.response, f.payoutsPage],
    ['invoices page', api.admin.invoices.response, f.invoicesPage],
    ['projects page', api.admin.projects.response, f.projectsPage],
    ['project detail', api.admin.project.response, f.projectDetail],
    ['audit page', api.admin.audit.response, f.auditPage],
  ];
  it.each(cases)('%s', (_name, schema, value) => {
    const parsed = schema.safeParse(value);
    expect(parsed.error ?? null).toBeNull();
    expect(parsed.success).toBe(true);
  });
});
