'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { hashKey, keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  createColumnHelper,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/states';
import type { ActionResult } from '@/lib/errors';
import { cn } from '@/lib/utils';

/** Table features used by every panel list (core only: sorting/filtering/pagination happen on the server). */
export const dataTableFeatures = tableFeatures({});
export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumn<T extends RowData> = ColumnDef<DataTableFeatures, T, any>;

/** Column helper bound to the panel table features: `const col = dataTableColumns<Order>(); col.accessor('id', {...})`. */
export function dataTableColumns<T extends RowData>() {
  return createColumnHelper<DataTableFeatures, T>();
}

/** API list page shape (`paginated()` in the contract). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type FetchPage<T> = (cursor: string | null) => Promise<CursorPage<T> | ActionResult<CursorPage<T>>>;

export interface DataTableProps<T extends RowData> {
  columns: DataTableColumn<T>[];
  /** Query key of the list including every filter; invalidate it to refetch (e.g. on a socket event). */
  queryKey: readonly unknown[];
  /** Loads one page. Usually a Server Action that calls the API with the session token. */
  fetchPage: FetchPage<T>;
  /** First page rendered on the server (no loading flash). */
  initialPage?: CursorPage<T>;
  getRowId?: (row: T) => string;
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  className?: string;
}

class PageLoadError extends Error {}

function unwrap<T>(result: CursorPage<T> | ActionResult<CursorPage<T>>): CursorPage<T> {
  if ('ok' in result) {
    if (result.ok) return result.data;
    throw new PageLoadError(result.message);
  }
  return result;
}

const EMPTY: never[] = [];

/** Server-paginated list (TanStack Table v9 + TanStack Query) driven by the API's `nextCursor`. */
export function DataTable<T extends RowData>({
  columns,
  queryKey,
  fetchPage,
  initialPage,
  getRowId,
  rowHref,
  onRowClick,
  emptyTitle,
  emptyDescription,
  className,
}: DataTableProps<T>) {
  const t = useTranslations('panel.table');
  const router = useRouter();
  const keyHash = hashKey(queryKey);

  // Pagination belongs to one query key: a filter change (new key) starts again at page 1 without a cursor.
  // cursors[i] is the cursor that loads page i (page 0 has none).
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[]; pageIndex: number }>(() => ({
    key: keyHash,
    cursors: [null],
    pageIndex: 0,
  }));
  if (pager.key !== keyHash) setPager({ key: keyHash, cursors: [null], pageIndex: 0 });
  const current = pager.key === keyHash ? pager : { key: keyHash, cursors: [null], pageIndex: 0 };
  const pageIndex = current.pageIndex;
  const cursor = current.cursors[pageIndex] ?? null;

  // The server-rendered first page only belongs to the key it was rendered for. A new initialPage object
  // (the server rendered again, e.g. with new search params) is bound to the key current at that moment.
  const [seed, setSeed] = useState<{ page: CursorPage<T> | undefined; key: string }>(() => ({
    page: initialPage,
    key: keyHash,
  }));
  if (seed.page !== initialPage) setSeed({ page: initialPage, key: keyHash });
  const seededPage =
    pageIndex === 0 && initialPage && (seed.page !== initialPage || seed.key === keyHash) ? initialPage : undefined;

  const query = useQuery({
    queryKey: [...queryKey, { cursor }],
    queryFn: async () => unwrap(await fetchPage(cursor)),
    placeholderData: keepPreviousData,
    initialData: seededPage,
    // The server just rendered the first page: do not refetch it immediately on mount.
    staleTime: seededPage ? 15_000 : undefined,
  });

  const rows = query.data?.items ?? (EMPTY as T[]);
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: getRowId ? (row: T) => getRowId(row) : undefined,
  });

  const nextCursor = query.data?.nextCursor ?? null;
  const clickable = Boolean(rowHref || onRowClick);

  function goNext() {
    if (!nextCursor) return;
    setPager((prev) =>
      prev.key !== keyHash
        ? prev
        : { ...prev, cursors: [...prev.cursors.slice(0, prev.pageIndex + 1), nextCursor], pageIndex: prev.pageIndex + 1 },
    );
  }

  function goPrev() {
    setPager((prev) => (prev.key !== keyHash ? prev : { ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }));
  }

  function activate(row: T) {
    if (onRowClick) onRowClick(row);
    else if (rowHref) router.push(rowHref(row));
  }

  const colCount = table.getAllLeafColumns().length || 1;

  return (
    <div className={cn('rounded-lg border border-border bg-surface', className)}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody aria-busy={query.isFetching || undefined}>
          {query.isPending ? (
            Array.from({ length: 5 }, (_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {Array.from({ length: colCount }, (_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full max-w-40" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : query.isError ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colCount}>
                <ErrorState
                  message={query.error instanceof PageLoadError ? query.error.message : undefined}
                  onRetry={() => query.refetch()}
                />
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colCount}>
                <EmptyState title={emptyTitle ?? t('empty')} description={emptyDescription} />
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-clickable={clickable || undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => activate(row.original) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter') activate(row.original);
                      }
                    : undefined
                }
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {pageIndex > 0 || nextCursor ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-sm text-muted-foreground">
          <span>{t('page', { page: pageIndex + 1 })}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goPrev}
              disabled={pageIndex === 0 || query.isFetching}
            >
              <ChevronLeft />
              {t('previous')}
            </Button>
            <Button variant="outline" size="sm" onClick={goNext} disabled={!nextCursor || query.isFetching}>
              {t('next')}
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
