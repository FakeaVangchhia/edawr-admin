import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PromoDrawer } from '@/components/promos/PromoDrawer';
import * as queries from '@/lib/queries';
import type { Promo } from '@/types';

/**
 * Two things the banner form has to get right.
 *
 * The destination, because a Manager should type a WhatsApp number and have
 * the API receive `https://wa.me/91...` — and because pasting a full address
 * into the storefront-path box is the expected mistake, so the form should say
 * so before the round trip (the rules themselves are tested in
 * `lib/promo-link.test.ts`). And the PUT body, because the promo PUT is not
 * partial: editing the title must send the image and the window back
 * unchanged, or a rename quietly takes the picture down.
 */

const PROMO: Promo = {
  id: 3,
  title: 'Fresh this week',
  subtitle: 'Vegetables in by 6am',
  image_url: '/uploads/veg.png',
  link: '/category/vegetables',
  sort_order: 2,
  status: 'active',
  starts_at: null,
  ends_at: '2026-12-31T18:30:00Z',
  created_at: '2026-09-01T09:00:00Z',
};

describe('PromoDrawer', () => {
  it('will not submit a full web address as a storefront path', async () => {
    const create = vi.spyOn(queries, 'createPromo').mockResolvedValue(PROMO);
    const user = userEvent.setup();
    render(<PromoDrawer promo={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText(/^title/i), 'Diwali');
    await user.type(screen.getByLabelText(/^path/i), 'https://example.com');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(create).not.toHaveBeenCalled();
    expect(screen.getAllByText(/single slash/i).length).toBeGreaterThan(0);
  });

  it('sends a WhatsApp number as a wa.me link', async () => {
    const create = vi.spyOn(queries, 'createPromo').mockResolvedValue(PROMO);
    const user = userEvent.setup();
    render(<PromoDrawer promo={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText(/^title/i), 'Order on WhatsApp');
    await user.selectOptions(screen.getByLabelText(/goes to/i), 'whatsapp');
    await user.type(screen.getByLabelText(/^number/i), '98123 45678');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ link: 'https://wa.me/919812345678' });
  });

  it('opens an existing WhatsApp banner on the number, not the URL', () => {
    render(
      <PromoDrawer
        promo={{ ...PROMO, link: 'https://wa.me/919812345678' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/goes to/i)).toHaveValue('whatsapp');
    expect(screen.getByLabelText(/^number/i)).toHaveValue('919812345678');
  });

  it('will not save while a banner image is still uploading', async () => {
    // A never-resolving upload: the race this guards is the save landing
    // before the file does, with the old image_url and an orphaned upload.
    vi.spyOn(queries, 'uploadProductImage').mockReturnValue(new Promise(() => {}));
    const create = vi.spyOn(queries, 'createPromo').mockResolvedValue(PROMO);
    const user = userEvent.setup();
    const { container } = render(<PromoDrawer promo={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText(/^title/i), 'Diwali');
    const file = new File(['x'], 'banner.jpg', { type: 'image/jpeg' });
    await user.upload(container.querySelector('input[type="file"]')!, file);

    const save = screen.getByRole('button', { name: /uploading/i });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the whole row on an edit, so a rename keeps the image and the window', async () => {
    const update = vi.spyOn(queries, 'updatePromo').mockResolvedValue(PROMO);
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<PromoDrawer promo={PROMO} onClose={vi.fn()} onSaved={onSaved} />);

    const title = screen.getByLabelText(/^title/i);
    await user.clear(title);
    await user.type(title, 'Fresh today');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(update).toHaveBeenCalledTimes(1);
    const [id, body] = update.mock.calls[0];
    expect(id).toBe(3);
    expect(body).toMatchObject({
      title: 'Fresh today',
      image_url: '/uploads/veg.png',
      link: '/category/vegetables',
      sort_order: 2,
      status: 'active',
      starts_at: null,
    });
    // The end date round-trips through the local datetime input and back to
    // ISO; the instant must survive even though the string may not.
    expect(new Date(body.ends_at as string).getTime()).toBe(new Date(PROMO.ends_at!).getTime());
    expect(onSaved).toHaveBeenCalledWith('Fresh today');
  });
});
