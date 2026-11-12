'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronRight, Pencil, Plus, Power } from 'lucide-react';
import type { Category } from '@tezfiks/shared';
import { FormError, FormField, TextField } from '@/components/form-field';
import { toast } from '@/components/toaster';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createCategoryAction, updateCategoryAction } from '../actions';
import { buildCategoryTree, categoryBody, categoryToForm, parentOptions, type CategoryForm, type CategoryNode } from '../mappers';
import { Select } from './ui';

/** Form schema with translated messages (the body is validated again with the contract schema by the action). */
export function categoryFormSchema(t: (key: string) => string) {
  const name = z.string().trim().min(1, t('validation.required')).max(80, t('validation.tooLong'));
  return z.object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{2,60}$/, t('validation.slug')),
    parentId: z.string(),
    vertical: z.enum(['HOME', 'AUTO']),
    kind: z.enum(['GROUP', 'SERVICE']),
    nameAz: name,
    nameRu: name,
    nameEn: name,
    icon: z.string().trim().max(60, t('validation.tooLong')),
    featured: z.boolean(),
    flow: z.enum(['INSTANT', 'QUOTE']),
    emergencyAllowed: z.boolean(),
    sortOrder: z.string().trim().regex(/^-?\d{1,6}$/, t('validation.integer')),
    active: z.boolean(),
    keywords: z.string().max(3000, t('validation.tooLong')),
  });
}

