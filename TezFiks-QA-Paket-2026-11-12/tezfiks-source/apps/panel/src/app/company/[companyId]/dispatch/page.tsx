import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { DispatchBoard } from '@/features/company/components/dispatch-board';
import { optional, section } from '@/features/company/server';
import { requireManager } from '@/lib/session/server';

/**
 * Dispatch board: incoming offers with countdowns and the worker picker, active jobs grouped by status, live worker map.
 * The first render comes from the server; the board then follows the socket (offer:new, offer:closed, assignment:updated,
 * company:workers, wallet:updated) with polling as a safety net.
 */
export default async function CompanyDispatchPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireManager(companyId);
  const { locale } = ctx;
  const p = { params: { companyId } };
  const [offers, assignments, workers, wallet, company] = await Promise.all([
    section(ctx.api.call(api.company.offers, p), locale),
    section(ctx.api.call(api.company.assignments, { ...p, query: { scope: 'active', limit: 100 } }), locale),
    section(ctx.api.call(api.company.workersLive, p), locale),
    optional(ctx.api.call(api.company.wallet, p)),
    optional(ctx.api.call(api.company.get, p)),
  ]);
  const t = await getTranslations('panel.company.dispatch');
  return (
    <div>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <DispatchBoard
        companyId={companyId}
        initialOffers={offers.ok ? offers.data : null}
        offersError={offers.ok ? null : offers}
        initialAssignments={assignments.ok ? assignments.data.items : null}
        assignmentsError={assignments.ok ? null : assignments}
        initialWorkers={workers.ok ? workers.data.items : null}
        workersError={workers.ok ? null : workers}
        wallet={wallet ?? company?.wallet ?? null}
        center={company?.base ?? null}
      />
    </div>
  );
}
