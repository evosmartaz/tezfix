'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, UserPlus } from 'lucide-react';
import { DateTime } from '@/components/date-time';
import { FormError, FormField, TextField } from '@/components/form-field';
import { toast } from '@/components/toaster';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createAdminAction, updateAdminAction } from '../actions';
import { adminUserPatch } from '../mappers';
import type { AdminUserView } from '../types';
import { Select } from './ui';

export function adminFormSchema(t: (key: string) => string, creating: boolean) {
  const password = z.string().max(200, t('validation.tooLong'));
  return z.object({
    email: creating ? z.email(t('validation.email')).max(200) : z.string(),
    name: z.string().trim().min(2, t('validation.nameLength')).max(100, t('validation.tooLong')),
    role: z.enum(['ADMIN', 'OPERATOR']),
    active: z.boolean(),
    password: creating
      ? password.min(10, t('validation.password'))
      : password.refine((v) => v === '' || v.length >= 10, t('validation.password')),
  });
}

type AdminForm = { email: string; name: string; role: 'ADMIN' | 'OPERATOR'; active: boolean; password: string };

function AdminDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AdminUserView | null;
}) {
  const t = useTranslations('panel.admin.admins');
  const te = useTranslations('panel.admin.enums.adminRole');
  const router = useRouter();
  const schema = useMemo(() => adminFormSchema((k) => t(k), !editing), [t, editing]);
  const form = useForm<AdminForm>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      email: editing?.email ?? '',
      name: editing?.name ?? '',
      role: editing?.role ?? 'OPERATOR',
      active: editing?.active ?? true,
      password: '',
    },
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(values: AdminForm) {
    setError(null);
    let r;
    if (editing) {
      const patch = adminUserPatch(values, editing);
      if (Object.keys(patch).length === 0) {
        onOpenChange(false);
        return;
      }
      r = await updateAdminAction(editing.id, patch);
    } else {
      r = await createAdminAction({ email: values.email.trim(), name: values.name.trim(), password: values.password, role: values.role });
    }
    if (!r.ok) {
      setError(r.message);
      return;
    }
    toast.success(editing ? t('updated') : t('created'));
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !form.formState.isSubmitting && onOpenChange(o)}>
      <DialogContent closeLabel={t('close')}>
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{editing ? t('editTitle', { email: editing.email }) : t('newTitle')}</DialogTitle>
            </DialogHeader>
            <FormError message={error} />
            {!editing ? <TextField<AdminForm> name="email" type="email" label={t('fields.email')} autoComplete="off" /> : null}
            <TextField<AdminForm> name="name" label={t('fields.name')} />
            <FormField label={t('fields.role')} htmlFor="admin-role">
              <Select id="admin-role" {...form.register('role')}>
                <option value="OPERATOR">{te('OPERATOR')}</option>
                <option value="ADMIN">{te('ADMIN')}</option>
              </Select>
            </FormField>
            <TextField<AdminForm>
              name="password"
              type="password"
              autoComplete="new-password"
              label={editing ? t('fields.newPassword') : t('fields.password')}
              hint={editing ? t('fields.newPasswordHint') : t('fields.passwordHint')}
            />
            {editing ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--color-primary)]" {...form.register('active')} />
                {t('fields.active')}
              </label>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
                {t('cancel')}
              </Button>
              <Button type="submit" loading={form.formState.isSubmitting}>
                {t('save')}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

/** Admin users (ADMIN manages them; OPERATOR sees the list only). */
export function AdminsManager({ admins, currentAdminId, canManage }: { admins: AdminUserView[]; currentAdminId: string; canManage: boolean }) {
  const t = useTranslations('panel.admin.admins');
  const te = useTranslations('panel.admin.enums.adminRole');
  const [dialog, setDialog] = useState<{ open: boolean; editing: AdminUserView | null; key: number }>({ open: false, editing: null, key: 0 });
  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <div>
          <Button size="sm" onClick={() => setDialog((d) => ({ open: true, editing: null, key: d.key + 1 }))}>
            <UserPlus />
            {t('new')}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('operatorNote')}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t('fields.name')}</TableHead>
            <TableHead>{t('fields.role')}</TableHead>
            <TableHead>{t('fields.status')}</TableHead>
            <TableHead>{t('fields.lastLogin')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {admins.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <div className="font-medium">
                  {a.name}
                  {a.id === currentAdminId ? <span className="ml-1 text-xs text-muted-foreground">({t('you')})</span> : null}
                </div>
                <div className="text-xs text-muted-foreground">{a.email}</div>
              </TableCell>
              <TableCell>{te(a.role)}</TableCell>
              <TableCell>
                <Badge className={a.active ? 'bg-primary/10 text-primary-strong ring-primary/25' : 'bg-muted text-muted-foreground ring-border'}>
                  {a.active ? t('active') : t('inactive')}
                </Badge>
              </TableCell>
              <TableCell>
                <DateTime value={a.lastLoginAt} />
              </TableCell>
              <TableCell className="text-right">
                {canManage ? (
                  <Button size="sm" variant="ghost" onClick={() => setDialog((d) => ({ open: true, editing: a, key: d.key + 1 }))}>
                    <Pencil />
                    {t('edit')}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <AdminDialog key={dialog.key} open={dialog.open} editing={dialog.editing} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </div>
  );
}
