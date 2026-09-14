'use client';

import { useState } from 'react';

import { assetUrl, errorMessage } from '@/lib/api';
import { uploadProductImage } from '@/lib/queries';

/**
 * A picture and the two things you can do to it: replace it, or drop it.
 *
 * One component for products, categories and promotions, because the three
 * pickers had drifted — one cleared its error before uploading, one could not
 * remove a picture at all, one let you save mid-upload. The uploads endpoint
 * stores a file and hands back a relative `/uploads/<name>` path; nothing
 * about it is product-specific, and `assetUrl` puts the host back for display.
 */
export function ImageField({
  label,
  value,
  onChange,
  onError,
  onBusy,
  hint = 'JPEG, PNG, WebP or GIF, up to 5 MB.',
  shape = 'square',
}: {
  label: string;
  /** The stored relative path, or '' for none. */
  value: string;
  onChange: (imageUrl: string) => void;
  /** Where an upload failure is shown — the drawer's own error banner. */
  onError: (message: string) => void;
  /** Fires on the way into and out of an upload, so the form can hold Save. */
  onBusy?: (uploading: boolean) => void;
  hint?: string;
  /** Square for a tile, wide for a banner. Only the preview changes. */
  shape?: 'square' | 'wide';
}) {
  const [uploading, setUploading] = useState(false);
  const preview = shape === 'wide' ? 'h-14 w-24' : 'h-16 w-16';

  async function upload(file: File) {
    setUploading(true);
    onBusy?.(true);
    onError('');
    try {
      onChange(await uploadProductImage(file));
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setUploading(false);
      onBusy?.(false);
    }
  }

  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        {value ? (
          /* Plain <img>, not next/image: the image host comes from
             NEXT_PUBLIC_MEDIA_URL and is only known at runtime, so
             `images.remotePatterns` cannot be configured at build time
             without baking the hostname into the bundle. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetUrl(value)}
            alt=""
            className={`${preview} rounded-[0.4rem] border border-line object-cover`}
          />
        ) : (
          <div
            className={`${preview} flex items-center justify-center rounded-[0.4rem] border border-dashed border-line text-2xs text-ink-faint`}
          >
            None
          </div>
        )}

        <div>
          <div className="flex items-center gap-1.5">
            <label
              className={`btn btn-secondary btn-sm ${uploading ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}
            >
              {uploading ? 'Uploading…' : value ? 'Replace' : 'Upload'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  // So choosing the same file again still fires a change.
                  event.target.value = '';
                }}
              />
            </label>
            {value && !uploading ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('')}>
                Remove
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-2xs text-ink-faint">{hint}</p>
        </div>
      </div>
    </div>
  );
}
