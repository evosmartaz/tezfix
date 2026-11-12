'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormError, TextField } from '@/components/form-field';
import { adminLoginAction } from '@/lib/actions/auth';

export function AdminLoginForm({ next, notice }: { next?: string; notice?: string }) {
  const t = useTranslations('panel.auth');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(notice);

  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .min(1, t('required'))
          .pipe(z.email(t('invalidEmail'))),
        password: z.string().min(1, t('required')).max(200),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const onSubmit = form.handleSubmit((values) => {
    setError(undefined);
    startTransition(async () => {
      const result = await adminLoginAction({ ...values, next });
      if (result && !result.ok) setError(result.message);
    });
  });

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <TextField<Values>
          name="email"
          label={t('email')}
          type="email"
          autoComplete="username"
          inputMode="email"
        />
        <TextField<Values>
          name="password"
          label={t('password')}
          type="password"
          autoComplete="current-password"
        />
        <Button type="submit" size="lg" loading={pending} className="mt-2 w-full">
          {t('signIn')}
        </Button>
      </form>
    </FormProvider>
  );
}
