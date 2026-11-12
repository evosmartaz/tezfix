import { z } from 'zod';
import { endpoint } from '../define';
import { AddressInputSchema, AddressViewSchema, Id, IdParams, IsoDateTime, Ok } from '../common';
import { CustomerType, LegalForm } from '../../enums';
import { WalletSummarySchema } from './wallet';

export const VoenSchema = z.string().regex(/^\d{10}$/, 'VÖEN must be 10 digits');

export const CustomerAccountSchema = z.object({
  id: Id,
  type: CustomerType.schema,
  companyName: z.string().nullable(),
  voen: z.string().nullable(),
  legalForm: LegalForm.schema.nullable(),
  contactPerson: z.string().nullable(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.int(),
  wallet: WalletSummarySchema,
});
export type CustomerAccount = z.infer<typeof CustomerAccountSchema>;

export const UpsertCustomerAccountBodySchema = z
  .object({
    type: CustomerType.schema,
    companyName: z.string().trim().min(2).max(120).optional(),
    voen: VoenSchema.optional(),
    legalForm: LegalForm.schema.optional(),
    contactPerson: z.string().trim().min(2).max(120).optional(),
  })
  .refine((v) => v.type === 'INDIVIDUAL' || (!!v.companyName && !!v.voen), {
    message: 'companyName and voen are required for company accounts',
    path: ['companyName'],
  });

export const SavedAddressSchema = AddressViewSchema.extend({
  id: Id,
  label: z.string().nullable(),
  /** Company "Obyekt / filial". */
  isSite: z.boolean(),
  createdAt: IsoDateTime,
});
export type SavedAddress = z.infer<typeof SavedAddressSchema>;

export const SaveAddressBodySchema = AddressInputSchema.extend({
  label: z.string().trim().max(60).nullish(),
  isSite: z.boolean().optional(),
});

export const customerEndpoints = {
  getAccount: endpoint({
    method: 'GET',
    path: '/customer/account',
    auth: 'user',
    response: z.object({ account: CustomerAccountSchema.nullable() }),
  }),
  upsertAccount: endpoint({
    method: 'POST',
    path: '/customer/account',
    auth: 'user',
    body: UpsertCustomerAccountBodySchema,
    response: CustomerAccountSchema,
    summary: 'Creates the customer account (account-type step A3) or switches it between individual and company',
  }),
  listAddresses: endpoint({
    method: 'GET',
    path: '/customer/addresses',
    auth: 'user',
    response: z.object({ items: z.array(SavedAddressSchema) }),
  }),
  createAddress: endpoint({
    method: 'POST',
    path: '/customer/addresses',
    auth: 'user',
    body: SaveAddressBodySchema,
    response: SavedAddressSchema,
  }),
  updateAddress: endpoint({
    method: 'PATCH',
    path: '/customer/addresses/:id',
    auth: 'user',
    params: IdParams,
    body: SaveAddressBodySchema.partial(),
    response: SavedAddressSchema,
  }),
  deleteAddress: endpoint({
    method: 'DELETE',
    path: '/customer/addresses/:id',
    auth: 'user',
    params: IdParams,
    response: Ok,
  }),
};
