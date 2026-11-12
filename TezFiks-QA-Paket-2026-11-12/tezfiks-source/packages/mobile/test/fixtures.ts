import type { Me } from '@tezfiks/shared';

export function makeMe(over: Partial<Me> = {}): Me {
  return {
    id: 'u1',
    phone: '+994501234567',
    firstName: 'Nizami',
    lastName: 'Tağızadə',
    photo: null,
    locale: 'az',
    status: 'ACTIVE' as Me['status'],
    createdAt: '2026-10-25T10:00:00.000Z',
    profileComplete: true,
    customer: null,
    handyman: null,
    companies: [],
    ...over,
  };
}
