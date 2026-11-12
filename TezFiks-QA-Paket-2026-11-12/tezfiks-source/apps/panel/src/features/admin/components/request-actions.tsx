'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Ban } from 'lucide-react';
import { moneyText } from '@/lib/format';
import { cancelRequestAction } from '../actions';
import { ReasonButton } from './action-buttons';

/** Admin force-cancel of a request (all active assignments), optionally charging the customer penalty. */
export function RequestCancelButton({ requestId, penaltyPreview }: { requestId: string; penaltyPreview: number }) {
  const t = useTranslations('panel.admin.orders.cancel');
  const locale = useLocale();
  const [charge, setCharge] = useState(false);
  return (
    <ReasonButton
      label={t('button')}
      title={t('title')}
      description={t('description')}
      successMessage={t('success')}
      variant="destructive"
      icon={<Ban />}
      action={(reason) => cancelRequestAction(requestId, { reason, chargeCustomer: charge })}
      extra={
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--color-danger)]"
            checked={charge}
            onChange={(e) => setCharge(e.target.checked)}
          />
          <span>
            {t('chargeCustomer')}
            <span className="block text-xs text-muted-foreground">
              {t('chargeHint', { amount: moneyText(penaltyPreview, locale) })}
            </span>
          </span>
        </label>
      }
    />
  );
}
