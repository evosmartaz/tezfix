import type { ProjectStatus } from '@tezfiks/shared';
import type { Tx } from '../../infra/prisma.service';
import { ApiException } from '../../common/http/api-exception';

/**
 * Lock order of every B2B transaction: the acting user's row (lockActiveUser, FOR SHARE), then the project row (FOR UPDATE), then
 * quote / invoice rows, then ledger accounts (all of them at once, sorted by id). Accept, withdraw, cancel, submit and the timers
 * all take the project row first, so they run one after the other and exactly one of them wins.
 */
export async function lockProjectRow(tx: Tx, projectId: string): Promise<{ id: string; status: ProjectStatus }> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string; status: ProjectStatus }>>(
    `SELECT id::text AS id, status::text AS status FROM projects WHERE id = $1::uuid FOR UPDATE`,
    projectId,
  );
  const row = rows[0];
  if (!row) throw new ApiException('NOT_FOUND', { entity: 'project', id: projectId });
  return row;
}

/**
 * Locks several ledger accounts in id order before a sequence of ledger calls (capture + releases), so two transactions touching
 * the same provider wallets in a different order cannot deadlock. The ledger's own per-call locks are then re-entrant no-ops.
 */
export async function lockLedgerAccounts(tx: Tx, accountIds: Array<string | null | undefined>): Promise<void> {
  const ids = [...new Set(accountIds.filter((v): v is string => !!v))].sort();
  if (!ids.length) return;
  await tx.$queryRawUnsafe(`SELECT id FROM ledger_accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, ids);
}
