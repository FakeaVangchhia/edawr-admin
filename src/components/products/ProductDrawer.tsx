'use client';

import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { Drawer, ErrorBanner, Field } from '@/components/ui';
import { ApiError, assetUrl, errorMessage } from '@/lib/api';
import { marginPercent } from '@/lib/format';
import { createProduct, updateProduct, uploadProductImage } from '@/lib/queries';
import type { Category, Product } from '@/types';

/**
 * Create or edit one product.
 *
 * **Editing sends PATCH, not PUT, and that is the important thing in this file.**
 * A PUT writes every column from a body assembled when the drawer opened, so
 * two units sold while the form was on screen are silently written back onto
 * the shelf. PATCH only helps if the body is actually partial, though — the
 * server builds its `update_fields` from the keys it receives — so `onSubmit`
 * diffs the form against the snapshot it was seeded with and sends the
 * difference. The effect is invisible until it costs someone real stock, which
 * is exactly why it is worth a comment rather than a convention.
 *
 * Form state is a flat record of strings because that is what inputs hold.
 * Converting at the boundary — once, on submit — keeps every field's handler
 * identical and means a half-typed "12." is never coerced to a number mid-edit.
 */

type FormState = Record<string, string>;

const EMPTY: FormState = {
  name: '',
  sku: '',
  barcode: '',
  category: '',
  brand: '',
  unit: 'unit',
  price: '',
  cost_price: '',
  mrp: '',
  stock: '0',
  reorder_level: '10',
  status: 'active',
  location: '',
  supplier_name: '',
  supplier_phone: '',
  description: '',
  image_url: '',
};

function toForm(product: Product): FormState {
  return {
    name: product.name ?? '',
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
    category: product.category ?? '',
    brand: product.brand ?? '',
    unit: product.unit ?? '',
    price: String(product.price ?? ''),
    cost_price: String(product.cost_price ?? ''),
    mrp: String(product.mrp ?? ''),
    stock: String(product.stock ?? 0),
    reorder_level: String(product.reorder_level ?? 0),
    status: product.status ?? 'active',
    location: product.location ?? '',
    supplier_name: product.supplier_name ?? '',
    supplier_phone: product.supplier_phone ?? '',
    description: product.description ?? '',
    image_url: product.image_url ?? '',
  };
}

