/**
 * Where a banner goes, as the form thinks of it.
 *
 * The API stores one string, `Promo.link`, and accepts a storefront path or
 * an allowlisted URL (`https://`, `http://`, `tel:`, `mailto:` — see
 * `PromoSerializer.validate_link`). A manager should not have to know that a
 * WhatsApp number is spelled `https://wa.me/91...`, so the form asks for a
 * *kind* and a value, and this module is the translation in both directions:
 * `composeLink` builds the string the API wants, `parseLink` recovers the
 * kind and value from a stored one so the edit form opens on what was meant.
 *
 * The server is still the gate. `linkProblem` mirrors its rules so the form
 * can say why before the request does; it does not replace them.
 */

export type LinkKind = 'storefront' | 'website' | 'whatsapp' | 'phone' | 'email';

export const LINK_KINDS: { value: LinkKind; label: string }[] = [
  { value: 'storefront', label: 'Page on the storefront' },
  { value: 'website', label: 'Website' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'phone', label: 'Phone call' },
  { value: 'email', label: 'Email' },
];

export const LINK_HINTS: Record<LinkKind, string> = {
  storefront: 'A page on the storefront, like /category/dairy or /offers. Empty means the full catalogue.',
  website: 'Opens in a new tab. https:// is added if you leave it off.',
  whatsapp: 'The number customers will message. 10 digits, or with the country code.',
  phone: 'The number the phone app dials. 10 digits, or with the country code.',
  email: 'Opens the customer’s mail app with this address filled in.',
};

export const LINK_PLACEHOLDERS: Record<LinkKind, string> = {
  storefront: '/products',
  website: 'https://example.com/sale',
  whatsapp: '98123 45678',
  phone: '98123 45678',
  email: 'hello@example.com',
};

/** The value box's own label, so "Number" sits next to "WhatsApp" rather than "Link". */
export const LINK_LABELS: Record<LinkKind, string> = {
  storefront: 'Path',
  website: 'Address',
  whatsapp: 'Number',
  phone: 'Number',
  email: 'Email address',
};

/** `tel` brings up the number pad on a phone, which is where a manager often is. */
export const LINK_INPUT_TYPES: Record<LinkKind, 'text' | 'url' | 'tel' | 'email'> = {
  storefront: 'text',
  website: 'url',
  whatsapp: 'tel',
  phone: 'tel',
  email: 'email',
};

const WA_ME = 'https://wa.me/';

/**
 * Digits only, with India's country code in front when the number is a bare
 * ten digits — the same normalisation the API applies to customer and rider
 * numbers, so a number typed the way people say it reaches the right phone.
 * Anything else (already international, or not a number) comes back as its
 * digits and is left for `linkProblem` to judge.
 */
export function normaliseDigits(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

/** The string the API stores, or null for "no link" (the full catalogue). */
export function composeLink(kind: LinkKind, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  switch (kind) {
    case 'storefront':
      return trimmed;
    case 'website':
      return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    case 'whatsapp':
      return `${WA_ME}${normaliseDigits(trimmed)}`;
    case 'phone':
      return `tel:+${normaliseDigits(trimmed)}`;
    case 'email':
      return `mailto:${trimmed}`;
  }
}

/** The reverse, for the edit form. An unrecognised value is shown as a website so nothing is hidden. */
export function parseLink(link: string | null): { kind: LinkKind; value: string } {
  const value = (link ?? '').trim();
  if (!value) return { kind: 'storefront', value: '' };
  if (value.startsWith('/')) return { kind: 'storefront', value };
  if (value.toLowerCase().startsWith(WA_ME)) {
    return { kind: 'whatsapp', value: value.slice(WA_ME.length).replace(/\?.*$/, '') };
  }
  if (/^tel:/i.test(value)) return { kind: 'phone', value: value.slice(4) };
  if (/^mailto:/i.test(value)) return { kind: 'email', value: value.slice(7) };
  return { kind: 'website', value };
}

/**
 * Why the value cannot be saved, or null. Mirrors the API's `validate_link`
 * and adds the shape checks a kind implies (a phone number has to look like
 * one) so the message names the actual mistake.
 */
export function linkProblem(kind: LinkKind, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Numbers are normalised to digits before they are sent, so "98123 45678"
  // is fine there; everywhere else the server refuses whitespace outright.
  if (kind !== 'whatsapp' && kind !== 'phone' && /[\\\s]/.test(trimmed)) {
    return 'No spaces or backslashes.';
  }
  switch (kind) {
    case 'storefront':
      if (trimmed.startsWith('//') || !trimmed.startsWith('/')) {
        return 'A path on the storefront starts with a single slash, like /category/dairy.';
      }
      return null;
    case 'website': {
      const url = composeLink(kind, trimmed)!;
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        return 'That is not a web address.';
      }
      if (!host.includes('.')) return 'A web address needs a full hostname, like example.com.';
      return null;
    }
    case 'whatsapp':
    case 'phone': {
      const digits = normaliseDigits(trimmed);
      if (!/^\d{11,15}$/.test(digits)) return 'A phone number: 10 digits, or with the country code.';
      return null;
    }
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'An email address, like hello@example.com.';
      return null;
  }
}

/** A short human label for the list: "WhatsApp 98123 45678" rather than the URL. */
export function describeLink(link: string | null): string {
  const { kind, value } = parseLink(link);
  switch (kind) {
    case 'storefront':
      return value || '/products';
    case 'whatsapp':
      return `WhatsApp ${value}`;
    case 'phone':
      return `Call ${value}`;
    case 'email':
      return `Email ${value}`;
    case 'website':
      return value.replace(/^https?:\/\//i, '');
  }
}
