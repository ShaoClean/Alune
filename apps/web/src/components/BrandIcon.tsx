/** The favicon and every in-app brand mark share the generated compact artwork. */
import favicon from '../assets/favicon.svg';

export function BrandIcon({ className = 'app-brand__mark' }: { className?: string }) {
  return (
    <img
      className={className}
      src={favicon}
      alt=""
      aria-hidden="true"
      width={34}
      height={34}
      draggable={false}
    />
  );
}
