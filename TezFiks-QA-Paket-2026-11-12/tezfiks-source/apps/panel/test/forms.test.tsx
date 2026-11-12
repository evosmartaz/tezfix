// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderPanel } from './render';

const actions = vi.hoisted(() => ({
  adminLoginAction: vi.fn(),
  companyOtpRequestAction: vi.fn(),
  companyOtpVerifyAction: vi.fn(),
  setLocaleAction: vi.fn(),
  logoutAction: vi.fn(),
}));
vi.mock('@/lib/actions/auth', () => actions);

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  pathname: '/admin/orders/42',
}));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => router.pathname }));

import { AdminLoginForm } from '@/components/auth/admin-login-form';
import { CompanyLoginForm } from '@/components/auth/company-login-form';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { LanguageSwitcher } from '@/components/language-switcher';
import { AppShell } from '@/components/shell/app-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { IDS } from './helpers';

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  router.refresh.mockReset();
});

describe('AdminLoginForm', () => {
  it('validates email and password before calling the action', async () => {
    renderPanel(<AdminLoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Daxil ol' }));
    expect(await screen.findAllByText('Bu sahə mütləqdir')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('E-poçt'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Şifrə'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Daxil ol' }));
    expect(await screen.findByText('Düzgün e-poçt ünvanı daxil edin')).toBeTruthy();
    expect(actions.adminLoginAction).not.toHaveBeenCalled();
  });

  it('submits credentials with the next path and shows the API error', async () => {
    actions.adminLoginAction.mockResolvedValue({
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'E-poçt və ya şifrə yanlışdır',
    });
    renderPanel(<AdminLoginForm next="/admin/handymen" />);
    fireEvent.change(screen.getByLabelText('E-poçt'), { target: { value: ' admin@tezfiks.az ' } });
    fireEvent.change(screen.getByLabelText('Şifrə'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Daxil ol' }));
    await waitFor(() =>
      expect(actions.adminLoginAction).toHaveBeenCalledWith({
        email: 'admin@tezfiks.az',
        password: 'secret',
        next: '/admin/handymen',
      }),
    );
    expect(await screen.findByText('E-poçt və ya şifrə yanlışdır')).toBeTruthy();
  });

  it('shows the session-expired notice', () => {
    renderPanel(<AdminLoginForm notice="Sessiyanın vaxtı bitib, yenidən daxil olun" />);
    expect(screen.getByRole('alert').textContent).toContain('Sessiyanın vaxtı bitib');
  });
});

describe('CompanyLoginForm', () => {
  const challenge = {
    challengeId: IDS.challenge,
    phone: '+994501234567',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    resendAfterSec: 60,
    devCode: '123456',
  };

  it('rejects an invalid phone locally', async () => {
    renderPanel(<CompanyLoginForm />);
    fireEvent.change(screen.getByLabelText('Telefon nömrəsi'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kodu WhatsApp-a göndər' }));
    expect(await screen.findByText('Düzgün mobil nömrə daxil edin')).toBeTruthy();
    expect(actions.companyOtpRequestAction).not.toHaveBeenCalled();
  });

  it('formats the phone as typed, requests the code, shows the dev hint and auto-submits 6 digits', async () => {
    actions.companyOtpRequestAction.mockResolvedValue({ ok: true, data: challenge });
    actions.companyOtpVerifyAction.mockResolvedValue({
      ok: false,
      code: 'OTP_INVALID',
      message: 'Kod yanlışdır',
    });
    renderPanel(<CompanyLoginForm next={`/company/${IDS.companyA}`} />);
    const phone = screen.getByLabelText('Telefon nömrəsi') as HTMLInputElement;
    fireEvent.change(phone, { target: { value: '0501234567' } });
    expect(phone.value).toBe('050 123 45 67');
    fireEvent.click(screen.getByRole('button', { name: 'Kodu WhatsApp-a göndər' }));
    await waitFor(() =>
      expect(actions.companyOtpRequestAction).toHaveBeenCalledWith({ phone: '050 123 45 67' }),
    );

    expect(await screen.findByText('Test rejimi: kod 123456')).toBeTruthy();
    expect(screen.getByText(/Kod WhatsApp-da \+994 50 123 45 67 nömrəsinə göndərildi/)).toBeTruthy();
    expect(screen.getByText(/Yeni kod 60 san sonra/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('6 rəqəmli kod'), { target: { value: '12a3456' } });
    await waitFor(() =>
      expect(actions.companyOtpVerifyAction).toHaveBeenCalledWith({
        challengeId: IDS.challenge,
        code: '123456',
        next: `/company/${IDS.companyA}`,
      }),
    );
    expect(await screen.findByText('Kod yanlışdır')).toBeTruthy();
  });

  it('shows API errors of the code request (cooldown)', async () => {
    actions.companyOtpRequestAction.mockResolvedValue({
      ok: false,
      code: 'OTP_COOLDOWN',
      message: 'Yeni kod üçün bir az gözləyin',
    });
    renderPanel(<CompanyLoginForm />);
    fireEvent.change(screen.getByLabelText('Telefon nömrəsi'), { target: { value: '+994 55 765 43 21' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kodu WhatsApp-a göndər' }));
    expect(await screen.findByText('Yeni kod üçün bir az gözləyin')).toBeTruthy();
  });
});

describe('ConfirmDialog', () => {
  it('opens, runs the async confirm and closes', async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    renderPanel(
      <ConfirmDialog trigger={<button type="button">Blokla</button>} destructive onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByText('Blokla'));
    expect(await screen.findByText('Əminsiniz?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    resolve();
    await waitFor(() => expect(screen.queryByText('Əminsiniz?')).toBeNull());
  });

  it('stays open when the confirm handler returns false', async () => {
    renderPanel(<ConfirmDialog trigger={<button type="button">Sil</button>} onConfirm={() => false} />);
    fireEvent.click(screen.getByText('Sil'));
    fireEvent.click(await screen.findByRole('button', { name: 'Təsdiqlə' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('Əminsiniz?')).toBeTruthy();
  });
});

describe('LanguageSwitcher', () => {
  it('stores the new language and refreshes the page', async () => {
    actions.setLocaleAction.mockResolvedValue({ ok: true, data: undefined });
    renderPanel(<LanguageSwitcher />, 'az');
    expect(screen.getByRole('button', { name: 'az' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'ru' }));
    await waitFor(() => expect(actions.setLocaleAction).toHaveBeenCalledWith('ru'));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'az' }));
    expect(actions.setLocaleAction).toHaveBeenCalledTimes(1);
  });
});

describe('AppShell', () => {
  it('renders the admin sidebar with the active section and the logout form', () => {
    renderPanel(
      <AppShell
        subtitle="TezFiks Admin"
        nav={ADMIN_NAV}
        navNamespace="panel.nav.admin"
        userName="Aysel Admin"
      >
        <p>content</p>
      </AppShell>,
    );
    const active = screen.getAllByRole('link', { current: 'page' });
    expect(active.length).toBeGreaterThan(0);
    expect(active[0].textContent).toBe('Sifarişlər');
    expect(active[0].getAttribute('href')).toBe('/admin/orders');
    expect(screen.getAllByText('Müraciətlər').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Çıxış' })).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });
});
