import { isPasswordAllowed } from './password-policy';

describe('password policy', () => {
  it('accepts a long password with a letter and a digit', () => {
    expect(isPasswordAllowed('RegulatorSafe1')).toBe(true);
  });

  it('rejects short passwords', () => {
    expect(isPasswordAllowed('Short1a')).toBe(false);
  });

  it('rejects letter-only or digit-only passwords', () => {
    expect(isPasswordAllowed('OnlyLettersHere')).toBe(false);
    expect(isPasswordAllowed('123456789012')).toBe(false);
  });

  it('rejects known demo passwords', () => {
    expect(isPasswordAllowed('admin123')).toBe(false);
    expect(isPasswordAllowed('fda_admin123')).toBe(false);
  });
});
