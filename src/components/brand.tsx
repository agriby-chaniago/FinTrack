// FinTrack brand: the square app mark before the name (owner review of S15).
// The mark is decorative; the name is always written next to it.
export function Brand({ className = "", markClassName = "size-6" }: { className?: string; markClassName?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 512 512" className={`${markClassName} shrink-0`}>
        <rect width="512" height="512" className="fill-primary" />
        <g className="fill-primary-content">
          <rect x="150" y="160" width="212" height="44" />
          <rect x="150" y="234" width="150" height="44" />
          <rect x="150" y="308" width="96" height="44" />
        </g>
      </svg>
      FinTrack
    </span>
  );
}
