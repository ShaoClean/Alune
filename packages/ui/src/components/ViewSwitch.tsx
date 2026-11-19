import type { ReactNode } from 'react';

export interface ViewSwitchProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly {
    value: T;
    label: string;
    ariaLabel?: string;
    icon?: ReactNode;
    disabled?: boolean;
  }[];
  onChange: (value: T) => void;
}

export function ViewSwitch<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: ViewSwitchProps<T>) {
  return (
    <div className="collection-view-switch" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.ariaLabel}
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
