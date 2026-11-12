import { z } from 'zod';
import { endpoint } from '../define';
import { FileRefSchema, Id } from '../common';
import { FileKind } from '../../enums';

export const UploadFileFieldsSchema = z.object({ kind: FileKind.schema });

export const filesEndpoints = {
  upload: endpoint({
    method: 'POST',
    path: '/files',
    auth: 'user',
    multipart: true,
    body: UploadFileFieldsSchema,
    response: FileRefSchema,
    summary: 'multipart/form-data with fields "kind" and "file" (JPEG/PNG/WebP/HEIC, max 8 MB). Images are re-encoded and EXIF is stripped.',
  }),
  download: endpoint({
    method: 'GET',
    path: '/files/:id',
    auth: 'none',
    params: z.object({ id: Id }),
    query: z.object({ exp: z.string(), sig: z.string() }),
    response: z.unknown(),
    raw: 'binary',
    summary: 'Signed download URL (FileRef.url). KYC files are only signed for admins and every view is logged.',
  }),
};
