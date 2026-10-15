export function ProgressBar({
  percent,
  label,
  compact = false,
}: {
  percent: number;
  label?: string;
  compact?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="w-full">
      {label && (
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="meta">{label}</span>
          <span className="font-mono text-xs tabular-nums">{clamped}%</span>
        </div>
      )}
      <div
        className="bar"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <span style={{ width: `${clamped}%` }} />
      </div>
      {!compact && null}
    </div>
  );
}