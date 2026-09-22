/** The favicon and every in-app brand mark share the generated Alune portrait. */
import favicon from '../assets/favicon.png';

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
