'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  ConfirmDialog,
  Drawer,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  Pagination,
  Panel,
  TableSkeleton,
  useToast,
} from '@/components/ui';
import { assetUrl, errorMessage } from '@/lib/api';
import {
  categoryPutBody,
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
  uploadProductImage,
} from '@/lib/queries';
import { useResource } from '@/lib/use-resource';
import type { Category } from '@/types';

const PAGE_SIZE = 25;

export default function CategoriesPage() {
  const [offset, setOffset] = useState(0);
  // The offset is part of the resource key, so paging is a refetch rather than
  // a slice of something already in memory — same pattern as /products.
  const categories = useResource(`categories:${offset}`, (signal) =>
    listCategories({ limit: PAGE_SIZE, offset }, signal),
  );
  const refresh = useCallback(() => categories.refresh(), [categories]);

  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const toast = useToast();

  const rows = categories.data?.rows ?? [];
  const total = categories.data?.total ?? 0;

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setActionError('');
    try {
      await deleteCategory(deleting.id);
      toast.success(`${deleting.name} removed from the storefront rail.`);
      setDeleting(null);
      refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Categories"
        description="The rail customers browse by. Order here is the order they see."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            New category
          </button>
        }
      />

      {actionError ? (
        <div className="mb-4">
          <ErrorBanner message={actionError} />
        </div>
      ) : null}
      {categories.error ? (
        <div className="mb-4">
          <ErrorBanner message={categories.error} onRetry={refresh} />
        </div>
      ) : null}

      <Panel flush>
        {categories.loading && !categories.data ? (
          <TableSkeleton columns={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description="Products can exist without one, but customers browse by category — the storefront rail is empty until you add some."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} aria-hidden="true" />
                New category
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Categories table">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Parent</th>
                  <th className="num">Order</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((category) => {
                  const parent = rows.find((row) => row.id === category.parent_id);
                  return (
                    <tr key={category.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          {category.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={assetUrl(category.image_url)}
                              alt=""
                              className="h-8 w-8 rounded-[0.3rem] border border-line object-cover"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-[0.3rem] border border-dashed border-line" />
                          )}
                          <div>
                            <p className="font-medium">{category.name}</p>
                            {category.description ? (
                              <p className="text-2xs text-ink-faint">{category.description}</p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="text-ink-soft">{parent?.name ?? '—'}</td>
                      <td className="num text-ink-soft">{category.sort_order}</td>
                      <td>
                        <span
                          className={`badge ${
                            category.status === 'active' ? 'badge-ok' : 'badge-neutral'
                          }`}
                        >
                          {category.status === 'active' ? 'Active' : 'Hidden'}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setEditing(category)}
                            aria-label={`Edit ${category.name}`}
                          >
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm text-danger"
                            onClick={() => setDeleting(category)}
                            aria-label={`Delete ${category.name}`}
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              total={total}
              limit={PAGE_SIZE}
              offset={offset}
              onOffset={setOffset}
              noun="categories"
            />
          </div>
        )}
      </Panel>

      {creating || editing ? (
        <CategoryDrawer
          category={editing}
          all={rows}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(name) => {
            toast.success(editing ? `${name} saved.` : `${name} added to the rail.`);
            setCreating(false);
            setEditing(null);
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
        message="Products in this category keep their category label and stay on sale — but customers lose the rail entry that leads to them. Sub-categories are moved to the top level rather than deleted."
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}

function CategoryDrawer({
  category,
  all,
  onClose,
  onSaved,
}: {
  category: Category | null;
  all: Category[];
  onClose: () => void;
  /** Passes the saved name back so the caller can confirm it by name. */
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [parentId, setParentId] = useState(String(category?.parent_id ?? ''));
  const [sortOrder, setSortOrder] = useState(String(category?.sort_order ?? 0));
  const [status, setStatus] = useState(category?.status ?? 'active');
  const [imageUrl, setImageUrl] = useState(category?.image_url ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const renaming = category !== null && name.trim() !== category.name;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('A name is required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const changes = {
        name: name.trim(),
        description: description.trim() || null,
        parent_id: parentId ? Number(parentId) : null,
        sort_order: Number(sortOrder) || 0,
        status: status as Category['status'],
        image_url: imageUrl || null,
      };

      if (category) {
        // The category PUT is *not* partial: every omitted field is reset to
        // its serializer default. `categoryPutBody` sends the whole row, which
        // is the only reason editing a name here does not silently wipe the
        // category's image and its position in the rail.
        await updateCategory(category.id, categoryPutBody(category, changes) as Partial<Category>);
      } else {
        await createCategory(changes as Partial<Category>);
      }
      onSaved(changes.name);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(file: File) {
    setUploading(true);
    try {
      // The uploads endpoint is shared — it stores a file and returns a
      // relative path; nothing about it is product-specific.
      setImageUrl(await uploadProductImage(file));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={category ? `Edit ${category.name}` : 'New category'}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="category-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="category-form" onSubmit={onSubmit} className="space-y-3" noValidate>
        {error ? <ErrorBanner message={error} /> : null}

        <Field label="Name" required>
          {(props) => (
            <input
              {...props}
              className="field"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        {renaming ? (
          <p className="rounded-[0.4rem] border border-info bg-info-quiet px-3 py-2 text-xs text-info">
            Products currently in <strong>{category!.name}</strong> will be moved to{' '}
            <strong>{name.trim()}</strong> in the same operation, so none of them are orphaned.
          </p>
        ) : null}

        <Field label="Description">
          {(props) => (
            <textarea
              {...props}
              className="field"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Parent category">
            {(props) => (
              <select
                {...props}
                className="field"
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
              >
                <option value="">None — top level</option>
                {all
                  .filter((row) => row.id !== category?.id)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>

          <Field label="Sort order" hint="Lower numbers appear first.">
            {(props) => (
              <input
                {...props}
                className="field"
                type="number"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Status">
          {(props) => (
            <select
              {...props}
              className="field"
              value={status}
              onChange={(event) => setStatus(event.target.value as Category['status'])}
            >
              <option value="active">Active</option>
              <option value="inactive">Hidden</option>
            </select>
          )}
        </Field>

        <div>
          <span className="label">Rail image</span>
          <div className="flex items-center gap-3">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={assetUrl(imageUrl)}
                alt=""
                className="h-14 w-14 rounded-[0.4rem] border border-line object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-[0.4rem] border border-dashed border-line text-2xs text-ink-faint">
                None
              </div>
            )}
            <div>
              <label className="btn btn-secondary btn-sm cursor-pointer">
                {uploading ? 'Uploading…' : 'Upload'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUpload(file);
                    event.target.value = '';
                  }}
                />
              </label>
              <p className="mt-1 text-2xs text-ink-faint">
                Without one, the storefront falls back to an emoji.
              </p>
            </div>
          </div>
        </div>
      </form>
    </Drawer>
  );
}
