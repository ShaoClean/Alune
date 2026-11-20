import type { SVGProps } from 'react';
import { aluneIconPaths, type AluneIconName } from './AluneIcons';

// Dialog icon names preserved for full backwards compatibility across @alune/ui, web, and website.
const dialogIconNames = [
  'x',
  'arrow-right',
  'arrow-up-right',
  'check',
  'caret',
  'warning',
  'trash',
  'info',
  'lock',
  'key',
  'server',
  'folder',
  'folder-open',
  'branch',
  'merge',
  'pr',
  'archive',
  'cloud-up',
  'cloud-down',
  'globe',
  'user',
  'mail',
  'terminal',
  'laptop',
  'search',
  'bell',
  'copy',
  'eye',
  'eye-off',
  'link',
  'sparkle',
  'sliders',
  'columns',
  'download',
  'moon',
  'sun',
  'wave',
  'file',
  'file-plus',
  'refresh',
  'plus',
  'pencil',
  'swap',
  'shield',
  'plug',
  'tree',
  'commit',
  'chat',
  'dots',
  'clock',
  'undo',
] as const satisfies readonly AluneIconName[];

export type DialogIconName = (typeof dialogIconNames)[number];

export function DialogIcon({
  name,
  className,
  ...rest
}: { name: DialogIconName } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className ? `dlg-ic ${className}` : 'dlg-ic'}
      {...rest}
    >
      {aluneIconPaths[name]}
    </svg>
  );
}

export type DialogIconProps = { name: DialogIconName } & Omit<SVGProps<SVGSVGElement>, 'name'>;
