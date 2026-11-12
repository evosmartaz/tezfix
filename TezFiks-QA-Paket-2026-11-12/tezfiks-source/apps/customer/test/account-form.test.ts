import {
  buildAccountBody,
  emptyAccountForm,
  hasErrors,
  isValidAccountBody,
  normalizeVoen,
  sanitizeVoenInput,
  validateAccountForm,
} from '../src/lib/accountForm';

describe('account type form (board 02 A3)', () => {
  it('an individual account needs nothing else and sends only the type', () => {
    const f = { ...emptyAccountForm('Nizami Tağızadə'), companyName: 'x', voen: '12' };
    expect(validateAccountForm(f)).toEqual({});
    expect(buildAccountBody(f)).toEqual({ type: 'INDIVIDUAL' });
    expect(isValidAccountBody(buildAccountBody(f))).toBe(true);
  });

  it('a company account requires a name of 2+ characters and a 10-digit VÖEN', () => {
    const f = { ...emptyAccountForm(), type: 'COMPANY' as const };
    expect(validateAccountForm(f)).toEqual({ companyName: 'account.errors.companyNameRequired', voen: 'account.errors.voenRequired' });
    expect(validateAccountForm({ ...f, companyName: ' K ', voen: '123456789' })).toEqual({
      companyName: 'account.errors.companyNameRequired',
      voen: 'account.errors.voenInvalid',
    });
    expect(validateAccountForm({ ...f, companyName: 'x'.repeat(121), voen: '12345678901' })).toEqual({
      companyName: 'account.errors.companyNameTooLong',
      voen: 'account.errors.voenInvalid',
    });
    expect(hasErrors(validateAccountForm({ ...f, companyName: 'Kontur MMC', voen: '1234567890' }))).toBe(false);
  });

  it('contact person is optional but must be 2..120 characters when given', () => {
    const base = { ...emptyAccountForm(), type: 'COMPANY' as const, companyName: 'Kontur', voen: '1234567890' };
    expect(validateAccountForm({ ...base, contactPerson: '' })).toEqual({});
    expect(validateAccountForm({ ...base, contactPerson: 'A' })).toEqual({ contactPerson: 'account.errors.contactPersonTooShort' });
    expect(validateAccountForm({ ...base, contactPerson: 'A'.repeat(121) })).toEqual({ contactPerson: 'account.errors.contactPersonTooLong' });
  });

  it('builds a trimmed company body that the contract accepts, keeping Azerbaijani letters intact', () => {
    const body = buildAccountBody({
      type: 'COMPANY',
      companyName: '  Şəfəq İnşaat MMC ',
      voen: '1234 567-890',
      legalForm: 'MMC',
      contactPerson: ' İlkin Əliyev ',
    });
    expect(body).toEqual({ type: 'COMPANY', companyName: 'Şəfəq İnşaat MMC', voen: '1234567890', legalForm: 'MMC', contactPerson: 'İlkin Əliyev' });
    expect(isValidAccountBody(body)).toBe(true);
  });

  it('drops an empty contact person and a missing legal form', () => {
    expect(buildAccountBody({ type: 'COMPANY', companyName: 'Kontur', voen: '1234567890', legalForm: null, contactPerson: '  ' })).toEqual({
      type: 'COMPANY',
      companyName: 'Kontur',
      voen: '1234567890',
    });
  });

  it('VÖEN input keeps at most 10 digits; normalization strips spaces and dashes', () => {
    expect(sanitizeVoenInput('12a34-56 78901234')).toBe('1234567890');
    expect(normalizeVoen(' 12-34 ')).toBe('1234');
  });

  it('the contract rejects a company body without VÖEN (defence in depth)', () => {
    expect(isValidAccountBody({ type: 'COMPANY', companyName: 'Kontur' })).toBe(false);
  });
});
