'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy, Link2, Pencil, Plus, Trash2, UserMinus } from 'lucide-react';
import type { CategoryRef, CompanyRole, InviteView, MemberView } from '@tezfiks/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateTime } from '@/components/date-time';
import { FormError, FormField } from '@/components/form-field';
import { EmptyState } from '@/components/states';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Rating, Select } from '@/features/admin/components/ui';
import { cn } from '@/lib/utils';
import { createInviteAction, removeMemberAction, revokeInviteAction, updateMemberAction } from '../actions';
import {
  DEFAULT_INVITE_FORM,
  canEditMember,
  inviteActive,
  inviteBody,
  memberTradesBody,
  personName,
  type InviteForm,
} from '../mappers';
import { Avatar, WorkerPill } from './ui';

// --------------------------------------------------------------------------------------------- members ---

/** Ustalar: members with phones (the company employs them), roles, trades, presence; role change, trades, remove. */
export function MembersTable({
  companyId,
  members,
  myUserId,
  companyTrades,
}: {
  companyId: string;
  members: MemberView[];
  myUserId: string;
  companyTrades: CategoryRef[];
}) {
  const t = useTranslations('panel.company.workers.members');
  const tc = useTranslations('common');
  const active = members.filter((m) => m.status === 'ACTIVE');
  if (active.length === 0) return <EmptyState title={t('empty')} />;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{t('columns.name')}</TableHead>
          <TableHead>{t('columns.role')}</TableHead>
          <TableHead>{t('columns.trades')}</TableHead>
          <TableHead>{t('columns.state')}</TableHead>
          <TableHead>{t('columns.rating')}</TableHead>
          <TableHead>{t('columns.completed')}</TableHead>
          <TableHead>{t('columns.joinedAt')}</TableHead>
          <TableHead className="text-right">{t('columns.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {active.map((m) => {
          const editable = canEditMember(m, myUserId);
          const name = personName(m);
          return (
            <TableRow key={m.userId} data-member-id={m.userId}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar name={name} photo={m.photo} size="sm" />
                  <div>
                    <div className="font-medium">
                      {name}
                      {m.userId === myUserId ? <span className="ml-1 text-xs text-muted-foreground">({t('you')})</span> : null}
                    </div>
                    <a href={`tel:${m.phone}`} className="text-xs text-muted-foreground hover:underline">
                      {m.phone}
                    </a>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                {editable ? (
                  <RoleSelect companyId={companyId} member={m} />
                ) : (
                  tc(`companyRole.${m.role}`)
                )}
              </TableCell>
              <TableCell>
                <div className="flex max-w-64 flex-wrap items-center gap-1">
                  {m.trades.length ? m.trades.map((tr) => tr.name).join(', ') : <span className="text-muted-foreground">—</span>}
                  {m.handymanId && editable ? (
                    <TradesDialog companyId={companyId} member={m} companyTrades={companyTrades} />
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                {m.handymanId ? <WorkerPill state={m.busy ? 'busy' : m.isOnline ? 'free' : 'offline'} /> : '—'}
              </TableCell>
              <TableCell>
                <Rating value={m.ratingAvg} />
              </TableCell>
              <TableCell>{m.completedCount}</TableCell>
              <TableCell>
                <DateTime value={m.joinedAt} mode="date" />
              </TableCell>
              <TableCell className="text-right">
                {editable ? <RemoveMemberButton companyId={companyId} member={m} /> : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function RoleSelect({ companyId, member }: { companyId: string; member: MemberView }) {
  const t = useTranslations('panel.company.workers.members');
  const tc = useTranslations('common');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // UX-W03: a manager gets the company balance, payments and order intake, so promoting asks first.
  const [confirmPromote, setConfirmPromote] = useState(false);
  async function change(role: CompanyRole): Promise<boolean> {
    if (role === member.role) return true;
    setBusy(true);
    try {
      const r = await updateMemberAction(companyId, member.userId, { role });
      if (r.ok) {
        toast.success(t('roleChanged'));
        router.refresh();
        return true;
      }
      toast.error(r.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Select
        aria-label={t('columns.role')}
        className="h-8 w-36 text-xs"
        value={member.role}
        disabled={busy}
        onChange={(e) => {
          const role = e.target.value as CompanyRole;
          if (role === 'MANAGER' && member.role !== 'MANAGER') setConfirmPromote(true);
          else void change(role);
        }}
      >
        <option value="WORKER">{tc('companyRole.WORKER')}</option>
        <option value="MANAGER">{tc('companyRole.MANAGER')}</option>
      </Select>
      <ConfirmDialog
        open={confirmPromote}
        onOpenChange={setConfirmPromote}
        title={t('promoteTitle', { name: `${member.firstName} ${member.lastName}`.trim() })}
        description={t('promoteDescription')}
        confirmLabel={t('promoteConfirm')}
        onConfirm={() => change('MANAGER')}
      />
    </>
  );
}

function TradesDialog({
  companyId,
  member,
  companyTrades,
}: {
  companyId: string;
  member: MemberView;
  companyTrades: CategoryRef[];
}) {
  const t = useTranslations('panel.company.workers.members');
  const tc = useTranslations('common.actions');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function change(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) {
      setPicked(member.trades.map((tr) => tr.id).filter((id) => companyTrades.some((c) => c.id === id)));
      setError(null);
    }
  }

  async function save() {
    const built = memberTradesBody(picked);
    if (!built.ok) {
      setError(t('tradesError'));
      return;
    }
    setBusy(true);
    try {
      const r = await updateMemberAction(companyId, member.userId, built.body);
      if (r.ok) {
        toast.success(t('tradesSaved'));
        setOpen(false);
        router.refresh();
      } else {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button size="icon" variant="ghost" className="size-7" aria-label={t('editTrades')} />}>
        <Pencil />
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <div className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('editTradesTitle', { name: personName(member) })}</DialogTitle>
            <DialogDescription>{t('editTradesHint')}</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="flex flex-col gap-2">
            {companyTrades.map((tr) => (
              <label key={tr.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-primary)]"
                  checked={picked.includes(tr.id)}
                  onChange={(e) =>
                    setPicked((prev) => (e.target.checked ? [...prev, tr.id] : prev.filter((id) => id !== tr.id)))
                  }
                />
                {tr.name}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => change(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={save} loading={busy}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RemoveMemberButton({ companyId, member }: { companyId: string; member: MemberView }) {
  const t = useTranslations('panel.company.workers.members');
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-danger" aria-label={t('remove')}>
          <UserMinus />
          {t('remove')}
        </Button>
      }
      title={t('removeTitle', { name: personName(member) })}
      description={t('removeDescription')}
      confirmLabel={t('remove')}
      destructive
      onConfirm={async () => {
        const r = await removeMemberAction(companyId, member.userId);
        if (r.ok) {
          toast.success(t('removed'));
          router.refresh();
          return true;
        }
        toast.error(r.message);
        return false;
      }}
    />
  );
}

// --------------------------------------------------------------------------------------------- invites ---

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useTranslations('panel.company.workers.invites');
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        if (await copyText(text)) toast.success(t('copied'));
        else toast.error(t('copyFailed'));
      }}
    >
      <Copy />
      {label}
    </Button>
  );
}

/** Invite links: create (role, uses, validity), copy, revoke. */
export function InvitesManager({ companyId, invites, nowMs }: { companyId: string; invites: InviteView[]; nowMs: number }) {
  const t = useTranslations('panel.company.workers.invites');
  const tc = useTranslations('common');
  const router = useRouter();
  const sorted = [...invites].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <CreateInviteDialog companyId={companyId} />
      </div>
      {sorted.length === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyHint')} icon={<Link2 />} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('columns.link')}</TableHead>
              <TableHead>{t('columns.role')}</TableHead>
              <TableHead>{t('columns.uses')}</TableHead>
              <TableHead>{t('columns.expiresAt')}</TableHead>
              <TableHead>{t('columns.state')}</TableHead>
              <TableHead className="text-right">{t('columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((i) => {
              const active = inviteActive(i, nowMs);
              return (
                <TableRow key={i.id} data-invite-id={i.id} className={cn(!active && 'opacity-60')}>
                  <TableCell>
                    <code className="block max-w-72 truncate text-xs" title={i.url}>
                      {i.url}
                    </code>
                  </TableCell>
                  <TableCell>{tc(`companyRole.${i.role}`)}</TableCell>
                  <TableCell className="tabular-nums">{t('uses', { value: i.usedCount, max: i.maxUses })}</TableCell>
                  <TableCell>
                    <DateTime value={i.expiresAt} />
                  </TableCell>
                  <TableCell>
                    <span className={cn('text-xs font-semibold', active ? 'text-primary-strong' : 'text-muted-foreground')}>
                      {i.revokedAt ? t('state.revoked') : active ? t('state.active') : t('state.inactive')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {active ? <CopyButton text={i.url} label={t('copy')} /> : null}
                      {/* UX-W06: only a link that still works can be revoked. */}
                      {active ? (
                        <ConfirmDialog
                          trigger={
                            <Button size="sm" variant="ghost" className="text-danger">
                              <Trash2 />
                              {t('revoke')}
                            </Button>
                          }
                          title={t('revokeTitle')}
                          description={t('revokeDescription')}
                          confirmLabel={t('revoke')}
                          destructive
                          onConfirm={async () => {
                            const r = await revokeInviteAction(companyId, i.id);
                            if (r.ok) {
                              toast.success(t('revoked'));
                              router.refresh();
                              return true;
                            }
                            toast.error(r.message);
                            return false;
                          }}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function CreateInviteDialog({ companyId }: { companyId: string }) {
  const t = useTranslations('panel.company.workers.invites');
  const tc = useTranslations('common');
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<InviteForm>(DEFAULT_INVITE_FORM);
  const [field, setField] = useState<'maxUses' | 'expiresInDays' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InviteView | null>(null);
  const [busy, setBusy] = useState(false);

  function change(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) {
      setForm(DEFAULT_INVITE_FORM);
      setField(null);
      setError(null);
      setCreated(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = inviteBody(form);
    if (!built.ok) {
      setField(built.field);
      return;
    }
    setField(null);
    setError(null);
    setBusy(true);
    try {
      const r = await createInviteAction(companyId, built.body);
      if (r.ok) {
        setCreated(r.data);
        toast.success(t('created'));
        router.refresh();
      } else {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button />}>
        <Plus />
        {t('create')}
      </DialogTrigger>
      <DialogContent closeLabel={tc('actions.close')}>
        {created ? (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('createdTitle')}</DialogTitle>
              <DialogDescription>{t('createdHint')}</DialogDescription>
            </DialogHeader>
            <Input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} aria-label={t('columns.link')} />
            <DialogFooter>
              <CopyButton text={created.url} label={t('copy')} />
              <Button onClick={() => change(false)}>{tc('actions.close')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t('createTitle')}</DialogTitle>
              <DialogDescription>{t('createHint')}</DialogDescription>
            </DialogHeader>
            <FormError message={error} />
            <FormField label={t('role')} htmlFor={`${id}-role`}>
              <Select id={`${id}-role`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as CompanyRole })}>
                <option value="WORKER">{tc('companyRole.WORKER')}</option>
                <option value="MANAGER">{tc('companyRole.MANAGER')}</option>
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t('maxUses')} htmlFor={`${id}-uses`} error={field === 'maxUses' ? t('maxUsesError') : undefined}>
                <Input
                  id={`${id}-uses`}
                  inputMode="numeric"
                  value={form.maxUses}
                  aria-invalid={field === 'maxUses' || undefined}
                  onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                />
              </FormField>
              <FormField
                label={t('expiresInDays')}
                htmlFor={`${id}-days`}
                error={field === 'expiresInDays' ? t('expiresInDaysError') : undefined}
              >
                <Input
                  id={`${id}-days`}
                  inputMode="numeric"
                  value={form.expiresInDays}
                  aria-invalid={field === 'expiresInDays' || undefined}
                  onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}
                />
              </FormField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => change(false)}>
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" loading={busy}>
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

