'use client';

import { Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ProductDrawer } from '@/components/products/ProductDrawer';
import {
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Pagination,
  Panel,
  StockBadge,
  TableSkeleton,
  useToast,
} from '@/components/ui';
import { assetUrl, errorMessage } from '@/lib/api';
import { count, marginPercent, money } from '@/lib/format';
import { deleteProduct, listCategories, listProducts, updateProduct } from '@/lib/queries';
import { useDebounced, useResource } from '@/lib/use-resource';
import type { Product } from '@/types';

const PAGE_SIZE = 25;

export default function ProductsPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [stock, setStock] = useState<'' | 'low' | 'out'>('');
  const [offset, setOffset] = useState(0);

  const [editing, setEditing] = useState<Product | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const toast = useToast();
  const debouncedSearch = useDebounced(search);

  const filters = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      category: category || undefined,
      status: status || undefined,
      stock: stock || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [debouncedSearch, category, status, stock, offset],
  );

  const key = JSON.stringify(filters);
  const products = useResource(key, (signal) => listProducts(filters, signal));
  // The whole list, explicitly: this feeds a filter <select>, and a paged
  // dropdown is a filter that silently cannot reach half the catalogue.
  const categories = useResource('category-options', (signal) =>
    listCategories({ limit: 200 }, signal),
  );

  const refresh = useCallback(() => products.refresh(), [products]);

  const rows = products.data?.rows ?? [];
  const total = products.data?.total ?? 0;

  // Four boxes narrow this table and three of them are dropdowns, which is
  // exactly the shape of filter that gets left set from yesterday and then
  // explains an empty screen nobody can account for.
  const activeFilters = [search, category, status, stock].filter(Boolean).length;

  function clearFilters() {
    setSearch('');
    setCategory('');
    setStatus('');
    setStock('');
    setOffset(0);
  }

  function filtered<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setOffset(0);
    };
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setActionError('');
    try {
      await deleteProduct(deleting.id);
      toast.success(`${deleting.name} deleted.`);
      setDeleting(null);
      refresh();
    } catch (caught) {
      // A 409 here is the backend refusing to rewrite order history: the
      // product appears in past orders. Its message says to deactivate instead,
      // and it is shown verbatim because it is better advice than anything the
      // console could invent.
      setActionError(errorMessage(caught));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything here is what the storefront sells. Nothing is hardcoded."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setDrawerOpen(true);
            }}
          >
            <Plus size={14} aria-hidden="true" />
            New product
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <input
            className="field pl-8"
            placeholder="Search name, SKU, brand or category"
            aria-label="Search products"
            value={search}
            onChange={(event) => filtered(setSearch)(event.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="category-filter">
            Category
          </label>
          <select
            id="category-filter"
            className="field w-44"
            value={category}
            onChange={(event) => filtered(setCategory)(event.target.value)}
          >
            <option value="">All categories</option>
            {(categories.data?.rows ?? []).map((row) => (
              <option key={row.id} value={row.name}>
                {row.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="stock-filter">
            Stock
          </label>
          <select
            id="stock-filter"
            className="field w-36"
            value={stock}
            onChange={(event) => filtered(setStock)(event.target.value as '' | 'low' | 'out')}
          >
            <option value="">Any level</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
        </div>

        <div>
          <label className="label" htmlFor="status-filter">
            Status
          </label>
          <select
            id="status-filter"
            className="field w-32"
            value={status}
            onChange={(event) => filtered(setStatus)(event.target.value)}
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Shown only when something is set. Nothing to clear, nothing to read. */}
        {activeFilters > 0 ? (
          <button type="button" className="btn btn-ghost h-[2.125rem]" onClick={clearFilters}>
            <X size={13} aria-hidden="true" />
            Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
          </button>
        ) : null}
      </div>

      {actionError ? (
        <div className="mb-4">
          <ErrorBanner message={actionError} />
        </div>
      ) : null}
      {products.error ? (
        <div className="mb-4">
          <ErrorBanner message={products.error} onRetry={refresh} />
        </div>
      ) : null}

      <Panel flush>
        {products.loading && !products.data ? (
          <TableSkeleton columns={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={activeFilters > 0 ? 'Nothing matches' : 'No products yet'}
            description={
              activeFilters > 0
                ? 'The catalogue is not empty — these filters are hiding all of it.'
                : 'Add your first product and it appears in the storefront immediately.'
            }
            action={
              activeFilters > 0 ? (
                <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setEditing(null);
                    setDrawerOpen(true);
                  }}
                >
                  <Plus size={14} aria-hidden="true" />
                  New product
                </button>
              )
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th className="num">Price</th>
                    <th className="num">Margin</th>
                    <th className="num">Stock</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      onEdit={() => {
                        setEditing(product);
                        setDrawerOpen(true);
                      }}
                      onDelete={() => setDeleting(product)}
                      onSaved={refresh}
                      onError={setActionError}
                      onSuccess={toast.success}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              total={total}
              limit={PAGE_SIZE}
              offset={offset}
              onOffset={setOffset}
              noun="products"
            />
          </>
        )}
      </Panel>

      {drawerOpen ? (
        <ProductDrawer
          open
          product={editing}
          categories={categories.data?.rows ?? []}
          onClose={() => setDrawerOpen(false)}
          onSaved={(result) => {
            setDrawerOpen(false);
            if (!result.changed) {
              // The form found nothing to write. Saying so is the point: a
              // drawer that shuts in silence looks identical whether it saved
              // or decided there was nothing to save.
              toast.info(`Nothing changed on ${result.name}.`);
            } else {
              toast.success(
                result.created
                  ? `${result.name} added — it is on the storefront now.`
                  : `${result.name} saved.`,
              );
            }
            refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        destructive
        busy={busy}
        title={`Delete ${deleting?.name}?`}
        confirmLabel="Delete"
        message="If this product appears in any past order it cannot be deleted — set it to inactive instead, which hides it from the store without rewriting history."
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}

function ProductRow({
  product,
  onEdit,
  onDelete,
  onSaved,
  onError,
  onSuccess,
}: {
  product: Product;
  onEdit: () => void;
  onDelete: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const margin = marginPercent(product.price, product.cost_price);

  return (
    <tr>
      <td>
        <div className="flex items-center gap-2.5">
          {product.image_url ? (
            /* Product images use a plain <img>, not next/image: the host comes
               from NEXT_PUBLIC_API_URL and is only known at runtime, so
               `images.remotePatterns` cannot be configured at build time
               without baking the hostname into the bundle. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={assetUrl(product.image_url)}
              alt=""
              className="h-8 w-8 shrink-0 rounded-[0.3rem] border border-line object-cover"
            />
          ) : (
            <div className="h-8 w-8 shrink-0 rounded-[0.3rem] border border-dashed border-line" />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{product.name}</p>
            <p className="truncate text-2xs text-ink-faint">
              {product.brand ? `${product.brand} · ` : ''}
              {product.unit ?? ''}
              {product.sku ? ` · ${product.sku}` : ''}
            </p>
          </div>
        </div>
      </td>

      <td className="text-ink-soft">{product.category ?? '—'}</td>

      <td className="num">
        <span className="font-medium">{money(product.price)}</span>
        {product.mrp > product.price ? (
          <span className="block text-2xs text-ink-faint line-through">
            {money(product.mrp)}
          </span>
        ) : null}
      </td>

      {/* Margin is Manager-visible by design — they price the shelf. It is
          absent from the public serializer entirely, so it cannot leak. */}
      <td className="num text-ink-soft">{margin === null ? '—' : `${margin.toFixed(0)}%`}</td>

      <td className="num">
        <StockCell
          product={product}
          onSaved={onSaved}
          onError={onError}
          onSuccess={onSuccess}
        />
      </td>

      <td>
        <StockBadge stock={product.stock} reorderLevel={product.reorder_level} />
        {product.status === 'inactive' ? (
          <span className="badge badge-neutral ml-1">Hidden</span>
        ) : null}
      </td>

      <td>
        <div className="flex justify-end gap-1">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit} aria-label={`Edit ${product.name}`}>
            <Pencil size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-danger"
            onClick={onDelete}
            aria-label={`Delete ${product.name}`}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Inline stock editing.
 *
 * A stock count is the field a manager changes most often and the one that is
 * least worth opening a form for. It PATCHes only `stock`, so it cannot
 * overwrite a price someone else is editing at the same moment — and equally,
 * it cannot be overwritten by them.
 */
function StockCell({
  product,
  onSaved,
  onError,
  onSuccess,
}: {
  product: Product;
  onSaved: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(product.stock));
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0) {
      onError('Stock must be zero or more.');
      return;
    }
    if (next === product.stock) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updateProduct(product.id, { stock: next } as Partial<Product>);
      // Named, because this is the one edit made without opening anything: the
      // cell goes back to looking exactly like the cell beside it, and on a
      // table of twenty-five rows there is otherwise nothing to say which
      // number was the one that took.
      onSuccess(`${product.name}: ${count(next)} in stock.`);
      setEditing(false);
      onSaved();
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="numeric rounded px-1 font-medium hover:bg-hover"
        onClick={() => {
          setValue(String(product.stock));
          setEditing(true);
        }}
        aria-label={`Edit stock for ${product.name}, currently ${count(product.stock)}`}
      >
        {count(product.stock)}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <input
        className="field h-7 w-16 text-right"
        type="number"
        min={0}
        autoFocus
        value={value}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
          if (event.key === 'Escape') setEditing(false);
        }}
        aria-label="Units in stock"
      />
      <button type="button" className="btn btn-ghost btn-sm" onClick={save} disabled={saving} aria-label="Save stock">
        <Check size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setEditing(false)}
        aria-label="Cancel"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
