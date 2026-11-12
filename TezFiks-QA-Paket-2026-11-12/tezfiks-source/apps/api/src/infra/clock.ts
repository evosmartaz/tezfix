import { Injectable } from '@nestjs/common';

/**
 * Single source of "now" for business logic. Tests move time with advance()/set();
 * every deadline is stored in Postgres and compared against clock.now().
 */
@Injectable()
export class Clock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  nowMs(): number {
    return Date.now() + this.offsetMs;
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }

  set(at: Date | string): void {
    this.offsetMs = new Date(at).getTime() - Date.now();
  }

  reset(): void {
    this.offsetMs = 0;
  }
}
