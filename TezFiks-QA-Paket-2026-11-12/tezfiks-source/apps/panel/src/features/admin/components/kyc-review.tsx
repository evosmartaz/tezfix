import { useTranslations } from 'next-intl';
import { DateTime } from '@/components/date-time';
import { StatusBadge } from '@/components/status-badge';
import { jsonPreview, kycImages, type KycImage } from '../mappers';
import type { AdminKycView } from '../types';
import { InfoList } from './ui';

function KycTile({ image }: { image: KycImage }) {
  const t = useTranslations('panel.admin.kyc.files');
  const label = image.key === 'tradeProof' || image.key === 'companyDoc' ? `${t(image.key)} ${image.index}` : t(image.key);
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <a
        href={image.file.url}
        target="_blank"
        rel="noreferrer"
        className="block aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted"
        data-kyc={image.key}
      >
        {image.isPdf ? (
          <span className="flex h-full items-center justify-center text-sm font-semibold text-muted-foreground">PDF</span>
        ) : (
          <img src={image.file.url} alt={label} className="h-full w-full object-contain" loading="lazy" />
        )}
      </a>
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/**
 * Side-by-side KYC review: ID front/back, the three guided selfies, trade proofs / company documents. The image URLs are
 * the short-lived signed admin URLs returned by the API (reload the page to renew them).
 */
export function KycReview({ kyc }: { kyc: AdminKycView | null }) {
  const t = useTranslations('panel.admin.kyc');
  if (!kyc) return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  const images = kycImages(kyc.files);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusBadge family="verificationStatus" status={kyc.status} />
        <span className="text-muted-foreground">
          {t('submittedAt')}: <DateTime value={kyc.submittedAt} />
        </span>
        {kyc.reviewedAt ? (
          <span className="text-muted-foreground">
            {t('reviewedBy', { name: kyc.reviewerName ?? '—' })} · <DateTime value={kyc.reviewedAt} />
          </span>
        ) : null}
      </div>
      {kyc.rejectReason ? (
        <p className="rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
          {t('rejectReason')}: {kyc.rejectReason}
        </p>
      ) : null}
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('idDocument')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {images.id.map((img) => (
            <KycTile key={img.key} image={img} />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('selfies')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {images.selfies.map((img) => (
            <KycTile key={img.key} image={img} />
          ))}
        </div>
      </div>
      {images.other.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('otherDocuments')}</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {images.other.map((img) => (
              <KycTile key={`${img.key}-${img.index}`} image={img} />
            ))}
          </div>
        </div>
      ) : null}
      <InfoList
        items={[
          {
            label: t('consent'),
            value: t('consentValue', { version: kyc.consent.policyVersion, locale: kyc.consent.locale }),
          },
          { label: t('consentAt'), value: <DateTime value={kyc.consent.acceptedAt} /> },
          { label: t('docNumberLast4'), value: kyc.extracted?.docNumberLast4 ?? '—' },
          { label: t('birthDate'), value: kyc.extracted?.birthDate ?? '—' },
          { label: t('expiry'), value: kyc.extracted?.expiry ?? '—' },
          {
            label: t('selfieChecks'),
            value:
              kyc.selfieChecks === null || kyc.selfieChecks === undefined ? (
                t('noSelfieChecks')
              ) : (
                <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{jsonPreview(kyc.selfieChecks)}</pre>
              ),
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">{t('urlNote')}</p>
    </div>
  );
}
