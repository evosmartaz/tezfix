import type { FileKind, Locale } from '@tezfiks/shared';

/** Version of the consent text shown on the KYC consent screen (stored with the submission). */
export const KYC_POLICY_VERSION = 'kyc-consent-2026-10';
export const KYC_MAX_EXTRAS = 5;

export type KycSubject = 'HANDYMAN' | 'COMPANY';
export type KycSlot = 'idFront' | 'idBack' | 'selfieFront' | 'selfieTurn' | 'selfieBlink';
export type KycStep = 'consent' | KycSlot | 'extras' | 'review';

export const KYC_SLOTS: readonly KycSlot[] = ['idFront', 'idBack', 'selfieFront', 'selfieTurn', 'selfieBlink'];
export const KYC_STEPS: readonly KycStep[] = ['consent', ...KYC_SLOTS, 'extras', 'review'];

export const SLOT_FILE_KIND: Record<KycSlot, FileKind> = {
  idFront: 'KYC_ID_FRONT',
  idBack: 'KYC_ID_BACK',
  selfieFront: 'KYC_SELFIE',
  selfieTurn: 'KYC_SELFIE_TURN',
  selfieBlink: 'KYC_SELFIE_BLINK',
};

/** Back camera with the ID card frame for documents; front camera with the face oval for the guided selfie. */
export function slotCamera(slot: KycSlot): { facing: 'back' | 'front'; overlay: 'card' | 'face' } {
  return slot === 'idFront' || slot === 'idBack' ? { facing: 'back', overlay: 'card' } : { facing: 'front', overlay: 'face' };
}

/** Optional extra documents: trade certificates for handymen, registration documents for companies. */
export function extrasFileKind(subject: KycSubject): FileKind {
  return subject === 'COMPANY' ? 'COMPANY_DOC' : 'KYC_TRADE_PROOF';
}

export type UploadStatus = 'uploading' | 'uploaded' | 'failed';

export interface KycCapture {
  uri: string;
  status: UploadStatus;
  fileId: string | null;
}

export interface KycState {
  subject: KycSubject;
  companyId: string | null;
  step: KycStep;
  consent: boolean;
  captures: Partial<Record<KycSlot, KycCapture>>;
  extras: KycCapture[];
  submitting: boolean;
  submitted: boolean;
  /** The optional documents step was passed once (retakes then return to the review). */
  extrasSeen: boolean;
  /** Error code of the last failed submit. */
  error: string | null;
}

export type KycAction =
  | { type: 'acceptConsent' }
  | { type: 'captured'; slot: KycSlot; uri: string }
  | { type: 'uploaded'; slot: KycSlot; uri: string; fileId: string }
  | { type: 'uploadFailed'; slot: KycSlot; uri: string }
  | { type: 'retake'; slot: KycSlot }
  | { type: 'back' }
  | { type: 'next' }
  | { type: 'goto'; step: KycStep }
  | { type: 'extraAdded'; uri: string }
  | { type: 'extraUploaded'; uri: string; fileId: string }
  | { type: 'extraFailed'; uri: string }
  | { type: 'extraRemoved'; uri: string }
  | { type: 'submitStart' }
  | { type: 'submitFailed'; error: string }
  | { type: 'submitted' };

export function initialKycState(subject: KycSubject = 'HANDYMAN', companyId: string | null = null): KycState {
  return { subject, companyId, step: 'consent', consent: false, captures: {}, extras: [], submitting: false, submitted: false, extrasSeen: false, error: null };
}

function stepIndex(step: KycStep): number {
  return KYC_STEPS.indexOf(step);
}

/** The first step the user still has to complete (consent, then the first slot without a capture). */
export function firstIncompleteStep(state: KycState): KycStep {
  if (!state.consent) return 'consent';
  for (const s of KYC_SLOTS) {
    const c = state.captures[s];
    if (!c || c.status === 'failed') return s;
  }
  return 'extras';
}

/** A step is reachable when every step before it is complete. */
export function canGoTo(state: KycState, step: KycStep): boolean {
  if (state.submitting || state.submitted) return false;
  return stepIndex(step) <= stepIndex(firstIncompleteStep(state)) || (step === 'review' && firstIncompleteStep(state) === 'extras');
}

function nextStep(step: KycStep): KycStep {
  const i = stepIndex(step);
  return KYC_STEPS[Math.min(KYC_STEPS.length - 1, i + 1)]!;
}

