import { authEndpoints } from './domains/auth';
import { meEndpoints } from './domains/me';
import { filesEndpoints } from './domains/files';
import { categoriesEndpoints, adminCategoriesEndpoints } from './domains/categories';
import { geoEndpoints } from './domains/geo';
import { customerEndpoints } from './domains/customer';
import { requestsEndpoints } from './domains/requests';
import { assignmentsEndpoints } from './domains/assignments';
import { chatEndpoints } from './domains/chat';
import { casesEndpoints } from './domains/cases';
import { proEndpoints } from './domains/pro';
import { kycEndpoints } from './domains/kyc';
import { invitesEndpoints } from './domains/invites';
import { companyEndpoints } from './domains/company';
import { walletEndpoints } from './domains/wallet';
import { paymentsEndpoints } from './domains/payments';
import { projectsEndpoints, providerProjectsEndpoints } from './domains/projects';
import { notificationsEndpoints } from './domains/notifications';
import { adminEndpoints } from './domains/admin';
import { endpoint } from './define';
import { z } from 'zod';

export const healthEndpoints = {
  get: endpoint({
    method: 'GET',
    path: '/health',
    auth: 'none',
    response: z.object({ status: z.enum(['ok', 'degraded']), db: z.boolean(), redis: z.boolean(), version: z.string(), time: z.string() }),
  }),
  config: endpoint({
    method: 'GET',
    path: '/config/public',
    auth: 'none',
    response: z.object({
      demoMode: z.boolean(),
      requestFee: z.int(),
      emergencyFeePerSlot: z.int(),
      cancelPenalty: z.int(),
      /** The provider's share (qəpik) of the decline-on-arrival penalty; the rest is the platform fee. */
      penaltyCompensation: z.int().optional(),
      freeCancelSec: z.int(),
      offerTtlSec: z.int(),
      maxSlots: z.int(),
      maxPhotos: z.int(),
      guaranteeDays: z.int(),
      scheduledMinLeadMin: z.int(),
      scheduledMaxLeadDays: z.int(),
      contactUnlockEtaSec: z.int(),
      lowBalanceThreshold: z.int(),
      currency: z.string(),
      supportPhone: z.string().nullable(),
      aiEnabled: z.boolean(),
      /** False when card payments, top-ups and tips are unavailable (PAYMENTS_UNAVAILABLE): apps offer cash only. */
      cardPayments: z.boolean().optional(),
      mapsEnabled: z.boolean(),
      otpChannel: z.string(),
    }),
    summary: 'Public settings for clients (fees, timers, feature flags)',
  }),
};

/** The complete TezFiks REST API. Paths are relative to the API prefix (/tezfix/api). */
export const api = {
  health: healthEndpoints,
  auth: authEndpoints,
  me: meEndpoints,
  files: filesEndpoints,
  categories: categoriesEndpoints,
  geo: geoEndpoints,
  customer: customerEndpoints,
  requests: requestsEndpoints,
  assignments: assignmentsEndpoints,
  chat: chatEndpoints,
  cases: casesEndpoints,
  pro: proEndpoints,
  kyc: kycEndpoints,
  invites: invitesEndpoints,
  company: companyEndpoints,
  wallet: walletEndpoints,
  payments: paymentsEndpoints,
  projects: projectsEndpoints,
  providerProjects: providerProjectsEndpoints,
  notifications: notificationsEndpoints,
  admin: adminEndpoints,
  adminCategories: adminCategoriesEndpoints,
};

export type Api = typeof api;
