import type { ComponentProps } from 'react';

const sizes = { small: 14, default: 20, large: 32 } as const;

export type MoonLoaderProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** small 14px · default 20px · large 32px, or any pixel size. Omit to follow the host (Spin, orb). */
  size?: keyof typeof sizes | number;
  /** Announced as a status; without it the loader is decorative. */
  label?: string;
};

/** Moon-phase loader: the lit edge circles once per 900ms. Spin and Button use it by default. */
export function MoonLoader({ size, label, className, style, ...props }: MoonLoaderProps) {
  // Spin clones its indicator with `percent`; keep it off the DOM.
  const { percent: _percent, ...rest } = props as typeof props & { percent?: unknown };
  const fontSize = size === undefined ? undefined : typeof size === 'number' ? size : sizes[size];
  return (
    <span
      {...rest}
      className={className ? `dlg-moonload ${className}` : 'dlg-moonload'}
      style={fontSize === undefined ? style : { fontSize, ...style }}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
