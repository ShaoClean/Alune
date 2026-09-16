/** The favicon and every in-app brand mark share the generated compact artwork. */
export function BrandIcon({ className = 'app-brand__mark' }: { className?: string }) {
  return (
    <img
      className={className}
      src="/favicon.svg"
      alt=""
      aria-hidden="true"
      width={34}
      height={34}
      draggable={false}
    />
  );
}
