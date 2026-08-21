'use client';

import { useEffect, useState } from 'react';
import { quoteSignature } from '@/lib/delivery';
import { quoteBasket } from '@/lib/store-api';
import type { BasketQuote, CartLine, DeliveryType } from '@/types';

/**
 * What this basket costs, according to the server.
 *
 * The **only** source of money figures in the storefront. The cart and the
 * checkout both read from here, so the number a customer sees before paying is
 * produced by the same code that will charge them.
 *
 * The quote is keyed on a signature of the basket *and* the chosen speed —
 * switching tier changes the bill without changing a single line, and leaving
 * the tier out of the key would show one tier's price under another's
 * selection. Comparing the signature also means a response that arrives out of
 * order is discarded rather than displayed.
 */
export interface QuoteState {
  quote: BasketQuote | null;
  /** True while the current basket has no matching quote yet. */
  isLoading: boolean;
  error: string;
}

export function useQuote(lines: CartLine[], deliveryType: DeliveryType): QuoteState {
  const signature = quoteSignature(lines, deliveryType);
  const [state, setState] = useState<{
    signature: string;
    quote: BasketQuote | null;
    error: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    quoteBasket(lines, deliveryType, controller.signal)
      .then((quote) => {
        // The catch below checks this and the success path did not, so a quote
        // that resolved after the basket changed still wrote itself into state.
        // It was mostly invisible because `signature` is compared on render and
        // a stale entry is ignored — but it is a write to an unmounted tree the
        // moment the customer leaves the page mid-request.
        if (controller.signal.aborted) return;
        setState({ signature, quote, error: '' });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          signature,
          quote: null,
          error:
            caught instanceof Error
              ? caught.message
              : 'We could not price your basket just now.',
        });
      });

    return () => controller.abort();
    // `signature` is the real dependency: it changes exactly when the basket or
    // the tier does, and `lines` is a fresh array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const current = state?.signature === signature ? state : null;

  return {
    quote: current?.quote ?? null,
    // Derived, not stored — nothing sets a loading flag inside an effect.
    isLoading: current === null,
    error: current?.error ?? '',
  };
}
