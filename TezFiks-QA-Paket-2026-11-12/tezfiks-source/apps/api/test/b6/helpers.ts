import { expect } from 'vitest';
import { loadEnv, ENV } from '../../src/config/env';
import { createTestApp, type TestApp } from '../helpers/app';
import { DemoSimulatorService, type TickReport } from '../../src/modules/demo/demo-simulator.service';

/** Test app with DEMO_MODE=true (demo timers, demo endpoints and the simulator enabled). */
export async function createDemoApp(): Promise<TestApp> {
  return createTestApp((b) => b.overrideProvider(ENV).useValue({ ...loadEnv(), DEMO_MODE: true }));
}

export function simulator(t: TestApp): DemoSimulatorService {
  return t.app.get(DemoSimulatorService);
}

/** t.reset() drops the manual job list; the running API keeps its tick chain, so tests re-arm it like the reconciler does. */
export async function armSimulator(t: TestApp): Promise<void> {
  await simulator(t).arm();
}

/** Moves the Clock second by second and runs every due job (the simulator ticks once per second). */
export async function runSeconds(t: TestApp, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    t.clock.advance(1000);
    await t.jobs.runDue();
  }
}

/** Runs seconds until `done()` holds (or fails after `max` seconds). Returns the seconds it took. */
export async function runUntil(t: TestApp, done: () => Promise<boolean>, max = 600): Promise<number> {
  for (let i = 0; i < max; i++) {
    if (await done()) return i;
    t.clock.advance(1000);
    await t.jobs.runDue();
  }
  if (await done()) return max;
  throw new Error(`condition not reached within ${max} s`);
}

export async function expectLedgerBalanced(t: TestApp): Promise<void> {
  expect(await t.ledger.globalSum()).toBe(0);
  expect(await t.ledger.verifyIntegrity()).toEqual([]);
}

export type { TickReport };
