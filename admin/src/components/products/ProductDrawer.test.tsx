import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProductDrawer } from '@/components/products/ProductDrawer';
import * as queries from '@/lib/queries';
import type { Product } from '@/types';

/**
 * What the edit drawer is allowed to send.
 *
 * This is a test about stock, not about forms. The drawer holds a snapshot of
 * the row taken when it opened, and a shop sells things while a manager has it
 * open. If saving a corrected product *name* also writes back the `stock` that
 * was on screen a minute ago, the units sold in between reappear on the shelf —
 * and nothing anywhere reports it. The API is PATCH precisely so that does not
 * happen, but PATCH only helps if the body is genuinely partial: the server
 * builds its `update_fields` from the keys it receives.
 *
 * So the assertion is about absence. `stock` must not be in the request unless
 * the manager actually typed in the stock box.
 */

const PRODUCT: Product = {
  id: 7,
  name: 'Parle-G Biscuits',
  sku: 'PG-100',
  barcode: null,
  category: 'Biscuits',
  brand: 'Parle',
  unit: '100 g',
  price: 25,
  cost_price: 18,
  mrp: 30,
  stock: 20,
  reorder_level: 10,
  status: 'active',
  location: 'A1',
  supplier_name: null,
  supplier_phone: null,
  description: null,
  image_url: null,
  discount_percent: 0,
  created_at: '2026-08-01T09:00:00Z',
};

function open(product: Product | null = PRODUCT) {
  const onSaved = vi.fn();
  render(
    <ProductDrawer
      open
      product={product}
      categories={[]}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  );
  return { onSaved };
}

describe('ProductDrawer, editing', () => {
  it('sends only the field that changed, leaving stock out of it', async () => {
    const update = vi.spyOn(queries, 'updateProduct').mockResolvedValue(PRODUCT);
    const user = userEvent.setup();
    open();

    const name = screen.getByLabelText(/name/i);
    await user.clear(name);
    await user.type(name, 'Parle-G Original');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(update).toHaveBeenCalledTimes(1);
    const [id, body] = update.mock.calls[0];
    expect(id).toBe(7);
    expect(body).toEqual({ name: 'Parle-G Original' });
    // Spelled out separately: this is the assertion that costs money when it
    // stops holding, and `toEqual` above could be loosened by a later edit.
    expect(body).not.toHaveProperty('stock');
  });

  it('does send stock when stock is what was edited', async () => {
    const update = vi.spyOn(queries, 'updateProduct').mockResolvedValue(PRODUCT);
    const user = userEvent.setup();
    open();

    const stock = screen.getByLabelText(/units in stock/i);
    await user.clear(stock);
    await user.type(stock, '31');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(update).toHaveBeenCalledWith(7, { stock: 31 });
  });

  it('does not call the API at all when nothing was touched', async () => {
    const update = vi.spyOn(queries, 'updateProduct').mockResolvedValue(PRODUCT);
    const user = userEvent.setup();
    const { onSaved } = open();

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(update).not.toHaveBeenCalled();
    // The drawer still closes — from the manager's side nothing was changed and
    // nothing needed saving, which is not an error worth a message.
    expect(onSaved).toHaveBeenCalled();
  });

  it('still sends the whole product when creating one', async () => {
    const create = vi.spyOn(queries, 'createProduct').mockResolvedValue(PRODUCT);
    const user = userEvent.setup();
    open(null);

    await user.type(screen.getByLabelText(/name/i), 'Maggi Noodles');
    await user.type(screen.getByLabelText(/selling price/i), '14');
    await user.click(screen.getByRole('button', { name: /create product/i }));

    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0][0] as Record<string, unknown>;
    expect(body.name).toBe('Maggi Noodles');
    // A new row has no server-side value to preserve, so the full body is
    // correct here — the diffing applies to edits only.
    expect(body).toHaveProperty('stock', 0);
    expect(body).toHaveProperty('status', 'active');
  });
});
