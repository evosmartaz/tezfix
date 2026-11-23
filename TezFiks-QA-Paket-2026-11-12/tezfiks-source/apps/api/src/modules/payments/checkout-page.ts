import { formatMoney, type Locale, type PaymentPurpose, type PaymentStatus } from '@tezfiks/shared';

type T = (key: string, vars?: Record<string, string | number>) => string;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const CSS = `
:root{--brand:#2F5BFF;--ink:#0F1729;--muted:#5F6B7D;--line:#DFE4EF;--bg:#F5F7FC;--danger:#C83746;--warn:#FFB020}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:16px;line-height:1.45;-webkit-text-size-adjust:100%}
.wrap{max-width:440px;margin:0 auto;padding:16px}
.banner{background:var(--warn);color:var(--ink);font-weight:700;letter-spacing:.06em;text-align:center;border-radius:10px;padding:8px 12px;font-size:13px}
.hint{color:var(--muted);font-size:13px;margin:8px 2px 16px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(11,26,92,.04)}
.brand{font-weight:800;font-size:20px;color:var(--ink);margin:0 0 12px}
.brand span{color:var(--brand)}
.purpose{color:var(--muted);font-size:14px;margin:0}
.amount{font-size:32px;font-weight:800;margin:4px 0 16px}
label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin:12px 0 6px}
input{width:100%;font:inherit;font-size:17px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);outline:none}
input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(0,169,113,.15)}
.row{display:flex;gap:12px}
.row>div{flex:1}
.btn{display:block;width:100%;border:0;border-radius:12px;padding:14px 16px;font:inherit;font-size:17px;font-weight:700;cursor:pointer;margin-top:16px;text-align:center;text-decoration:none}
.btn-pay{background:var(--brand);color:#fff}
.btn-cancel{background:transparent;color:var(--ink);border:1px solid var(--line);margin-top:10px}
.note{color:var(--muted);font-size:12px;text-align:center;margin-top:12px}
.status{font-size:22px;font-weight:800;margin:8px 0}
.ok{color:var(--brand)}
.bad{color:var(--danger)}
.icon{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#fff;margin:0 auto 8px}
.icon.ok{background:var(--brand)}
.icon.bad{background:var(--danger)}
.center{text-align:center}
`;

function layout(locale: Locale, title: string, body: string): string {
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#2F5BFF">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="wrap">
${body}
</main>
</body>
</html>`;
}

export interface CheckoutFormData {
  intentId: string;
  token: string;
  amount: number;
  purpose: PaymentPurpose;
}

/** The hosted TEST checkout form (fake provider). */
export function renderCheckoutForm(locale: Locale, t: T, d: CheckoutFormData): string {
  const amount = formatMoney(d.amount, locale);
  const body = `
<div class="banner">${escapeHtml(t('server.payments.checkout.testMode'))}</div>
<p class="hint">${escapeHtml(t('server.payments.checkout.testModeHint'))}</p>
<section class="card">
  <p class="brand">Tez<span>Fiks</span></p>
  <p class="purpose">${escapeHtml(t(`server.payments.checkout.purpose.${d.purpose}`))}</p>
  <div class="amount" data-testid="amount">${escapeHtml(amount)}</div>
  <form method="post" action="./${escapeHtml(d.intentId)}" autocomplete="on">
    <input type="hidden" name="t" value="${escapeHtml(d.token)}">
    <label for="card">${escapeHtml(t('server.payments.checkout.cardNumber'))}</label>
    <input id="card" name="card" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="23">
    <div class="row">
      <div>
        <label for="exp">${escapeHtml(t('server.payments.checkout.expiry'))}</label>
        <input id="exp" name="exp" inputmode="numeric" autocomplete="cc-exp" placeholder="12/30" maxlength="5">
      </div>
      <div>
        <label for="cvc">${escapeHtml(t('server.payments.checkout.cvc'))}</label>
        <input id="cvc" name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4">
      </div>
    </div>
    <label for="name">${escapeHtml(t('server.payments.checkout.holderName'))}</label>
    <input id="name" name="name" autocomplete="cc-name" maxlength="100">
    <button class="btn btn-pay" type="submit" name="action" value="pay">${escapeHtml(t('server.payments.checkout.pay', { amount }))}</button>
    <button class="btn btn-cancel" type="submit" name="action" value="cancel" formnovalidate>${escapeHtml(t('server.payments.checkout.cancel'))}</button>
  </form>
  <p class="note">${escapeHtml(t('server.payments.checkout.secureNote'))}</p>
</section>`;
  return layout(locale, t('server.payments.checkout.pageTitle'), body);
}

export interface CheckoutResultData {
  status: PaymentStatus;
  amount: number;
  failureReason: string | null;
  /** Allowed return URL (with the result appended), shown as a link. */
  returnUrl: string | null;
}

/** Result page after the payment settled (or when an already settled intent is opened again). */
export function renderCheckoutResult(locale: Locale, t: T, d: CheckoutResultData): string {
  const amount = formatMoney(d.amount, locale);
  const ok = d.status === 'SUCCEEDED';
  const text =
    d.status === 'SUCCEEDED'
      ? t('server.payments.result.succeededBody', { amount })
      : d.status === 'CANCELLED'
        ? t('server.payments.result.cancelledBody')
        : d.status === 'FAILED'
          ? t('server.payments.result.failedBody')
          : t('server.payments.result.pendingBody');
  const reasonKey = d.failureReason ? `server.payments.reason.${d.failureReason}` : null;
  const reason = reasonKey ? t(reasonKey) : null;
  const body = `
<div class="banner">${escapeHtml(t('server.payments.checkout.testMode'))}</div>
<section class="card center" style="margin-top:16px">
  <div class="icon ${ok ? 'ok' : 'bad'}">${ok ? '&#10003;' : '!'}</div>
  <div class="status ${ok ? 'ok' : 'bad'}" data-status="${escapeHtml(d.status)}">${escapeHtml(t(`server.payments.result.${d.status}`))}</div>
  <p>${escapeHtml(text)}</p>
  ${reason && reason !== reasonKey && d.status === 'FAILED' ? `<p class="purpose">${escapeHtml(reason)}</p>` : ''}
  ${d.returnUrl ? `<a class="btn btn-pay" href="${escapeHtml(d.returnUrl)}">TezFiks</a>` : ''}
  <p class="note">${escapeHtml(t('server.payments.result.close'))}</p>
</section>`;
  return layout(locale, t('server.payments.checkout.pageTitle'), body);
}

/** 403 page for a missing or tampered checkout token. */
export function renderInvalidLink(locale: Locale, t: T): string {
  const body = `
<section class="card center" style="margin-top:16px">
  <div class="icon bad">!</div>
  <div class="status bad">${escapeHtml(t('server.payments.invalidLink.title'))}</div>
  <p>${escapeHtml(t('server.payments.invalidLink.body'))}</p>
</section>`;
  return layout(locale, t('server.payments.invalidLink.title'), body);
}
