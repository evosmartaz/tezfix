import { cancellationSummary } from '../src/lib/orders';
import { assignment, detail } from './fixtures';

// Fixture assignment: accepted 10:01, free cancel until 10:06.
describe('cancellationSummary (UX-C04: one cancelled state + a free/late line)', () => {
  it('is null for a request that is not cancelled', () => {
    expect(cancellationSummary(detail({ status: 'SEARCHING' }))).toBeNull();
    expect(cancellationSummary(detail({ status: 'CANCELLED', cancelledAt: null }))).toBeNull();
  });

  it('a cancel before anyone accepted is free and has no "after acceptance" minutes', () => {
    const s = cancellationSummary(detail({ status: 'CANCELLED', cancelledAt: '2026-10-25T10:00:30.000Z', assignments: [] }));
    expect(s).toEqual({ cancelledAt: '2026-10-25T10:00:30.000Z', minutesAfterAccept: null, kind: 'free' });
  });

  it('a cancel inside the free window (CANCELLED_FREE) is free', () => {
    const a = assignment({ status: 'CANCELLED_FREE', cancelledBy: 'CUSTOMER', cancelledAt: '2026-10-25T10:04:00.000Z' });
    const s = cancellationSummary(detail({ status: 'CANCELLED', cancelledAt: '2026-10-25T10:04:00.000Z', assignments: [a] }));
    expect(s).toMatchObject({ minutesAfterAccept: 3, kind: 'free' });
  });

  it('a late customer cancel (CANCELLED_BY_CUSTOMER) is a charged cancel', () => {
    const a = assignment({ status: 'CANCELLED_BY_CUSTOMER', cancelledBy: 'CUSTOMER', cancelledAt: '2026-10-25T10:10:00.000Z' });
    const s = cancellationSummary(detail({ status: 'CANCELLED', cancelledAt: '2026-10-25T10:10:00.000Z', assignments: [a] }));
    expect(s).toMatchObject({ minutesAfterAccept: 9, kind: 'late' });
  });

  it('a late cancel by the handyman is not charged to the customer', () => {
    const a = assignment({ status: 'CANCELLED_BY_PROVIDER', cancelledBy: 'PROVIDER', cancelledAt: '2026-10-25T10:10:00.000Z' });
    const s = cancellationSummary(detail({ status: 'CANCELLED', cancelledAt: '2026-10-25T10:10:00.000Z', assignments: [a] }));
    expect(s?.kind).toBe('free');
  });
});
