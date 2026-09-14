'use client';

import { useState } from 'react';

import { Drawer, ErrorBanner, Field } from '@/components/ui';
import { ImageField } from '@/components/ui/ImageField';
import { errorMessage } from '@/lib/api';
import {
  LINK_HINTS,
  LINK_INPUT_TYPES,
  LINK_KINDS,
  LINK_LABELS,
  LINK_PLACEHOLDERS,
  composeLink,
  linkProblem,
  parseLink,
  type LinkKind,
} from '@/lib/promo-link';
import { createPromo, promoPutBody, updatePromo } from '@/lib/queries';
import type { Promo } from '@/types';

/**
 * The form behind "New promotion" and the pencil on each row.
 *
 * Its own file rather than a function in the page, for the same reason
 * `ProductDrawer` is: a page module may only export a page, and the drawer is
 * what the test renders.
 */

/**
 * ISO from the API → the value a `datetime-local` input wants (local time,
 * no zone, minute precision). Empty for null.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** The reverse: the input's local value → ISO with the browser's zone, or null. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function PromoDrawer({
  promo,
  onClose,
  onSaved,
}: {
  promo: Promo | null;
  onClose: () => void;
  onSaved: (title: string) => void;
}) {
  const [title, setTitle] = useState(promo?.title ?? '');
  const [subtitle, setSubtitle] = useState(promo?.subtitle ?? '');
  // Kind + value rather than the stored string — see lib/promo-link.ts.
  const [initialLink] = useState(() => parseLink(promo?.link ?? null));
  const [linkKind, setLinkKind] = useState<LinkKind>(initialLink.kind);
  const [linkValue, setLinkValue] = useState(initialLink.value);
  const [sortOrder, setSortOrder] = useState(String(promo?.sort_order ?? 0));
  const [status, setStatus] = useState<Promo['status']>(promo?.status ?? 'active');
  const [startsAt, setStartsAt] = useState(toLocalInput(promo?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(promo?.ends_at ?? null));
  const [imageUrl, setImageUrl] = useState(promo?.image_url ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const linkError = linkProblem(linkKind, linkValue);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    if (linkError) {
      setError(linkError);
      return;
    }
    const starts_at = fromLocalInput(startsAt);
    const ends_at = fromLocalInput(endsAt);
    if (starts_at && ends_at && ends_at <= starts_at) {
      setError('The end has to be after the start.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const changes: Partial<Promo> = {
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        link: composeLink(linkKind, linkValue),
        sort_order: Number(sortOrder) || 0,
        status,
        starts_at,
        ends_at,
        image_url: imageUrl || null,
      };

      if (promo) {
        // Not partial — see `promoPutBody`.
        await updatePromo(promo.id, promoPutBody(promo, changes) as Partial<Promo>);
      } else {
        await createPromo(changes);
      }
      onSaved(changes.title!);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={promo ? `Edit ${promo.title}` : 'New promotion'}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {/* Disabled during an upload too: saving mid-upload would write
              the old image_url, close the drawer, and leave the new file
              orphaned in the bucket when it landed. */}
          <button
            type="submit"
            form="promo-form"
            className="btn btn-primary"
            disabled={saving || uploading}
          >
            {saving ? 'Saving…' : uploading ? 'Uploading…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="promo-form" onSubmit={onSubmit} className="space-y-3" noValidate>
        {error ? <ErrorBanner message={error} /> : null}

        <Field label="Title" required>
          {(props) => (
            <input
              {...props}
              className="field"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </Field>

        <Field label="Subtitle" hint="One line under the title. Keep it short — it sits over the picture.">
          {(props) => (
            <input
              {...props}
              className="field"
              value={subtitle}
              onChange={(event) => setSubtitle(event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <Field label="Goes to">
            {(props) => (
              <select
                {...props}
                className="field"
                value={linkKind}
                onChange={(event) => {
                  setLinkKind(event.target.value as LinkKind);
                  setLinkValue('');
                }}
              >
                {LINK_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={LINK_LABELS[linkKind]}
            hint={LINK_HINTS[linkKind]}
            error={linkError ?? undefined}
          >
            {(props) => (
              <input
                {...props}
                className="field"
                type={LINK_INPUT_TYPES[linkKind]}
                placeholder={LINK_PLACEHOLDERS[linkKind]}
                value={linkValue}
                onChange={(event) => setLinkValue(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
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

          <Field label="Status">
            {(props) => (
              <select
                {...props}
                className="field"
                value={status}
                onChange={(event) => setStatus(event.target.value as Promo['status'])}
              >
                <option value="active">Active</option>
                <option value="inactive">Hidden</option>
              </select>
            )}
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts" hint="Leave empty to start now.">
            {(props) => (
              <input
                {...props}
                className="field"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            )}
          </Field>
          <Field label="Ends" hint="Leave empty to run until hidden.">
            {(props) => (
              <input
                {...props}
                className="field"
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            )}
          </Field>
        </div>

        <ImageField
          label="Banner image"
          shape="wide"
          value={imageUrl}
          onChange={setImageUrl}
          onError={setError}
          onBusy={setUploading}
          hint="Wide works best — about 16:6, at least 1600px across. Without one the banner is the title on navy."
        />
      </form>
    </Drawer>
  );
}
