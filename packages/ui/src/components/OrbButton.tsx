import { Button } from 'antd';
import type { ButtonProps } from 'antd';
import { DialogIcon } from './DialogIcons';
import type { DialogIconName } from './DialogIcons';
import { MoonLoader } from './MoonLoader';

/**
 * Dialog action whose icon sits in a trailing orb. While `loading`, the orb shows the
 * moon loader and the button ignores clicks without dropping focus.
 */
export function OrbButton({
  icon,
  loading,
  className,
  children,
  onClick,
  ...props
}: OrbButtonProps) {
  return (
    <Button
      type="primary"
      {...props}
      aria-busy={loading || undefined}
      className={['has-orb', loading ? 'is-busy' : '', className ?? ''].filter(Boolean).join(' ')}
      onClick={(event) => {
        if (!loading) onClick?.(event);
      }}
    >
      <span>{children}</span>
      <span className="dlg-orb" aria-hidden="true">
        {loading ? <MoonLoader /> : <DialogIcon name={icon} />}
      </span>
    </Button>
  );
}

export type OrbButtonProps = Omit<ButtonProps, 'icon' | 'loading' | 'iconPlacement'> & {
  icon: DialogIconName;
  loading?: boolean;
};
