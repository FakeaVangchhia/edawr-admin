import { describe, expect, it } from 'vitest';

import { composeLink, describeLink, linkProblem, parseLink } from '@/lib/promo-link';

/**
 * The translation between what a manager types and what the API stores has
 * to round-trip, or the edit form opens on something other than what was
 * saved — and the WhatsApp case is the one that matters, because nobody
 * should ever see or type `https://wa.me/`.
 */
describe('composeLink()', () => {
  it('keeps a storefront path as typed and sends nothing for empty', () => {
    expect(composeLink('storefront', ' /offers ')).toBe('/offers');
    expect(composeLink('storefront', '')).toBeNull();
    expect(composeLink('whatsapp', '  ')).toBeNull();
  });

  it('adds https:// to a bare website', () => {
    expect(composeLink('website', 'example.com/sale')).toBe('https://example.com/sale');
    expect(composeLink('website', 'http://example.com')).toBe('http://example.com');
  });

  it('turns an Indian number into a wa.me or tel: link', () => {
    expect(composeLink('whatsapp', '98123 45678')).toBe('https://wa.me/919812345678');
    expect(composeLink('whatsapp', '+91 98123-45678')).toBe('https://wa.me/919812345678');
    expect(composeLink('whatsapp', '09812345678')).toBe('https://wa.me/919812345678');
    expect(composeLink('phone', '9812345678')).toBe('tel:+919812345678');
    expect(composeLink('email', 'hello@example.com')).toBe('mailto:hello@example.com');
  });
});

describe('parseLink()', () => {
  it('recovers the kind and value from every stored form', () => {
    expect(parseLink(null)).toEqual({ kind: 'storefront', value: '' });
    expect(parseLink('/category/dairy')).toEqual({ kind: 'storefront', value: '/category/dairy' });
    expect(parseLink('https://wa.me/919812345678')).toEqual({ kind: 'whatsapp', value: '919812345678' });
    expect(parseLink('https://wa.me/919812345678?text=Hi')).toEqual({ kind: 'whatsapp', value: '919812345678' });
    expect(parseLink('tel:+919812345678')).toEqual({ kind: 'phone', value: '+919812345678' });
    expect(parseLink('mailto:a@b.co')).toEqual({ kind: 'email', value: 'a@b.co' });
    expect(parseLink('https://example.com/x')).toEqual({ kind: 'website', value: 'https://example.com/x' });
  });

  it('round-trips through composeLink', () => {
    for (const link of ['/offers', 'https://wa.me/919812345678', 'tel:+919812345678', 'mailto:a@b.co', 'https://example.com/x']) {
      const { kind, value } = parseLink(link);
      expect(composeLink(kind, value)).toBe(link);
    }
  });
});

describe('linkProblem()', () => {
  it('accepts a well-formed value of each kind, and nothing', () => {
    expect(linkProblem('storefront', '/category/dairy')).toBeNull();
    expect(linkProblem('storefront', '')).toBeNull();
    expect(linkProblem('website', 'example.com')).toBeNull();
    expect(linkProblem('website', 'https://example.com/sale?x=1')).toBeNull();
    expect(linkProblem('whatsapp', '98123 45678')).toBeNull();
    expect(linkProblem('phone', '+91 98123 45678')).toBeNull();
    expect(linkProblem('email', 'hello@example.com')).toBeNull();
  });

  it('names the mistake', () => {
    expect(linkProblem('storefront', 'https://example.com')).toMatch(/single slash/);
    expect(linkProblem('storefront', '//example.com/x')).toMatch(/single slash/);
    expect(linkProblem('storefront', 'products')).toMatch(/single slash/);
    expect(linkProblem('storefront', '/x y')).toMatch(/spaces/);
    expect(linkProblem('website', 'localhost')).toMatch(/hostname/);
    expect(linkProblem('website', 'https://')).not.toBeNull();
    expect(linkProblem('whatsapp', '12345')).toMatch(/phone number/);
    expect(linkProblem('phone', 'call me')).toMatch(/phone number/);
    expect(linkProblem('email', 'nope')).toMatch(/email/);
  });
});

describe('describeLink()', () => {
  it('reads as a destination rather than a URL', () => {
    expect(describeLink(null)).toBe('/products');
    expect(describeLink('/offers')).toBe('/offers');
    expect(describeLink('https://wa.me/919812345678')).toBe('WhatsApp 919812345678');
    expect(describeLink('tel:+919812345678')).toBe('Call +919812345678');
    expect(describeLink('https://example.com/sale')).toBe('example.com/sale');
  });
});
