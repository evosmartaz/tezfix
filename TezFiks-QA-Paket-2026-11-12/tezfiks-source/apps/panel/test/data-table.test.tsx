// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DataTable, dataTableColumns, type CursorPage } from '@/components/data-table';
import { renderPanel } from './render';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

interface Row {
  id: string;
  name: string;
}

const col = dataTableColumns<Row>();
const columns = [col.accessor('id', { header: '№' }), col.accessor('name', { header: 'Müştəri' })];

const pages: Record<string, CursorPage<Row>> = {
  first: {
    items: [
      { id: '#2847', name: 'Nizami T.' },
      { id: '#2846', name: 'Aysel Q.' },
    ],
    nextCursor: 'c2',
  },
  c2: { items: [{ id: '#2845', name: 'Tural B.' }], nextCursor: null },
};

describe('DataTable', () => {
  it('loads pages through the cursor and goes back', async () => {
    const fetchPage = vi.fn(async (cursor: string | null) => pages[cursor ?? 'first']);
    renderPanel(
      <DataTable columns={columns} queryKey={['orders']} fetchPage={fetchPage} getRowId={(r) => r.id} />,
    );
    expect(await screen.findByText('Nizami T.')).toBeTruthy();
    expect(screen.getByText('Müştəri')).toBeTruthy();
    expect(fetchPage).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: /Növbəti/ }));
    expect(await screen.findByText('Tural B.')).toBeTruthy();
    expect(fetchPage).toHaveBeenLastCalledWith('c2');
    expect(screen.getByText('Səhifə 2')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Növbəti/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Əvvəlki/ }));
    expect(await screen.findByText('Aysel Q.')).toBeTruthy();
  });

  it('renders the server-provided first page without fetching', async () => {
    const fetchPage = vi.fn(async () => pages.c2);
    renderPanel(
      <DataTable
        columns={columns}
        queryKey={['orders', 'ssr']}
        fetchPage={fetchPage}
        initialPage={pages.first}
      />,
    );
    expect(screen.getByText('Nizami T.')).toBeTruthy();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('shows the empty state', async () => {
    renderPanel(
      <DataTable
        columns={columns}
        queryKey={['empty']}
        fetchPage={async () => ({ items: [], nextCursor: null })}
      />,
    );
    expect(await screen.findByText('Məlumat yoxdur')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Növbəti/ })).toBeNull();
  });

  it('shows the translated action error and retries', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN', message: 'Bu əməliyyata icazəniz yoxdur' })
      .mockResolvedValueOnce({ ok: true, data: pages.c2 });
    renderPanel(<DataTable columns={columns} queryKey={['err']} fetchPage={fetchPage} />);
    expect(await screen.findByText('Bu əməliyyata icazəniz yoxdur')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByText('Tural B.')).toBeTruthy();
  });

  it('navigates on row click and Enter when rowHref is given', async () => {
    renderPanel(
      <DataTable
        columns={columns}
        queryKey={['click']}
        fetchPage={async () => pages.c2}
        rowHref={(r) => `/admin/orders/${r.id.slice(1)}`}
      />,
    );
    const cell = await screen.findByText('Tural B.');
    fireEvent.click(cell);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/orders/2845'));
    fireEvent.keyDown(cell.closest('tr')!, { key: 'Enter' });
    expect(push).toHaveBeenCalledTimes(2);
  });

  describe('when the query key (filters) changes', () => {
    const all: CursorPage<Row> = { items: [{ id: '#1', name: 'ALL-1' }], nextCursor: 'a2' };
    const allPage2: CursorPage<Row> = { items: [{ id: '#0', name: 'ALL-2' }], nextCursor: null };
    const filtered: CursorPage<Row> = { items: [{ id: '#9', name: 'FILTERED-1' }], nextCursor: null };

    it('does not reuse the server-rendered page for a different key and fetches the new filter', async () => {
      const fetchPage = vi.fn(async (cursor: string | null) => (cursor === 'a2' ? allPage2 : filtered));
      const view = renderPanel(
        <DataTable columns={columns} queryKey={['orders', { status: null }]} fetchPage={fetchPage} initialPage={all} />,
      );
      expect(screen.getByText('ALL-1')).toBeTruthy();
      expect(fetchPage).not.toHaveBeenCalled();

      view.rerender(
        <DataTable columns={columns} queryKey={['orders', { status: 'OPEN' }]} fetchPage={fetchPage} initialPage={all} />,
      );
      expect(await screen.findByText('FILTERED-1')).toBeTruthy();
      expect(screen.queryByText('ALL-1')).toBeNull();
      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(fetchPage).toHaveBeenCalledWith(null);
    });

    it('resets the cursor and the page counter to page 1', async () => {
      const fetchPage = vi.fn(async (cursor: string | null) => (cursor === 'a2' ? allPage2 : all));
      const view = renderPanel(
        <DataTable columns={columns} queryKey={['orders', { status: null }]} fetchPage={fetchPage} />,
      );
      expect(await screen.findByText('ALL-1')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Növbəti/ }));
      expect(await screen.findByText('ALL-2')).toBeTruthy();
      expect(screen.getByText('Səhifə 2')).toBeTruthy();

      const filteredFetch = vi.fn(async (_cursor: string | null) => filtered);
      view.rerender(
        <DataTable columns={columns} queryKey={['orders', { status: 'OPEN' }]} fetchPage={filteredFetch} />,
      );
      expect(await screen.findByText('FILTERED-1')).toBeTruthy();
      expect(filteredFetch).toHaveBeenCalledTimes(1);
      expect(filteredFetch).toHaveBeenCalledWith(null);
      expect(screen.queryByText('Səhifə 2')).toBeNull();
      expect(screen.queryByRole('button', { name: /Əvvəlki/ })).toBeNull();
    });

    it('uses a new server-rendered page that arrives together with the new key', async () => {
      const fetchPage = vi.fn(async (_cursor: string | null) => all);
      const view = renderPanel(
        <DataTable columns={columns} queryKey={['orders', { status: null }]} fetchPage={fetchPage} initialPage={all} />,
      );
      expect(screen.getByText('ALL-1')).toBeTruthy();
      view.rerender(
        <DataTable
          columns={columns}
          queryKey={['orders', { status: 'OPEN' }]}
          fetchPage={fetchPage}
          initialPage={filtered}
        />,
      );
      expect(await screen.findByText('FILTERED-1')).toBeTruthy();
      expect(fetchPage).not.toHaveBeenCalled();
    });
  });
});
