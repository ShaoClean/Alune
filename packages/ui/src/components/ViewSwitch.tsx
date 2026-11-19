import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

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
  const groupRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [thumb, setThumb] = useState<CSSProperties>();

  useLayoutEffect(() => {
    const group = groupRef.current;
    const selected = selectedRef.current;
    if (!group || !selected) {
      setThumb(undefined);
      return;
    }

    function measure() {
      if (!selected) return;
      setThumb({
        width: selected.offsetWidth,
        height: selected.offsetHeight,
        transform: `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`,
      });
    }

    measure();
    // Labels can change width or wrap the active option onto another row.
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    for (const button of group.querySelectorAll('button')) observer.observe(button);
    return () => observer.disconnect();
  }, [value, options]);

  return (
    <div ref={groupRef} className="collection-view-switch" role="group" aria-label={label}>
      {thumb && <span aria-hidden="true" className="collection-view-switch__thumb" style={thumb} />}
      {options.map((option) => (
        <button
          key={option.value}
          ref={value === option.value ? selectedRef : undefined}
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
