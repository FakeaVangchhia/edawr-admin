'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark';

const THEME_KEY = 'edawr-console-theme';

/**
 * The theme preference, stored and applied to `<html data-theme>`.
 *
 * **Two states, and light is the default.** There used to be a third, "system",
 * which meant "no attribute, let `prefers-color-scheme` decide". That option is
 * gone along with the media query it depended on: white is the console's main
 * theme now, so following the operating system would hand a dark console to
 * everyone whose laptop happens to be set that way — the exact default the
 * change was made to stop.
 *
 * Removing it rather than leaving it in place was the point. A "System" button
 * that quietly resolved to light whatever the system said would be a control
 * that lies, which is worse than one fewer choice.
 *
 * Light is still represented by the *absence* of the attribute rather than by
 * `data-theme="light"`, because absence is what the stylesheet already treats
 * as light and it keeps the stored state empty for everyone who never touches
 * the toggle. Choosing light therefore clears the key rather than writing to it.
 *
 * The initial application happens in a blocking inline script in the root
 * layout, before first paint. This hook only handles changes made afterwards.
 */

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): ThemePreference {
  if (typeof window === 'undefined') return 'light';
  // Anything that is not exactly 'dark' is light, which also quietly retires
  // the 'system' value left in the storage of anyone who chose it before.
  return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

// The server cannot know the preference, and no longer needs to guess: light is
// what it renders and light is what the default document is, so the first paint
// is already correct for everyone who has not opted into dark.
const getServerSnapshot = (): ThemePreference => 'light';

export function useTheme(): [ThemePreference, (next: ThemePreference) => void] {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: ThemePreference) => {
    if (next === 'dark') {
      window.localStorage.setItem(THEME_KEY, 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      window.localStorage.removeItem(THEME_KEY);
      document.documentElement.removeAttribute('data-theme');
    }
    notify();
  }, []);

  return [theme, setTheme];
}
