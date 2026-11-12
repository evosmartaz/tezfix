import { CategorySchema, CustomerAccountSchema, RequestDetailSchema, RequestSummarySchema, api } from '@tezfiks/shared';
import { PUBLIC_CONFIG, account, assignment, categories, detail, summary } from './fixtures';

/** The fixtures used by the screen tests must be real contract shapes, or the tests would prove nothing. */
describe('test fixtures follow the shared contract', () => {
  it('categories, account, request summary/detail, assignment and public config parse', () => {
    for (const c of categories()) expect(CategorySchema.safeParse(c).success).toBe(true);
    expect(CustomerAccountSchema.safeParse(account()).success).toBe(true);
    expect(RequestSummarySchema.safeParse(summary()).success).toBe(true);
    expect(RequestDetailSchema.safeParse(detail()).success).toBe(true);
    expect(RequestDetailSchema.safeParse(detail({ status: 'ASSIGNED', assignments: [assignment()], slots: [{ index: 0, status: 'FILLED', assignmentId: assignment().id }] })).success).toBe(true);
    expect(api.health.config.response.safeParse(PUBLIC_CONFIG).success).toBe(true);
  });
});
