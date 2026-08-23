import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ImageFallback } from '@/components/ProductCard';

/**
 * The placeholder every uncovered tile in the storefront renders.
 *
 * Worth a test despite being presentational, because of how much of the site it
 * is: `manage.py seed` uploads no images, so on a fresh database all 33
 * products and all 8 categories render this, on every catalogue surface. If the
 * asset path stops matching the file in `public/`, nothing throws and no test
 * fails — the customer just gets a grid of broken-image icons.
 *
 * Rendered with `react-dom/server` rather than Testing Library: the storefront
 * does not have `@testing-library/react` installed, and static markup is enough
 * to assert what this component puts in the DOM.
 */
describe('ImageFallback', () => {
  it('renders the placeholder image, not the product initial', () => {
    const html = renderToStaticMarkup(<ImageFallback name="Tomato" />);

    expect(html).toContain('src="/product-placeholder.svg"');
    // The old behaviour: the first letter of the name, on a tinted ground.
    expect(html).not.toContain('>T<');
  });

  it('points at a file that is actually in public/', () => {
    const html = renderToStaticMarkup(<ImageFallback name="Tomato" />);
    const src = /src="([^"]+)"/.exec(html)?.[1] ?? '';

    expect(src).not.toBe('');
    // The failure this guards is silent: a renamed or deleted asset still
    // compiles, still passes every other assertion here, and ships a catalogue
    // of broken-image icons. `public/` is served at the root, so the src maps
    // to a path on disk directly.
    // A plain path, not a file: URL — the jsdom environment replaces the URL
    // global, and node:fs rejects an instance that is not its own.
    expect(existsSync(join(process.cwd(), 'public', src))).toBe(true);
  });

  it('keeps the image decorative', () => {
    const html = renderToStaticMarkup(<ImageFallback name="Amul Taaza Milk" />);

    // Every call site renders the name as text right beside this. An alt of the
    // product name would make a screen reader announce it twice.
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden');
    expect(html).not.toContain('Amul Taaza Milk');
  });

  it('applies the caller size class, which is how one asset serves every box', () => {
    // The same component renders at a 44px cart thumbnail and a full-width
    // category banner; the box comes from the caller, the fit from the image.
    const thumbnail = renderToStaticMarkup(
      <ImageFallback name="Tomato" className="size-11 shrink-0 rounded-xl" />,
    );
    const banner = renderToStaticMarkup(
      <ImageFallback name="Fruits & Vegetables" className="aspect-[16/10] w-full" />,
    );

    expect(thumbnail).toContain('size-11');
    expect(banner).toContain('aspect-[16/10]');
    expect(thumbnail).toContain('object-contain');
    expect(banner).toContain('object-contain');
  });
});