/** Pure reducer of the KYC flow (consent → ID front → ID back → selfie look/turn/blink → extras → review). */
export function kycReducer(state: KycState, action: KycAction): KycState {
  if (state.submitted) return state;
  switch (action.type) {
    case 'acceptConsent':
      return { ...state, consent: true, step: state.step === 'consent' ? 'idFront' : state.step };
    case 'captured': {
      if (!state.consent || state.submitting) return state;
      const captures = { ...state.captures, [action.slot]: { uri: action.uri, status: 'uploading' as const, fileId: null } };
      const s = { ...state, captures, error: null };
      // After a retake from the review screen go back to review, otherwise continue with the next missing step.
      const after = firstIncompleteStep(s);
      if (action.slot !== state.step) return s;
      return { ...s, step: after === 'extras' && state.extrasSeen ? 'review' : after };
    }
    case 'uploaded': {
      const c = state.captures[action.slot];
      if (!c || c.uri !== action.uri) return state; // stale upload of a retaken photo
      return { ...state, captures: { ...state.captures, [action.slot]: { ...c, status: 'uploaded', fileId: action.fileId } } };
    }
    case 'uploadFailed': {
      const c = state.captures[action.slot];
      if (!c || c.uri !== action.uri) return state;
      return { ...state, captures: { ...state.captures, [action.slot]: { ...c, status: 'failed', fileId: null } } };
    }
    case 'retake': {
      if (state.submitting) return state;
      const captures = { ...state.captures };
      delete captures[action.slot];
      return { ...state, captures, step: action.slot };
    }
    case 'back': {
      if (state.submitting) return state;
      const i = stepIndex(state.step);
      return i <= 0 ? state : { ...state, step: KYC_STEPS[i - 1]! };
    }
    case 'next': {
      if (state.step === 'consent') return state.consent ? { ...state, step: 'idFront' } : state;
      if (state.step === 'extras') return { ...state, step: 'review', extrasSeen: true };
      if (state.step === 'review') return state;
      const c = state.captures[state.step];
      return c && c.status !== 'failed' ? { ...state, step: nextStep(state.step) } : state;
    }
    case 'goto':
      return canGoTo(state, action.step) ? { ...state, step: action.step } : state;
    case 'extraAdded':
      if (state.extras.length >= KYC_MAX_EXTRAS || state.extras.some((e) => e.uri === action.uri)) return state;
      return { ...state, extras: [...state.extras, { uri: action.uri, status: 'uploading', fileId: null }] };
    case 'extraUploaded':
      return { ...state, extras: state.extras.map((e) => (e.uri === action.uri ? { ...e, status: 'uploaded', fileId: action.fileId } : e)) };
    case 'extraFailed':
      return { ...state, extras: state.extras.map((e) => (e.uri === action.uri ? { ...e, status: 'failed', fileId: null } : e)) };
    case 'extraRemoved':
      return { ...state, extras: state.extras.filter((e) => e.uri !== action.uri) };
    case 'submitStart':
      return canSubmit(state) ? { ...state, submitting: true, error: null } : state;
    case 'submitFailed':
      return { ...state, submitting: false, error: action.error };
    case 'submitted':
      return { ...state, submitting: false, submitted: true, error: null };
    default:
      return state;
  }
}

/** Slots without an uploaded file. */
export function missingSlots(state: KycState): KycSlot[] {
  return KYC_SLOTS.filter((s) => state.captures[s]?.status !== 'uploaded');
}

export function isUploading(state: KycState): boolean {
  return KYC_SLOTS.some((s) => state.captures[s]?.status === 'uploading') || state.extras.some((e) => e.status === 'uploading');
}

export function canSubmit(state: KycState): boolean {
  return (
    state.consent &&
    !state.submitting &&
    !state.submitted &&
    missingSlots(state).length === 0 &&
    !isUploading(state) &&
    (state.subject === 'HANDYMAN' || !!state.companyId)
  );
}

export interface KycSubmitInput {
  subject: KycSubject;
  companyId?: string;
  idFrontFileId: string;
  idBackFileId: string;
  selfie: { frontFileId: string; turnFileId: string; blinkFileId: string };
  /** No on-device face check library is bundled: the admin reviews the three selfie frames. */
  selfieChecks: null;
  tradeProofFileIds: string[];
  companyDocFileIds: string[];
  consent: { policyVersion: string; locale: Locale; accepted: true };
}

/** POST /kyc/submissions body; null while something is missing. */
export function buildKycSubmitBody(state: KycState, locale: Locale): KycSubmitInput | null {
  if (!canSubmit(state) && !state.submitting) return null;
  if (missingSlots(state).length) return null;
  const id = (s: KycSlot) => state.captures[s]!.fileId!;
  const extras = state.extras.filter((e) => e.status === 'uploaded' && e.fileId).map((e) => e.fileId!);
  return {
    subject: state.subject,
    ...(state.subject === 'COMPANY' && state.companyId ? { companyId: state.companyId } : {}),
    idFrontFileId: id('idFront'),
    idBackFileId: id('idBack'),
    selfie: { frontFileId: id('selfieFront'), turnFileId: id('selfieTurn'), blinkFileId: id('selfieBlink') },
    selfieChecks: null,
    tradeProofFileIds: state.subject === 'HANDYMAN' ? extras : [],
    companyDocFileIds: state.subject === 'COMPANY' ? extras : [],
    consent: { policyVersion: KYC_POLICY_VERSION, locale, accepted: true },
  };
}
