'use client';

import { daysAgo, today } from '@/lib/format';

/**
 * A from/to pair with a row of presets, for the screens that bucket by date.
 *
 * Analytics and cash both want the same control; the only thing that differs
 * is which presets a screen offers. A preset of `days` covers today and the
 * `days - 1` before it, so "7 days" is a week ending now and "Today" is one.
 */
export interface DateRangeValue {
  from: string;
  to: string;
}

export function DateRange({
  value,
  onChange,
  presets,
}: {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  presets: { label: string; days: number }[];
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex rounded-[0.4rem] bg-raised p-0.5">
        {presets.map((preset) => (
          <button
            key={preset.days}
            type="button"
            className="rounded-[0.3rem] px-2.5 py-1 text-xs font-medium text-ink-faint transition-colors hover:text-ink"
            onClick={() => onChange({ from: daysAgo(preset.days - 1), to: today() })}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        className="field w-36"
        aria-label="From date"
        value={value.from}
        max={value.to}
        onChange={(event) => onChange({ ...value, from: event.target.value })}
      />
      <input
        type="date"
        className="field w-36"
        aria-label="To date"
        value={value.to}
        min={value.from}
        onChange={(event) => onChange({ ...value, to: event.target.value })}
      />
    </div>
  );
}
