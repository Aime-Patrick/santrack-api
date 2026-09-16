import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Cost for new password hashes. Existing hashes keep their original cost. */
export const BCRYPT_ROUNDS = 12;

export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 12 characters and include a letter and a number';

/**
 * Common / demo passwords that must never be accepted for new credentials.
 * Seed accounts historically used several of these — they are rejected on
 * register, reset, and change so weak secrets cannot be reintroduced.
 */
const BLOCKED_PASSWORDS = new Set(
  [
    'password',
    'password1',
    'password12',
    'password123',
    'admin123',
    'admin1234',
    'admin12345',
    'rsb123',
    'rica123',
    'mfg123',
    'wh123',
    'shop123',
    'fda_admin123',
    '12345678',
    '123456789',
    '1234567890',
    'qwerty123',
    'letmein123',
    'welcome123',
    'changeme123',
    'santrack123',
  ].map((p) => p.toLowerCase()),
);

export function isPasswordAllowed(password: string): boolean {
  if (typeof password !== 'string') return false;
  const value = password.trim();
  if (value.length < PASSWORD_MIN_LENGTH) return false;
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return false;
  if (BLOCKED_PASSWORDS.has(value.toLowerCase())) return false;
  return true;
}

@ValidatorConstraint({ name: 'santrackPassword', async: false })
export class SantrackPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isPasswordAllowed(value);
  }

  defaultMessage(): string {
    return PASSWORD_POLICY_MESSAGE;
  }
}

/** Apply to any field that sets or changes a user password. */
export function IsSantrackPassword(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: SantrackPasswordConstraint,
    });
  };
}
