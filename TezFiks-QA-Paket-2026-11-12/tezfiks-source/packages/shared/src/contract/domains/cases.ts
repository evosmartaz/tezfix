import { z } from 'zod';
import { endpoint } from '../define';
import { FileRefSchema, Id, IsoDateTime, PageQuery, paginated } from '../common';
import { CaseStatus, CaseType } from '../../enums';

export const CaseViewSchema = z.object({
  id: Id,
  type: CaseType.schema,
  status: CaseStatus.schema,
  assignmentId: Id.nullable(),
  projectId: Id.nullable(),
  requestNumber: z.int().nullable(),
  projectNumber: z.int().nullable(),
  description: z.string(),
  photos: z.array(FileRefSchema),
  resolutionNote: z.string().nullable(),
  followUpRequestId: Id.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CaseView = z.infer<typeof CaseViewSchema>;

export const GuaranteeClaimBodySchema = z.object({
  description: z.string().trim().min(5).max(2000),
  photoFileIds: z.array(Id).max(5).default([]),
});

export const casesEndpoints = {
  list: endpoint({
    method: 'GET',
    path: '/cases',
    auth: 'user',
    query: PageQuery,
    response: paginated(CaseViewSchema),
    summary: 'Guarantee claims and price disputes opened by the caller',
  }),
};
