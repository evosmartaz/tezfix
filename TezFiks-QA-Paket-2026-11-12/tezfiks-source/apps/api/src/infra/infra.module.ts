import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { Clock } from './clock';
import { JobsService } from './jobs.service';
import { ReconcilerService } from './reconciler.service';
import { DomainEvents } from './events';
import { RateLimiter } from './rate-limiter';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  providers: [PrismaService, RedisService, Clock, JobsService, ReconcilerService, DomainEvents, RateLimiter, RealtimeService],
  exports: [PrismaService, RedisService, Clock, JobsService, ReconcilerService, DomainEvents, RateLimiter, RealtimeService],
})
export class InfraModule {}