export function ProductDrawer({
  open,
  product,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null means "create". */
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  /**
   * Reports *what happened*, not merely that the drawer is finished.
   *
   * `changed` is the interesting one: this form deliberately writes nothing
   * when nothing was edited, and until the caller could tell that apart from a
   * real save it had to either stay quiet about every save or claim one that
   * never happened.
   */
  onSaved: (result: { name: string; created: boolean; changed: boolean }) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    product ? toForm(product) : EMPTY,
  );
  // The form as it was seeded. `onSubmit` diffs against it so an untouched
  // field is left out of the PATCH entirely — see the note there.
  const [initial, setInitial] = useState<FormState>(form);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Re-seed when the drawer is opened for a different product. Keyed remounting
  // in the parent would also work; this keeps the parent simpler.
  const [seededFor, setSeededFor] = useState<number | null>(product?.id ?? null);
  if (open && (product?.id ?? null) !== seededFor) {
    const seeded = product ? toForm(product) : EMPTY;
    setSeededFor(product?.id ?? null);
    setForm(seeded);
    setInitial(seeded);
    setError('');
    setFieldErrors({});
  }

  const set = (key: string) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const price = Number(form.price || 0);
  const cost = Number(form.cost_price || 0);
  const margin = marginPercent(price, cost);

  function validate(): boolean {
    const problems: Record<string, string> = {};
    if (!form.name.trim()) problems.name = 'A name is required.';
    if (!form.price || Number.isNaN(price) || price < 0) {
      problems.price = 'Enter a selling price.';
    }
    const mrp = Number(form.mrp || 0);
    if (mrp && price && mrp < price) {
      // The backend refuses this too. Catching it here explains it beside the
      // field instead of as a banner at the top of a long form.
      problems.mrp = 'MRP cannot be below the selling price.';
    }
    setFieldErrors(problems);
    return Object.keys(problems).length === 0;
  }

  async function onUpload(file: File) {
    setUploading(true);
    setError('');
    try {
      set('image_url')(await uploadProductImage(file));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!validate()) return;

    // Empty strings become null, so an optional field cleared in the form is
    // actually cleared rather than stored as "".
    const text = (value: string) => (value.trim() ? value.trim() : null);
    const body = {
      name: form.name.trim(),
      sku: text(form.sku),
      barcode: text(form.barcode),
      category: text(form.category),
      brand: text(form.brand),
      unit: text(form.unit),
      price: form.price || '0',
      cost_price: form.cost_price || '0',
      mrp: form.mrp || form.price || '0',
      stock: Number(form.stock || 0),
      reorder_level: Number(form.reorder_level || 0),
      status: form.status,
      location: text(form.location),
      supplier_name: text(form.supplier_name),
      supplier_phone: text(form.supplier_phone),
      description: text(form.description),
      image_url: text(form.image_url),
    } as unknown as Partial<Product>;

    // Assembling every column and PATCHing all of it is a PUT wearing a
    // different verb: `stock` would ride along at the value the form was seeded
    // with, and two units sold while the drawer was open would be written back
    // onto the shelf. Every key above is also a key of FormState, so comparing
    // the two string records tells us exactly which fields the user touched —
    // an untouched field is byte-identical and never reaches the request.
    const changed = Object.fromEntries(
      Object.entries(body).filter(([key]) => form[key] !== initial[key]),
    ) as Partial<Product>;

    if (product && Object.keys(changed).length === 0) {
      // Nothing to write. Saving anyway would cost an audit row saying nobody
      // changed anything.
      onSaved({ name: product.name, created: false, changed: false });
      return;
    }

    setSaving(true);
    try {
      if (product) {
        await updateProduct(product.id, changed);
      } else {
        await createProduct(body);
      }
      onSaved({ name: form.name.trim(), created: product === null, changed: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fields = caught.fieldErrors;
        if (fields) {
          setFieldErrors(
            Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.join(' ')])),
          );
        }
      }
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      wide
      onClose={onClose}
      title={product ? `Edit ${product.name}` : 'New product'}
      description={
        product
          ? 'Only the fields you change are written, so concurrent sales are safe.'
          : 'It appears in the storefront as soon as it is saved and active.'
      }
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="product-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : product ? 'Save changes' : 'Create product'}
          </button>
        </>
      }
    >
      <form id="product-form" onSubmit={onSubmit} className="space-y-5" noValidate>
        {error ? <ErrorBanner message={error} /> : null}

        <Section title="Basics">
          <Field label="Name" required error={fieldErrors.name}>
            {(props) => (
              <input
                {...props}
                className={`field ${fieldErrors.name ? 'field-invalid' : ''}`}
                value={form.name}
                onChange={(event) => set('name')(event.target.value)}
              />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" hint="Matched to a category by name.">
              {(props) => (
                <input
                  {...props}
                  className="field"
                  list="category-options"
                  value={form.category}
                  onChange={(event) => set('category')(event.target.value)}
                />
              )}
            </Field>
            <datalist id="category-options">
              {categories.map((category) => (
                <option key={category.id} value={category.name} />
              ))}
            </datalist>

            <Field label="Brand">
              {(props) => (
                <input
                  {...props}
                  className="field"
                  value={form.brand}
                  onChange={(event) => set('brand')(event.target.value)}
                />
              )}
            </Field>

            <Field label="Unit" hint="How it is sold: 1 L, 500 g, each.">
              {(props) => (
                <input
                  {...props}
                  className="field"
                  value={form.unit}
                  onChange={(event) => set('unit')(event.target.value)}
                />
              )}
            </Field>

            <Field label="Status">
              {(props) => (
                <select
                  {...props}
                  className="field"
                  value={form.status}
                  onChange={(event) => set('status')(event.target.value)}
                >
                  <option value="active">Active — on sale</option>
                  <option value="inactive">Inactive — hidden from the store</option>
                </select>
              )}
            </Field>
          </div>
        </Section>

        <Section title="Pricing">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Selling price" required error={fieldErrors.price}>
              {(props) => (
                <input
                  {...props}
                  className={`field ${fieldErrors.price ? 'field-invalid' : ''}`}
                  inputMode="decimal"
                  value={form.price}
                  onChange={(event) => set('price')(event.target.value)}
                />
              )}
            </Field>

            <Field label="MRP" hint="Struck through in the store." error={fieldErrors.mrp}>
              {(props) => (
                <input
                  {...props}
                  className={`field ${fieldErrors.mrp ? 'field-invalid' : ''}`}
                  inputMode="decimal"
                  value={form.mrp}
                  onChange={(event) => set('mrp')(event.target.value)}
                />
              )}
            </Field>

            <Field label="Cost price" hint="Never shown to customers.">
              {(props) => (
                <input
                  {...props}
                  className="field"
                  inputMode="decimal"
                  value={form.cost_price}
                  onChange={(event) => set('cost_price')(event.target.value)}
                />
              )}
            </Field>
          </div>

          {margin !== null ? (
            <p className="text-xs text-ink-faint">
              Margin{' '}
              <span className="numeric font-semibold text-ink">{margin.toFixed(1)}%</span> on
              the selling price.
            </p>
          ) : null}
        </Section>

        <Section title="Stock">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Units in stock"
              hint={
                product
                  ? 'Saved on its own, so a sale during this edit is not overwritten.'
                  : undefined
              }
            >
              {(props) => (
                <input
                  {...props}
                  className="field"
                  type="number"
                  min={0}
                  value={form.stock}
                  onChange={(event) => set('stock')(event.target.value)}
                />
              )}
            </Field>

            <Field label="Reorder level" hint="Below this, it is flagged as low.">
              {(props) => (
                <input
                  {...props}
                  className="field"
                  type="number"
                  min={0}
                  value={form.reorder_level}
                  onChange={(event) => set('reorder_level')(event.target.value)}
                />
              )}
            </Field>
          </div>
        </Section>

        <Section title="Image">
          <div className="flex items-center gap-3">
            {form.image_url ? (
              /* Plain <img>, not next/image: the image host comes from
                 NEXT_PUBLIC_API_URL and is only known at runtime, so
                 `images.remotePatterns` cannot be configured at build time
                 without baking the hostname into the bundle. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={assetUrl(form.image_url)}
                alt=""
                className="h-16 w-16 rounded-[0.4rem] border border-line object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-[0.4rem] border border-dashed border-line text-2xs text-ink-faint">
                None
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
              >
                <Upload size={13} aria-hidden="true" />
                {uploading ? 'Uploading…' : 'Upload image'}
              </button>
              {form.image_url ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => set('image_url')('')}
                >
                  Remove
                </button>
              ) : null}
              <p className="text-2xs text-ink-faint">JPEG, PNG, WebP or GIF, up to 5 MB.</p>
            </div>
          </div>
        </Section>

        <Section title="Supply and description">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SKU">
              {(props) => (
                <input
                  {...props}
                  className="field mono"
                  value={form.sku}
                  onChange={(event) => set('sku')(event.target.value)}
                />
              )}
            </Field>
            <Field label="Shelf location">
              {(props) => (
                <input
                  {...props}
                  className="field"
                  value={form.location}
                  onChange={(event) => set('location')(event.target.value)}
                />
              )}
            </Field>
            <Field label="Supplier">
              {(props) => (
                <input
                  {...props}
                  className="field"
                  value={form.supplier_name}
                  onChange={(event) => set('supplier_name')(event.target.value)}
                />
              )}
            </Field>
            <Field label="Supplier phone">
              {(props) => (
                <input
                  {...props}
                  className="field"
                  value={form.supplier_phone}
                  onChange={(event) => set('supplier_phone')(event.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label="Description">
            {(props) => (
              <textarea
                {...props}
                className="field"
                rows={3}
                value={form.description}
                onChange={(event) => set('description')(event.target.value)}
              />
            )}
          </Field>
        </Section>
      </form>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}
