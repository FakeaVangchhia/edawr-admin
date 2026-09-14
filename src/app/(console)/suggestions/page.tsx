'use client';

import { useState } from 'react';

import { RequireCapability } from '@/components/shell/RequireCapability';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  Pagination,
  Panel,
  TableSkeleton,
} from '@/components/ui';
import { dateTime, phone } from '@/lib/format';
import { listSuggestions } from '@/lib/queries';
import { useResource } from '@/lib/use-resource';

const PAGE_SIZE = 50;

export default function SuggestionsPage() {
  return (
    <RequireCapability capability="suggestions">
      <Suggestions />
    </RequireCapability>
  );
}

/**
 * What customers typed into "What would you want delivered in 15 minutes?"
 *
 * Read-only in the strongest sense — there is no delete, no reply and no
 * endpoint behind either. The number beside a signed-in answer is how the
 * store follows up, and it follows up on the phone. Everything else is a
 * guest, and a guest's answer is worth exactly as much as an account's.
 */
function Suggestions() {
  const [offset, setOffset] = useState(0);
  const suggestions = useResource(`suggestions:${offset}`, (signal) =>
    listSuggestions({ limit: PAGE_SIZE, offset }, signal),
  );

  const rows = suggestions.data?.rows ?? [];
  const total = suggestions.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Suggestions"
        description="Answers to the poll on the storefront home — what people say they would want delivered in 15 minutes."
      />

      {suggestions.error ? (
        <div className="mb-4">
          <ErrorBanner message={suggestions.error} onRetry={suggestions.refresh} />
        </div>
      ) : null}

      <Panel flush>
        {suggestions.loading && !suggestions.data ? (
          <TableSkeleton columns={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            description="The sticker on the storefront home collects these. Answers appear here the moment a customer sends one."
          />
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Suggestions table">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Suggestion</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap text-2xs text-ink-soft">
                      {dateTime(row.created_at)}
                    </td>
                    <td className="max-w-xl">{row.text}</td>
                    <td className="whitespace-nowrap text-ink-soft">
                      {row.customer_phone ? (
                        <>
                          {row.customer_name ? (
                            <span className="block text-ink">{row.customer_name}</span>
                          ) : null}
                          <span className="num text-2xs">{phone(row.customer_phone)}</span>
                        </>
                      ) : (
                        <span className="text-ink-faint">Guest</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              total={total}
              limit={PAGE_SIZE}
              offset={offset}
              onOffset={setOffset}
              noun="suggestions"
            />
          </div>
        )}
      </Panel>
    </>
  );
}
