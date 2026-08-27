import { describe, expect, it } from 'vitest';

import { categoryPutBody } from '@/lib/queries';
import type { Category } from '@/types';

/**
 * `categoryPutBody` exists because the category endpoint's `PUT` is **not**
 * partial: DRF applies each field's declared default to anything the body
 * omits, which is what makes PUT mean "replace". So a form that edits only the
 * name and posts `{name}` also clears the category's image and resets its
 * position in the rail — silently, with a 200 response.
 *
 * The storefront's console learned this the hard way and shipped its own
 * version of this function with a regression test beside it. This is the same
 * idea, kept because the trap has not gone anywhere.
 */

const CATEGORY: Category = {
  id: 4,
  name: 'Dairy & Bread',
  description: 'Milk, curd, bread and eggs',
  parent_id: null,
  image_url: '/uploads/dairy-a1b2c3.png',
  sort_order: 2,
  status: 'active',
};

describe('categoryPutBody', () => {
  it('carries every field through when only one is changed', () => {
    const body = categoryPutBody(CATEGORY, { name: 'Dairy' });

    expect(body.name).toBe('Dairy');
    // The two that would otherwise be silently destroyed.
    expect(body.image_url).toBe('/uploads/dairy-a1b2c3.png');
    expect(body.sort_order).toBe(2);
    expect(body.description).toBe('Milk, curd, bread and eggs');
    expect(body.status).toBe('active');
  });

  it('names every field the serializer would default', () => {
    // If the backend gains an optional field, it has to appear here too, or the
    // same class of silent data loss returns. Asserting the exact key set is
    // what turns that into a failing test rather than a support ticket.
    expect(Object.keys(categoryPutBody(CATEGORY, {})).sort()).toEqual(
      ['description', 'image_url', 'name', 'parent_id', 'sort_order', 'status'].sort(),
    );
  });

  it('sends null rather than undefined for absent optional values', () => {
    // `JSON.stringify` drops undefined keys entirely, which would put us right
    // back to relying on the serializer's default.
    const bare: Category = {
      ...CATEGORY,
      description: null,
      image_url: null,
      parent_id: null,
    };
    const body = categoryPutBody(bare, {});

    expect(body.description).toBeNull();
    expect(body.image_url).toBeNull();
    expect(body.parent_id).toBeNull();
    expect(JSON.parse(JSON.stringify(body))).toHaveProperty('image_url', null);
  });

  it('lets a change explicitly clear a field', () => {
    const body = categoryPutBody(CATEGORY, { image_url: null });
    expect(body.image_url).toBeNull();
    // …without taking anything else with it.
    expect(body.sort_order).toBe(2);
  });

  it('defaults sort order to zero when it is missing', () => {
    const body = categoryPutBody({ ...CATEGORY, sort_order: 0 }, {});
    expect(body.sort_order).toBe(0);
  });
});
