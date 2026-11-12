import { z } from 'zod';
import { endpoint } from '../define';
import { Id, IsoDateTime } from '../common';
import { CompanyRole } from '../../enums';
import { ProProfileResponseSchema } from './pro';

export const InvitePreviewSchema = z.object({
  companyName: z.string(),
  role: CompanyRole.schema,
  expiresAt: IsoDateTime,
  valid: z.boolean(),
  reason: z.enum(['EXPIRED', 'REVOKED', 'USED_UP', 'COMPANY_NOT_APPROVED']).nullable(),
});

export const invitesEndpoints = {
  preview: endpoint({
    method: 'GET',
    path: '/invites/:token',
    auth: 'none',
    params: z.object({ token: z.string().min(10).max(64) }),
    response: InvitePreviewSchema,
  }),
  accept: endpoint({
    method: 'POST',
    path: '/invites/:token/accept',
    auth: 'user',
    params: z.object({ token: z.string().min(10).max(64) }),
    body: z.object({
      firstName: z.string().trim().min(1).max(60).optional(),
      lastName: z.string().trim().min(1).max(60).optional(),
      tradeIds: z.array(Id).min(1).max(15).optional(),
    }),
    response: ProProfileResponseSchema,
    summary: 'Joins the company as WORKER (approved immediately: the company is verified) or MANAGER',
  }),
};
