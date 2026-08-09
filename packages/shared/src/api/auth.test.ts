import { describe, expect, it, afterEach, vi } from 'vitest';

import {
  AuthError,
  currentUser,
  looksLikeEmail,
  normaliseEmail,
  sendEmailOtp,
  setApiTransport,
  signOut,
  verifyEmailOtp,
} from './index.js';

/** A stubbed Supabase auth surface. Nothing here touches a network. */
function authStub(overrides: Record<string, unknown> = {}) {
  const auth = {
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    ...overrides,
  };
  setApiTransport({ rpc: () => Promise.resolve({ data: null, error: null }), auth } as never);
  return auth;
}

afterEach(() => setApiTransport(null));

describe('normaliseEmail', () => {
  it('lowercases and trims, so one mailbox is one account', () => {
    // E03-15's failure mode arriving through the front door: Parent@School.edu and
    // parent@school.edu are the same person and must not become two order histories.
    expect(normaliseEmail('  Parent@School.EDU ')).toBe('parent@school.edu');
  });

  it('does not strip dots or +tags', () => {
    // Gmail-specific conventions are wrong for most other providers, and a school's mail
    // server may genuinely treat these as different people. E19-04 found ~15 parents whose
    // addresses differ only by domain spelling and the ruling was the same: never merge
    // automatically, because a wrong merge shows one parent another family's child.
    expect(normaliseEmail('first.last+lunch@ais.amity.edu.in')).toBe(
      'first.last+lunch@ais.amity.edu.in',
    );
  });
});

describe('looksLikeEmail', () => {
  it.each(['a@b.co', 'first.last+x@ais.amity.edu.in', ' A@B.COM '])('accepts %s', (value) => {
    expect(looksLikeEmail(value)).toBe(true);
  });

  it.each(['', 'nope', 'a@b', 'a b@c.com', '@b.com', 'a@'])('rejects %s', (value) => {
    expect(looksLikeEmail(value)).toBe(false);
  });
});

describe('sendEmailOtp', () => {
  it('sends to the normalised address', async () => {
    const auth = authStub();
    await sendEmailOtp('  Parent@School.EDU ');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'parent@school.edu' });
  });

  it('never passes a password — there is no such thing here', async () => {
    // U1: no passwords, and no path that could carry one.
    const auth = authStub();
    await sendEmailOtp('a@b.com');
    const [arg] = auth.signInWithOtp.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(arg)).toEqual(['email']);
  });

  it('does not set shouldCreateUser:false — sign up and sign in are one act', async () => {
    // AR7 in one flag. A parent who has never used GrayBag types their address and gets a
    // code, with no separate "create an account" step.
    const auth = authStub();
    await sendEmailOtp('new@parent.com');
    const [arg] = auth.signInWithOtp.mock.calls[0] as [Record<string, unknown>];
    expect(arg.shouldCreateUser).toBeUndefined();
  });

  it('refuses an address that cannot receive mail, before spending a request', async () => {
    const auth = authStub();
    await expect(sendEmailOtp('nope')).rejects.toBeInstanceOf(AuthError);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('translates rate limiting into something a parent can act on', async () => {
    authStub({
      signInWithOtp: vi.fn().mockResolvedValue({
        error: { message: 'For security purposes, you can only request this after 51 seconds', status: 429 },
      }),
    });
    await expect(sendEmailOtp('a@b.com')).rejects.toThrow(/Wait a minute and try again/);
  });
});

describe('verifyEmailOtp', () => {
  it('returns the user so the caller needs no second round trip', async () => {
    authStub();
    await expect(verifyEmailOtp('a@b.com', ' 123456 ')).resolves.toEqual({
      userId: 'u1',
      email: 'a@b.com',
    });
  });

  it('trims the code, because a pasted code carries whitespace', async () => {
    const auth = authStub();
    await verifyEmailOtp('a@b.com', ' 123456 ');
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      token: '123456',
      type: 'email',
    });
  });

  it('refuses an empty code without calling the provider', async () => {
    const auth = authStub();
    await expect(verifyEmailOtp('a@b.com', '   ')).rejects.toThrow(/Enter the code/);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('distinguishes "no user came back" from "wrong code"', async () => {
    // A success with no user is a provider contract violation. Presenting it as a wrong
    // code sends someone to re-request a code forever against a backend that will never
    // give them a session.
    authStub({ verifyOtp: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) });
    await expect(verifyEmailOtp('a@b.com', '123456')).rejects.toThrow(/no account came back/);
  });

  it('surfaces a wrong code as an AuthError', async () => {
    authStub({
      verifyOtp: vi.fn().mockResolvedValue({ data: null, error: { message: 'Token has expired or is invalid' } }),
    });
    await expect(verifyEmailOtp('a@b.com', '000000')).rejects.toThrow(/expired or is invalid/);
  });
});

describe('signOut', () => {
  it('never throws — the user tapped it and the app must honour it', async () => {
    // If the network is down the local session is cleared regardless, and a stranded
    // refresh token expires on its own. Failing here would leave someone apparently
    // signed in on a shared phone.
    authStub({ signOut: vi.fn().mockRejectedValue(new Error('offline')) });
    await expect(signOut()).resolves.toBeUndefined();
  });
});

describe('currentUser', () => {
  it('returns null when there is no session', async () => {
    authStub();
    await expect(currentUser()).resolves.toBeNull();
  });

  it('returns the restored user', async () => {
    authStub({
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u9' } } } }),
    });
    await expect(currentUser()).resolves.toEqual({ userId: 'u9', email: null });
  });
});
