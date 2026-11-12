/**
 * Provisions the dedicated QA admin account on a DEMO environment (QA blocker 2.1, `qa/admin-pending.md`).
 *
 *   QA_ADMIN_EMAIL=qa-admin@tezfiks.az npm run seed:qa-admin
 *
 * - Reuses the existing admin model and scrypt hashing; the QA admin logs in through the normal POST /auth/admin/login.
 * - Role ADMIN: the pending QA tests include settings changes (AU-L04), which require ADMIN (OPERATOR gets FORBIDDEN).
 * - Refuses to run unless DEMO_MODE=true, and only for an e-mail that contains "qa", so it cannot be pointed at a
 *   production database or at a real admin by mistake.
 * - Idempotent: if the account exists nothing is changed (unless --rotate-password); other admins are never touched.
 * - Password: QA_ADMIN_PASSWORD if set, otherwise a random one written to QA_ADMIN_PASSWORD_FILE
 *   (default ~/.tezfiks-qa-admin-password, mode 600, never overwritten). The password is never printed or logged.
 * - Every change is written to the audit log (actor SYSTEM).
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { hashPassword } from '../../src/common/auth/password';

export const QA_ADMIN_NAME = 'QA Admin';
export const QA_ADMIN_SOURCE = 'qa-admin-provisioning';
/** Same minimum as the admin contract (POST /admin/admins). */
export const MIN_PASSWORD_LENGTH = 10;

export type QaAdminResult =
  | { status: 'created'; id: string }
  | { status: 'unchanged'; id: string }
  | { status: 'password-rotated'; id: string };

export interface QaAdminOptions {
  email: string;
  password: string;
  demoMode: boolean;
  rotatePassword?: boolean;
  name?: string;
}

export class QaAdminError extends Error {}

export function validateQaAdminOptions(o: Pick<QaAdminOptions, 'email' | 'password' | 'demoMode'>): string {
  if (!o.demoMode) throw new QaAdminError('Refusing to provision: DEMO_MODE is not true (QA admins are for the demo environment only).');
  const email = o.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new QaAdminError('QA_ADMIN_EMAIL is not a valid e-mail address.');
  if (!email.split('@')[0]!.includes('qa')) throw new QaAdminError('QA_ADMIN_EMAIL must be a QA-specific address (its local part must contain "qa").');
  if (o.password.length < MIN_PASSWORD_LENGTH) throw new QaAdminError(`The QA admin password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  return email;
}

export function generatePassword(): string {
  return randomBytes(18).toString('base64url'); // 24 characters, 144 bits
}

export async function provisionQaAdmin(prisma: PrismaClient, o: QaAdminOptions): Promise<QaAdminResult> {
  const email = validateQaAdminOptions(o);
  const name = o.name ?? QA_ADMIN_NAME;
  const passwordHash = await hashPassword(o.password);
  return prisma.$transaction(async (tx) => {
    // Serializes concurrent runs; the unique e-mail index is the second line of defence against duplicates.
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('tezfiks:qa-admin-provisioning'))`);
    const existing = await tx.adminUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!existing) {
      const a = await tx.adminUser.create({ data: { email, name, passwordHash, role: 'ADMIN', active: true } });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'admin.create',
          entityType: 'AdminUser',
          entityId: a.id,
          after: { email: a.email, name: a.name, role: a.role, active: a.active, source: QA_ADMIN_SOURCE },
        },
      });
      return { status: 'created', id: a.id };
    }
    if (!o.rotatePassword) return { status: 'unchanged', id: existing.id };
    await tx.adminUser.update({ where: { id: existing.id }, data: { passwordHash } });
    // Same as an admin password change in the panel: the account's other sessions end.
    await tx.session.updateMany({
      where: { adminId: existing.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'ADMIN_UPDATED' },
    });
    await tx.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        action: 'admin.update',
        entityType: 'AdminUser',
        entityId: existing.id,
        before: { name: existing.name, role: existing.role, active: existing.active },
        after: { name: existing.name, role: existing.role, active: existing.active, passwordChanged: true, source: QA_ADMIN_SOURCE },
      },
    });
    return { status: 'password-rotated', id: existing.id };
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new QaAdminError('DATABASE_URL is not set');
  const email = process.env.QA_ADMIN_EMAIL ?? '';
  const rotatePassword = process.argv.includes('--rotate-password');
  const supplied = process.env.QA_ADMIN_PASSWORD;
  const password = supplied ?? generatePassword();
  const demoMode = process.env.DEMO_MODE === 'true';
  validateQaAdminOptions({ email, password, demoMode });

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const exists = await prisma.adminUser.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } }, select: { id: true } });
    const willSetPassword = !exists || rotatePassword;
    let passwordFile: string | null = null;
    if (willSetPassword && supplied === undefined) {
      // Write the generated password first (exclusive create, mode 600) so it can never be lost after the DB change.
      passwordFile = process.env.QA_ADMIN_PASSWORD_FILE ?? join(homedir(), '.tezfiks-qa-admin-password');
      try {
        writeFileSync(passwordFile, `${password}\n`, { flag: 'wx', mode: 0o600 });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new QaAdminError(`${passwordFile} already exists; move it away (or set QA_ADMIN_PASSWORD_FILE) before generating a new password.`);
        }
        throw err;
      }
    }
    let result: QaAdminResult;
    try {
      result = await provisionQaAdmin(prisma, { email, password, demoMode, rotatePassword });
    } catch (err) {
      if (passwordFile) rmSync(passwordFile, { force: true }); // the password was never set: do not leave it behind
      throw err;
    }
    if (passwordFile && result.status === 'unchanged') rmSync(passwordFile, { force: true }); // created concurrently by another run
    const where = passwordFile ? ` Password written to ${passwordFile} (mode 600); hand it to QA over a secure channel, then delete the file.` : '';
    const msg = {
      created: `QA admin created (role ADMIN, id ${result.id}).${where}`,
      unchanged: `QA admin already exists (id ${result.id}); nothing changed. Use --rotate-password to set a new password.`,
      'password-rotated': `QA admin password rotated (id ${result.id}); its other sessions were ended.${where}`,
    }[result.status];
    // eslint-disable-next-line no-console
    console.log(msg);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof QaAdminError ? `qa-admin: ${err.message}` : err);
    process.exit(1);
  });
}
