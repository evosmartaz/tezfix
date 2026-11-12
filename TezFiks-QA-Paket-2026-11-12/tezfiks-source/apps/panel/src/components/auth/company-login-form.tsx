'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { formatPhone, formatPhoneAsYouType, normalizeAzMobile } from '@tezfiks/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/form-field';
import { companyOtpRequestAction, companyOtpVerifyAction, type OtpChallenge } from '@/lib/actions/auth';

function useCountdown(seconds: number, key: string | null): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    if (!key || seconds <= 0) return;
    const started = Date.now();
    const id = setInterval(() => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining === 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [seconds, key]);
  return left;
}

/** Company panel login: phone (+994) -> 6-digit code (app PANEL) -> the managed company. */
export function CompanyLoginForm({ next, notice }: { next?: string; notice?: string }) {
  const t = useTranslations('panel.auth');
  const tc = useTranslations('common');
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [error, setError] = useState<string | undefined>(notice);
  const resendLeft = useCountdown(challenge?.resendAfterSec ?? 0, challenge?.challengeId ?? null);

  function requestCode() {
    setError(undefined);
    if (!normalizeAzMobile(phone)) {
      setError(tc('errors.PHONE_INVALID'));
      return;
    }
    startTransition(async () => {
      const result = await companyOtpRequestAction({ phone });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCode('');
      setChallenge(result.data);
    });
  }

  function verify(value: string) {
    if (!challenge) return;
    if (!/^\d{6}$/.test(value)) {
      setError(t('codeFormat'));
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const result = await companyOtpVerifyAction({ challengeId: challenge.challengeId, code: value, next });
      if (result && !result.ok) setError(result.message);
    });
  }

  if (!challenge) {
    return (
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          requestCode();
        }}
      >
        <FormError message={error} />
        <FormField label={tc('fields.phone')} htmlFor="phone">
          <div className="flex items-stretch gap-2">
            <span className="inline-flex items-center rounded-md border border-input bg-muted px-3 text-sm font-semibold">
              +994
            </span>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder={t('phonePlaceholder')}
              value={phone}
              onChange={(e) => setPhone(formatPhoneAsYouType(e.target.value))}
            />
          </div>
        </FormField>
        <Button type="submit" size="lg" loading={pending} className="w-full">
          {t('sendCode')}
        </Button>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        verify(code);
      }}
    >
      <p className="text-sm text-muted-foreground">
        {t('codeSentTo', { phone: formatPhone(challenge.phone, 'international') })}
      </p>
      {challenge.devCode ? (
        <div className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent-strong">
          {t('devCodeHint', { code: challenge.devCode })}
        </div>
      ) : null}
      <FormError message={error} />
      <FormField label={t('code')} htmlFor="otp">
        <Input
          id="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="text-center text-xl font-semibold tracking-[0.5em]"
          value={code}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
            setCode(digits);
            if (digits.length === 6) verify(digits);
          }}
          autoFocus
        />
      </FormField>
      <Button type="submit" size="lg" loading={pending} className="w-full">
        {t('verify')}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            setChallenge(null);
            setError(undefined);
          }}
        >
          {t('changePhone')}
        </button>
        {resendLeft > 0 ? (
          <span className="text-muted-foreground tabular-nums">{t('resendIn', { seconds: resendLeft })}</span>
        ) : (
          <button
            type="button"
            className="font-semibold text-primary hover:underline"
            onClick={requestCode}
            disabled={pending}
          >
            {t('resend')}
          </button>
        )}
      </div>
    </form>
  );
}