function CategoryDialog({
  open,
  onOpenChange,
  editing,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Category | null;
  items: Category[];
}) {
  const t = useTranslations('panel.admin.categories');
  const tc = useTranslations('common');
  const router = useRouter();
  const schema = useMemo(() => categoryFormSchema((k) => t(k)), [t]);
  const form = useForm<CategoryForm>({ resolver: zodResolver(schema) as never, defaultValues: categoryToForm(editing) });
  const [error, setError] = useState<string | null>(null);
  const vertical = form.watch('vertical');
  const kind = form.watch('kind');
  const parents = parentOptions(items, vertical, editing?.id);

  async function submit(values: CategoryForm) {
    setError(null);
    const body = categoryBody(values);
    const r = editing ? await updateCategoryAction(editing.id, body) : await createCategoryAction(body);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    toast.success(editing ? t('updated') : t('created'));
    onOpenChange(false);
    router.refresh();
  }

  const checkbox = (name: 'featured' | 'emergencyAllowed' | 'active', label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-[var(--color-primary)]" {...form.register(name)} />
      {label}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !form.formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="w-[40rem]" closeLabel={t('close')}>
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto pr-1" noValidate>
            <DialogHeader>
              <DialogTitle>{editing ? t('editTitle', { name: editing.name }) : t('newTitle')}</DialogTitle>
            </DialogHeader>
            <FormError message={error} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField<CategoryForm> name="slug" label={t('fields.slug')} hint={t('fields.slugHint')} />
              <TextField<CategoryForm> name="icon" label={t('fields.icon')} hint={t('fields.iconHint')} />
              <FormField label={t('fields.vertical')} htmlFor="cat-vertical">
                <Select id="cat-vertical" {...form.register('vertical')}>
                  <option value="HOME">{tc('vertical.HOME')}</option>
                  <option value="AUTO">{tc('vertical.AUTO')}</option>
                </Select>
              </FormField>
              <FormField label={t('fields.kind')} htmlFor="cat-kind">
                <Select id="cat-kind" {...form.register('kind')}>
                  <option value="GROUP">{t('kind.GROUP')}</option>
                  <option value="SERVICE">{t('kind.SERVICE')}</option>
                </Select>
              </FormField>
              <FormField label={t('fields.parent')} htmlFor="cat-parent">
                <Select id="cat-parent" {...form.register('parentId')}>
                  <option value="">{t('noParent')}</option>
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {kind === 'SERVICE' ? (
                <FormField label={t('fields.flow')} htmlFor="cat-flow">
                  <Select id="cat-flow" {...form.register('flow')}>
                    <option value="INSTANT">{t('flow.INSTANT')}</option>
                    <option value="QUOTE">{t('flow.QUOTE')}</option>
                  </Select>
                </FormField>
              ) : null}
              <TextField<CategoryForm> name="nameAz" label={t('fields.nameAz')} />
              <TextField<CategoryForm> name="nameRu" label={t('fields.nameRu')} />
              <TextField<CategoryForm> name="nameEn" label={t('fields.nameEn')} />
              <TextField<CategoryForm> name="sortOrder" label={t('fields.sortOrder')} inputMode="numeric" />
            </div>
            <TextField<CategoryForm> name="keywords" label={t('fields.keywords')} hint={t('fields.keywordsHint')} multiline />
            <div className="flex flex-wrap gap-4">
              {checkbox('active', t('fields.active'))}
              {checkbox('featured', t('fields.featured'))}
              {kind === 'SERVICE' ? checkbox('emergencyAllowed', t('fields.emergencyAllowed')) : null}
            </div>
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

function CategoryRow({
  node,
  depth,
  onEdit,
  onToggle,
  busyId,
}: {
  node: CategoryNode;
  depth: number;
  onEdit: (c: Category) => void;
  onToggle: (c: Category) => void;
  busyId: string | null;
}) {
  const t = useTranslations('panel.admin.categories');
  const tc = useTranslations('common');
  const c = node.category;
  return (
    <>
      <li
        className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 last:border-0"
        style={{ paddingLeft: `${1 + depth * 1.5}rem` }}
        data-category={c.slug}
      >
        <div className="flex min-w-0 items-center gap-2">
          {node.children.length ? <ChevronRight className="size-4 text-muted-foreground" /> : <span className="w-4" />}
          <span className={c.active ? 'font-medium' : 'font-medium text-muted-foreground line-through'}>{c.name}</span>
          <span className="text-xs text-muted-foreground">{c.slug}</span>
          <Badge className="bg-muted text-muted-foreground ring-border">{tc(`vertical.${c.vertical}`)}</Badge>
          <Badge className="bg-muted text-muted-foreground ring-border">{t(`kind.${c.kind}`)}</Badge>
          {c.kind === 'SERVICE' ? <Badge className="bg-info/10 text-info ring-info/25">{t(`flow.${c.flow}`)}</Badge> : null}
          {c.featured ? <Badge className="bg-primary/10 text-primary-strong ring-primary/25">{t('featured')}</Badge> : null}
          {c.emergencyAllowed ? <Badge className="bg-danger/10 text-danger ring-danger/25">{t('emergency')}</Badge> : null}
          {!c.active ? <Badge className="bg-muted text-muted-foreground ring-border">{t('inactive')}</Badge> : null}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => onEdit(c)}>
            <Pencil />
            {t('edit')}
          </Button>
          <Button size="sm" variant="outline" loading={busyId === c.id} onClick={() => onToggle(c)}>
            <Power />
            {c.active ? t('deactivate') : t('activate')}
          </Button>
        </div>
      </li>
      {node.children.map((child) => (
        <CategoryRow key={child.category.id} node={child} depth={depth + 1} onEdit={onEdit} onToggle={onToggle} busyId={busyId} />
      ))}
    </>
  );
}

/** Kateqoriyalar: tree of groups and services, create / edit dialog, activate / deactivate. */
export function CategoryManager({ items }: { items: Category[] }) {
  const t = useTranslations('panel.admin.categories');
  const router = useRouter();
  const tree = useMemo(() => buildCategoryTree(items), [items]);
  const [dialog, setDialog] = useState<{ open: boolean; editing: Category | null; key: number }>({ open: false, editing: null, key: 0 });
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(c: Category) {
    setBusyId(c.id);
    try {
      const r = await updateCategoryAction(c.id, { active: !c.active });
      if (r.ok) {
        toast.success(r.data.active ? t('activated') : t('deactivated'));
        router.refresh();
      } else toast.error(r.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setDialog((d) => ({ open: true, editing: null, key: d.key + 1 }))}>
          <Plus />
          {t('new')}
        </Button>
      </div>
      <ul className="rounded-lg border border-border bg-surface">
        {tree.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground">{t('empty')}</li> : null}
        {tree.map((node) => (
          <CategoryRow
            key={node.category.id}
            node={node}
            depth={0}
            busyId={busyId}
            onEdit={(c) => setDialog((d) => ({ open: true, editing: c, key: d.key + 1 }))}
            onToggle={toggle}
          />
        ))}
      </ul>
      <CategoryDialog
        key={dialog.key}
        open={dialog.open}
        editing={dialog.editing}
        items={items}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}
