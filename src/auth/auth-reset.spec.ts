import { createHash } from 'crypto';
import { AuthService } from './services/auth.service';
import { TraceabilityRuleException } from '../common/errors';

/**
 * Builds the service with every collaborator stubbed, matching the style of
 * the organization spec. `existing` is what `users.findOne` returns.
 */
function service(existing: Record<string, unknown> | null) {
  const users = {
    findOne: jest.fn().mockResolvedValue(existing),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    create: jest.fn((row: unknown) => row),
  };
  const jwt = { signAsync: jest.fn() };
  const email = {
    sendForgotPasswordEmail: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'appPublicUrl') return 'http://localhost:3000';
      return undefined;
    }),
  };

  return {
    instance: new AuthService(
      users as never,
      jwt as never,
      email as never,
      config as never,
    ),
    users,
    email,
  };
}

describe('requesting a password reset', () => {
  it('answers success even when no account exists, and sends no email', async () => {
    // The endpoint must not reveal which addresses are registered: an unknown
    // email and a known one get the same answer.
    const { instance, email } = service(null);

    await expect(
      instance.requestPasswordReset({ email: 'nobody@example.com' }),
    ).resolves.toEqual({ success: true });
    expect(email.sendForgotPasswordEmail).not.toHaveBeenCalled();
  });

  it('stores a hashed token with a one-hour expiry and emails the plain one', async () => {
    const user = {
      id: 7,
      email: 'owner@acme.rw',
      passwordResetToken: null as string | null,
      passwordResetExpiresAt: null as Date | null,
    };
    const { instance, users, email } = service(user);

    const result = await instance.requestPasswordReset({ email: '  OWNER@acme.rw ' });

    expect(result).toEqual({ success: true });
    // Normalized before the lookup, and only ever sent by email address.
    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: 'owner@acme.rw' },
    });
    expect(users.save).toHaveBeenCalledTimes(1);
    expect(user.passwordResetToken).toHaveLength(64); // sha256 hex
    expect(user.passwordResetToken).not.toBe(email.sendForgotPasswordEmail.mock.calls[0][1]);

    const [to, plainToken, baseUrl] = email.sendForgotPasswordEmail.mock.calls[0];
    expect(to).toBe('owner@acme.rw');
    expect(baseUrl).toBe('http://localhost:3000');
    // What is stored is the hash of what was emailed - a leaked table cannot
    // turn back into a working reset link.
    expect(user.passwordResetToken).toBe(
      createHash('sha256').update(plainToken).digest('hex'),
    );
    expect((user.passwordResetExpiresAt as Date).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect((user.passwordResetExpiresAt as Date).getTime()).toBeLessThanOrEqual(
      Date.now() + 60 * 60 * 1000,
    );
  });

  it('does not fail the request when the email cannot be delivered', async () => {
    const user = { id: 7, email: 'owner@acme.rw' };
    const { instance, email } = service(user);
    email.sendForgotPasswordEmail.mockRejectedValue(new Error('smtp down'));

    // The request must not 500 because mail is down; the token simply dies
    // unused when it expires.
    await expect(
      instance.requestPasswordReset({ email: 'owner@acme.rw' }),
    ).resolves.toEqual({ success: true });
  });
});

describe('consuming a reset token', () => {
  const active = () => ({
    id: 7,
    passwordResetToken: createHash('sha256').update('plain-token').digest('hex'),
    passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    passwordHash: 'old-hash',
    mustChangePassword: false,
  });

  it('sets the new password and invalidates the token for reuse', async () => {
    const user = active();
    const { instance, users } = service(user);

    await expect(
      instance.resetPassword({ token: 'plain-token', newPassword: 'new-password-1' }),
    ).resolves.toEqual({ success: true });

    expect(user.passwordHash).not.toBe('old-hash');
    expect(user.mustChangePassword).toBe(false);
    expect(user.passwordResetToken).toBeNull();
    expect(user.passwordResetExpiresAt).toBeNull();
    expect(users.save).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown token', async () => {
    const { instance } = service(null);

    await expect(
      instance.resetPassword({ token: 'not-issued', newPassword: 'new-password-1' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('rejects an expired token', async () => {
    const user = active();
    user.passwordResetExpiresAt = new Date(Date.now() - 1000);
    const { instance } = service(user);

    await expect(
      instance.resetPassword({ token: 'plain-token', newPassword: 'new-password-1' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });
});
