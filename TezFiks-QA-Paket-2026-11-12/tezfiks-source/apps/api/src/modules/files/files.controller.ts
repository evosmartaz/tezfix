import { Controller, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { api, UploadFileFieldsSchema } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { ApiException } from '../../common/http/api-exception';
import { formatIssues } from '../../common/http/contract.interceptor';
import { FilesService, MAX_UPLOAD_BYTES } from './files.service';

@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Route(api.files.upload)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } }))
  async upload(
    @CurrentUser() user: UserPrincipal,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: { body?: unknown },
  ) {
    const fields = UploadFileFieldsSchema.safeParse(req.body ?? {});
    if (!fields.success) throw new ApiException('VALIDATION_FAILED', { in: 'body', issues: formatIssues(fields.error.issues) });
    if (!file) throw new ApiException('VALIDATION_FAILED', { in: 'body', issues: [{ path: 'file', message: 'File is required', code: 'required' }] });
    return this.files.upload(user.userId, fields.data.kind, { buffer: file.buffer, mimetype: file.mimetype, size: file.size });
  }

  @Route(api.files.download)
  async download(@Input() input: RouteInput<typeof api.files.download>, @Res() res: Response): Promise<void> {
    const out = await this.files.download(input.params.id, input.query.exp, input.query.sig);
    res.status(200);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Length', String(out.buffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', out.cacheControl);
    res.end(out.buffer);
  }
}
