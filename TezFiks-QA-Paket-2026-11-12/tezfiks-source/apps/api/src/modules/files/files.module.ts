import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage.driver';
import { LocalStorageDriver } from './storage/local.driver';
import { S3StorageDriver } from './storage/s3.driver';

export function createStorageDriver(env: Env): StorageDriver {
  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_BUCKET) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
    return new S3StorageDriver({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  return new LocalStorageDriver(env.STORAGE_LOCAL_DIR);
}

/** Lane A1: storage driver, uploads (sharp re-encode), signed URLs, KYC access logging, purge job. */
@Module({
  controllers: [FilesController],
  providers: [FilesService, { provide: STORAGE_DRIVER, inject: [ENV], useFactory: createStorageDriver }],
  exports: [FilesService, STORAGE_DRIVER],
})
export class FilesModule {}
