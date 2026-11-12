import {
  buildKycSubmitBody,
  canGoTo,
  canSubmit,
  extrasFileKind,
  initialKycState,
  kycReducer,
  KYC_POLICY_VERSION,
  KYC_SLOTS,
  missingSlots,
  SLOT_FILE_KIND,
  slotCamera,
  type KycAction,
  type KycState,
} from '../src/lib/kyc';

const run = (state: KycState, ...actions: KycAction[]) => actions.reduce(kycReducer, state);

function captureAll(state: KycState): KycState {
  let s = state;
  for (const slot of KYC_SLOTS) {
    s = kycReducer(s, { type: 'captured', slot, uri: `file:///${slot}.jpg` });
    s = kycReducer(s, { type: 'uploaded', slot, uri: `file:///${slot}.jpg`, fileId: `f-${slot}` });
  }
  return s;
}

describe('KYC step machine', () => {
  it('walks consent → ID front → ID back → selfie look/turn/blink → extras → review', () => {
    let s = initialKycState();
    expect(s.step).toBe('consent');
    s = kycReducer(s, { type: 'captured', slot: 'idFront', uri: 'x' });
    expect(s.captures.idFront).toBeUndefined(); // nothing before consent
    s = kycReducer(s, { type: 'acceptConsent' });
    expect(s.step).toBe('idFront');
    const seen: string[] = [s.step];
    for (const slot of KYC_SLOTS) {
      s = kycReducer(s, { type: 'captured', slot, uri: `file:///${slot}.jpg` });
      seen.push(s.step);
    }
    expect(seen).toEqual(['idFront', 'idBack', 'selfieFront', 'selfieTurn', 'selfieBlink', 'extras']);
    s = kycReducer(s, { type: 'next' });
    expect(s.step).toBe('review');
  });

  it('uses the back camera with a card frame for the ID and the front camera for the selfie', () => {
    expect(slotCamera('idFront')).toEqual({ facing: 'back', overlay: 'card' });
    expect(slotCamera('idBack')).toEqual({ facing: 'back', overlay: 'card' });
    expect(slotCamera('selfieBlink')).toEqual({ facing: 'front', overlay: 'face' });
    expect(SLOT_FILE_KIND).toEqual({
      idFront: 'KYC_ID_FRONT',
      idBack: 'KYC_ID_BACK',
      selfieFront: 'KYC_SELFIE',
      selfieTurn: 'KYC_SELFIE_TURN',
      selfieBlink: 'KYC_SELFIE_BLINK',
    });
    expect(extrasFileKind('HANDYMAN')).toBe('KYC_TRADE_PROOF');
    expect(extrasFileKind('COMPANY')).toBe('COMPANY_DOC');
  });

  it('cannot submit until every photo is uploaded', () => {
    let s = run(initialKycState(), { type: 'acceptConsent' });
    s = captureAll(s);
    s = run(s, { type: 'next' });
    expect(canSubmit(s)).toBe(true);
    s = kycReducer(s, { type: 'uploadFailed', slot: 'idBack', uri: 'file:///idBack.jpg' });
    expect(canSubmit(s)).toBe(false);
    expect(missingSlots(s)).toEqual(['idBack']);
    expect(buildKycSubmitBody(s, 'az')).toBeNull();
  });

  it('a retake from the review returns to the review and ignores the stale upload of the old photo', () => {
    let s = captureAll(run(initialKycState(), { type: 'acceptConsent' }));
    s = run(s, { type: 'next' });
    expect(s.step).toBe('review');
    s = kycReducer(s, { type: 'retake', slot: 'selfieTurn' });
    expect(s.step).toBe('selfieTurn');
    expect(canGoTo(s, 'review')).toBe(false);
    s = kycReducer(s, { type: 'captured', slot: 'selfieTurn', uri: 'file:///turn2.jpg' });
    expect(s.step).toBe('review');
    s = kycReducer(s, { type: 'uploaded', slot: 'selfieTurn', uri: 'file:///selfieTurn.jpg', fileId: 'stale' });
    expect(s.captures.selfieTurn).toEqual({ uri: 'file:///turn2.jpg', status: 'uploading', fileId: null });
    s = kycReducer(s, { type: 'uploaded', slot: 'selfieTurn', uri: 'file:///turn2.jpg', fileId: 'f-turn2' });
    expect(buildKycSubmitBody(s, 'ru')?.selfie.turnFileId).toBe('f-turn2');
  });

  it('builds the POST /kyc/submissions body for a handyman with optional trade proofs (max 5)', () => {
    let s = captureAll(run(initialKycState(), { type: 'acceptConsent' }));
    for (let i = 0; i < 6; i++) s = kycReducer(s, { type: 'extraAdded', uri: `file:///proof${i}.jpg` });
    expect(s.extras).toHaveLength(5);
    expect(canSubmit(s)).toBe(false); // extras still uploading
    s = kycReducer(s, { type: 'extraUploaded', uri: 'file:///proof0.jpg', fileId: 'p0' });
    s = kycReducer(s, { type: 'extraFailed', uri: 'file:///proof1.jpg' });
    for (let i = 2; i < 5; i++) s = kycReducer(s, { type: 'extraRemoved', uri: `file:///proof${i}.jpg` });
    expect(canSubmit(s)).toBe(true);
    expect(buildKycSubmitBody(s, 'az')).toEqual({
      subject: 'HANDYMAN',
      idFrontFileId: 'f-idFront',
      idBackFileId: 'f-idBack',
      selfie: { frontFileId: 'f-selfieFront', turnFileId: 'f-selfieTurn', blinkFileId: 'f-selfieBlink' },
      selfieChecks: null,
      tradeProofFileIds: ['p0'],
      companyDocFileIds: [],
      consent: { policyVersion: KYC_POLICY_VERSION, locale: 'az', accepted: true },
    });
  });

  it('company submissions carry the company id and company documents', () => {
    let s = captureAll(run(initialKycState('COMPANY', 'co1'), { type: 'acceptConsent' }));
    s = run(s, { type: 'extraAdded', uri: 'file:///doc.jpg' }, { type: 'extraUploaded', uri: 'file:///doc.jpg', fileId: 'd1' });
    expect(buildKycSubmitBody(s, 'en')).toMatchObject({ subject: 'COMPANY', companyId: 'co1', companyDocFileIds: ['d1'], tradeProofFileIds: [] });
    expect(canSubmit(captureAll(run(initialKycState('COMPANY', null), { type: 'acceptConsent' })))).toBe(false);
  });

  it('locks the flow while submitting and after success; a failure keeps the photos', () => {
    let s = captureAll(run(initialKycState(), { type: 'acceptConsent' }));
    s = kycReducer(s, { type: 'submitStart' });
    expect(s.submitting).toBe(true);
    expect(kycReducer(s, { type: 'retake', slot: 'idFront' })).toBe(s);
    s = kycReducer(s, { type: 'submitFailed', error: 'KYC_RESUBMIT_LIMIT' });
    expect(s).toMatchObject({ submitting: false, error: 'KYC_RESUBMIT_LIMIT' });
    expect(missingSlots(s)).toEqual([]);
    s = run(s, { type: 'submitStart' }, { type: 'submitted' });
    expect(s.submitted).toBe(true);
    expect(kycReducer(s, { type: 'retake', slot: 'idFront' })).toBe(s);
  });

  it('back never goes before the consent; next does not skip a missing photo', () => {
    let s = run(initialKycState(), { type: 'back' });
    expect(s.step).toBe('consent');
    s = run(s, { type: 'next' });
    expect(s.step).toBe('consent');
    s = run(s, { type: 'acceptConsent' }, { type: 'next' });
    expect(s.step).toBe('idFront');
    s = run(s, { type: 'back' });
    expect(s.step).toBe('consent');
    expect(run(s, { type: 'goto', step: 'review' }).step).toBe('consent');
  });
});
