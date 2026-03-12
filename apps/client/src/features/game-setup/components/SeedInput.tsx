/**
 * SeedInput — optional numeric input for deterministic RNG seeding.
 * When left empty, the engine generates a random seed.
 */
import { type ReactNode, type ChangeEvent, useCallback } from 'react';

interface SeedInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
}

export function SeedInput({ value, onChange }: SeedInputProps): ReactNode {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      // Allow only digits
      const raw = e.target.value.replace(/\D/g, '');
      onChange(raw);
    },
    [onChange],
  );

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="seed-input"
        className="text-[9px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] font-body"
      >
        Seed (optional)
      </label>
      <input
        id="seed-input"
        type="text"
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        placeholder="Random"
        data-testid="seed-input"
        className="
          w-32 px-3 py-2 rounded-[var(--radius-md)] border-2 font-mono text-sm
          bg-[var(--color-surface-alt)] text-[var(--color-text)]
          border-[var(--color-border)]
          focus:border-[var(--color-accent-muted)] focus:shadow-[var(--shadow-glow)]
          placeholder:text-[var(--color-text-faint)]
        "
      />
    </div>
  );
}
