import { describe, expect, it } from 'vitest';

import { passwordProblem } from '@/lib/password';

/**
 * The client-side mirror of the server's password rules.
 *
 * These exist so a rejection is not the first the customer hears of the rule.
 * The server is still the authority — `validate_password_strength` is what
 * actually refuses — so the risk being managed here is *disagreement*: a
 * password this accepts and the server rejects makes the form look broken.
 */

describe('length', () => {
  it('refuses under eight characters', () => {
    expect(passwordProblem('milk12')).not.toBeNull();
  });

  it('accepts eight', () => {
    expect(passwordProblem('milk1234')).toBeNull();
  });
});

describe('all digits', () => {
  it('refuses a numeric password however long', () => {
    // The rule that matters most on an account keyed by a phone number.
    expect(passwordProblem('48130625')).not.toBeNull();
    expect(passwordProblem('4813062512345')).not.toBeNull();
  });

  it('accepts digits mixed with anything else', () => {
    expect(passwordProblem('4813-0625')).toBeNull();
  });
});

describe('the customer’s own number', () => {
  it('refuses the bare ten digits', () => {
    expect(passwordProblem('9812345678', '9812345678')).not.toBeNull();
  });

  it('refuses it however either side is spelled', () => {
    // The password field and the phone field accept different spellings, so
    // the comparison has to be on digits, and on the last ten of them.
    expect(passwordProblem('+919812345678', '9812345678')).not.toBeNull();
    expect(passwordProblem('9812345678', '+91 98123 45678')).not.toBeNull();
    expect(passwordProblem('09812345678', '+919812345678')).not.toBeNull();
  });

  it('allows a different number', () => {
    expect(passwordProblem('+919000000001', '9812345678')).toBeNull();
  });

  it('does not complain when no phone is given', () => {
    // The change-password form has no phone field on it.
    expect(passwordProblem('a-good-password')).toBeNull();
  });
});
