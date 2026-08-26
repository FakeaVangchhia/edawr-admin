/**
 * The password rules, mirrored client-side.
 *
 * **The server is the authority** — `api/security.py::validate_password_strength`
 * runs Django's validators and is what actually refuses a password. This exists
 * so the refusal is not the first thing the customer hears about the rule: a
 * form that accepts something and then reports a 400 has made the person type
 * it twice for nothing.
 *
 * Only a subset is mirrored, and deliberately. Length, all-digits and "it is
 * your own phone number" are cheap and cover the failures that actually happen
 * on an account keyed by a phone number. The 20,000-word common-password list
 * is not shipped to the browser to save a round trip — the server catches it,
 * and `PASSWORD_HINT` sets the expectation before anyone types.
 *
 * Kept pure and out of the components so it can be tested; `frontend/` has no
 * Testing Library, so logic that is not extracted is logic that is not covered.
 */

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_HINT =
  'At least 8 characters. Not all numbers, and not your phone number.';

/** Digits only, in any spelling the phone field accepts. */
const digitsOnly = (value: string) => value.replace(/\D/g, '');

/**
 * The reason this password is unacceptable, or `null` if it is fine.
 *
 * `phone` is optional because the change-password form has no phone field on
 * it; when it is given, a password that is merely the customer's own number is
 * refused. That is the single likeliest weak password here — asked to choose
 * one, somebody identified by ten digits reaches for ten digits.
 */
export function passwordProblem(password: string, phone?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (/^\d+$/.test(password)) {
    return 'Use more than just numbers — add a word or two.';
  }

  if (phone) {
    const asDigits = digitsOnly(password);
    const phoneDigits = digitsOnly(phone);
    // Compared on the last ten digits so `+919812345678`, `09812345678` and
    // `9812345678` are all recognised as the same number.
    if (asDigits.length >= 10 && phoneDigits.length >= 10) {
      if (asDigits.slice(-10) === phoneDigits.slice(-10)) {
        return 'That is your phone number. Pick something else.';
      }
    }
  }

  return null;
}
