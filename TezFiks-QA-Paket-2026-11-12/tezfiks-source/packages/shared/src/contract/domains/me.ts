import { z } from 'zod';
import { endpoint } from '../define';
import { FileRefSchema, Id, IsoDateTime, Ok } from '../common';
import {
  AppKind,
  CompanyRole,
  CustomerType,
  DevicePlatform,
  HandymanKind,
  LocaleSchema,
  PushProvider,
  UserStatus,
  VerificationStatus,
} from '../../enums';

export const MeSchema = z.object({
  id: Id,
  phone: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  photo: FileRefSchema.nullable(),
  locale: LocaleSchema,
  status: UserStatus.schema,
  createdAt: IsoDateTime,
  /** firstName and lastName are set. */
  profileComplete: z.boolean(),
  customer: z
    .object({ id: Id, type: CustomerType.schema, companyName: z.string().nullable() })
    .nullable(),
  handyman: z
    .object({
      id: Id,
      kind: HandymanKind.schema,
      status: VerificationStatus.schema,
      companyId: Id.nullable(),
      isOnline: z.boolean(),
    })
    .nullable(),
  companies: z.array(
    z.object({
      companyId: Id,
      companyName: z.string(),
      role: CompanyRole.schema,
      companyStatus: VerificationStatus.schema,
    }),
  ),
});
export type Me = z.infer<typeof MeSchema>;

export const UpdateMeBodySchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  locale: LocaleSchema.optional(),
  photoFileId: Id.nullable().optional(),
});

export const RegisterDeviceBodySchema = z.object({
  deviceId: z.string().min(8).max(128),
  app: z.enum(['CUSTOMER', 'PRO', 'PANEL']),
  platform: DevicePlatform.schema,
  pushToken: z.string().max(500).nullable(),
  pushProvider: PushProvider.schema.nullable(),
  appVersion: z.string().max(40).optional(),
});

export const meEndpoints = {
  get: endpoint({ method: 'GET', path: '/me', auth: 'user', response: MeSchema }),
  update: endpoint({ method: 'PATCH', path: '/me', auth: 'user', body: UpdateMeBodySchema, response: MeSchema }),
  registerDevice: endpoint({
    method: 'POST',
    path: '/me/devices',
    auth: 'user',
    body: RegisterDeviceBodySchema,
    response: Ok,
    summary: 'Registers or updates the push token for this device and app',
  }),
  deleteAccount: endpoint({
    method: 'DELETE',
    path: '/me',
    auth: 'user',
    response: Ok,
    summary: 'Deletes the account (Google Play requirement): anonymizes personal data, revokes sessions',
  }),
};

export { AppKind };
