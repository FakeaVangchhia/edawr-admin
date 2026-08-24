import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearRecentSearches,
  getRecentSearchesServerSnapshot,
  readRecentSearches,
  rememberSearch,
  subscribeToRecentSearches,
} from '@/lib/recent-searches';

/**
 * The search overlay's shortcut list.
 *
 * Nothing depends on this data, so the tests are about the two things that can
 * still go wrong in front of a customer: a list that grows without bound, and a
 * stored value from an older build that reaches `.map()` during render.
 */

const STORAGE_KEY = 'edawr-recent-searches-v1';

beforeEach(() => {
  window.localStorage.clear();
  // The module caches its snapshot across the tests in one file, so reset
  // through the public API rather than assuming a fresh module.
  clearRecentSearches();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('recent searches', () => {
  it('remembers a term', () => {
    rememberSearch('atta');

    expect(readRecentSearches()).toEqual(['atta']);
  });

  it('puts the newest first', () => {
    rememberSearch('atta');
    rememberSearch('milk');

    expect(readRecentSearches()).toEqual(['milk', 'atta']);
  });

  it('trims surrounding whitespace', () => {
    rememberSearch('  milk \n');

    expect(readRecentSearches()).toEqual(['milk']);
  });

  it('ignores a blank term', () => {
    rememberSearch('   ');

    expect(readRecentSearches()).toEqual([]);
  });

  it('moves a repeated term back to the front without duplicating it', () => {
    rememberSearch('atta');
    rememberSearch('milk');
    rememberSearch('atta');

    expect(readRecentSearches()).toEqual(['atta', 'milk']);
  });

  it('treats a differently cased term as the same one, keeping the new casing', () => {
    // Searching is case-insensitive, so two spellings of one term would show as
    // two entries that do exactly the same thing.
    rememberSearch('Atta');
    rememberSearch('ATTA');

    expect(readRecentSearches()).toEqual(['ATTA']);
  });

  it('keeps only the six most recent', () => {
    for (let i = 0; i < 8; i += 1) rememberSearch(`term-${i}`);

    expect(readRecentSearches()).toEqual([
      'term-7',
      'term-6',
      'term-5',
      'term-4',
      'term-3',
      'term-2',
    ]);
  });

  it('clears', () => {
    rememberSearch('atta');

    clearRecentSearches();

    expect(readRecentSearches()).toEqual([]);
  });

  it('renders nothing on the server', () => {
    // The server snapshot must be the empty value or the server-rendered HTML
    // and the first client render disagree.
    rememberSearch('atta');

    expect(getRecentSearchesServerSnapshot()).toEqual([]);
  });

  it('does not throw when the write fails', () => {
    // Private browsing and a full quota both throw. Losing a shortcut list
    // costs the customer nothing; crashing the overlay costs them the search.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => rememberSearch('atta')).not.toThrow();
    expect(readRecentSearches()).toEqual(['atta']);
  });

  describe('validation', () => {
    /**
     * Write straight to storage, as an older build would have left it.
     *
     * The re-read goes through the cross-tab `storage` path, because that is
     * the only public way to invalidate the cached snapshot — and its listener
     * is attached lazily, only while something is subscribed. Dispatching
     * without subscribing does nothing, which would make every "expect it to be
     * dropped" assertion below pass whether the validation works or not.
     */
    const seed = (value: unknown) => {
      const raw = JSON.stringify(value);
      window.localStorage.setItem(STORAGE_KEY, raw);
      const unsubscribe = subscribeToRecentSearches(() => {});
      window.dispatchEvent(
        new StorageEvent('storage', { key: STORAGE_KEY, newValue: raw }),
      );
      unsubscribe();
    };

    it('the seed helper actually replaces the snapshot', () => {
      // Guards the trap above: if `seed` silently does nothing, every drop
      // assertion here is vacuous. This one fails loudly instead.
      seed(['seeded']);

      expect(readRecentSearches()).toEqual(['seeded']);
    });

    it('drops the entries that are not non-empty strings', () => {
      seed(['atta', 42, null, '', { term: 'milk' }, 'dal']);

      expect(readRecentSearches()).toEqual(['atta', 'dal']);
    });

    it('caps a stored list that is too long', () => {
      seed(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);

      expect(readRecentSearches()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });

    it('survives a non-array', () => {
      seed({ not: 'an array' });

      expect(readRecentSearches()).toEqual([]);
    });

    it('survives unparseable storage', () => {
      window.localStorage.setItem(STORAGE_KEY, 'not json');
      const unsubscribe = subscribeToRecentSearches(() => {});
      window.dispatchEvent(
        new StorageEvent('storage', { key: STORAGE_KEY, newValue: 'not json' }),
      );
      unsubscribe();

      expect(readRecentSearches()).toEqual([]);
    });
  });
});
