import { beforeEach, describe, expect, it } from 'vitest';

import {
  SESSION_KEY,
  clearSession,
  getSnapshot,
  readSession,
  readToken,
  writeSession,
} from '@/lib/session';

/**
 * `localStorage` is user-writable and survives deploys, so everything read from
 * it is untrusted input. These cover the malformed cases, because the failure
 * mode of getting them wrong is a white screen on every load — which is far
 * worse than being signed out.
 */

const VALID = {
  email: 'owner@edawr.test',
  name: 'Owner',
  role: 'admin' as const,
  accessToken: 'a-token',
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('readSession', () => {
  it('round-trips a valid session', () => {
    writeSession(VALID);
    expect(readSession()).toEqual(VALID);
    expect(readToken()).toBe('a-token');
  });

  it('returns null when nothing is stored', () => {
    expect(readSession()).toBeNull();
    expect(readToken()).toBe('');
  });

  it('discards malformed JSON instead of throwing', () => {
    window.localStorage.setItem(SESSION_KEY, '{not json');
    expect(readSession()).toBeNull();
    // Also cleaned up, so the bad value cannot fail again on the next read.
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('rejects a session with no token', () => {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ email: 'x@y.z', role: 'admin' }),
    );
    expect(readSession()).toBeNull();
  });

  it('rejects a role it does not recognise', () => {
    // An older bundle meeting a newer server, or someone editing devtools.
    // Failing closed here means the shell treats them as signed out rather than
    // rendering navigation for a role it cannot reason about.
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...VALID, role: 'superuser' }),
    );
    expect(readSession()).toBeNull();
  });

  it('tolerates a missing name', () => {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ email: 'x@y.z', role: 'manager', accessToken: 't' }),
    );
    expect(readSession()?.name).toBe('');
  });
});

describe('clearSession', () => {
  it('removes the stored session', () => {
    writeSession(VALID);
    clearSession();
    expect(readSession()).toBeNull();
  });
});

describe('getSnapshot', () => {
  it('returns a stable reference while the stored value is unchanged', () => {
    // This is not a micro-optimisation. React calls getSnapshot on every render
    // and bails out only on reference equality, so parsing afresh each time
    // returns a new object every call and loops forever.
    writeSession(VALID);
    expect(getSnapshot()).toBe(getSnapshot());
  });

  it('returns a new reference once the stored value changes', () => {
    writeSession(VALID);
    const before = getSnapshot();
    writeSession({ ...VALID, role: 'manager' });
    const after = getSnapshot();

    expect(after).not.toBe(before);
    expect(after?.role).toBe('manager');
  });
});
