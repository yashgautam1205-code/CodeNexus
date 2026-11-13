/**
 * ProgressBar — animated progress bar component
 *
 * Props:
 *   value       — number 0-100
 *   max         — denominator (default 100)
 *   label       — optional text label above bar
 *   showValue   — show percentage on the right (default true)
 *   color       — "primary" | "secondary" | "success" | "warning" | "danger" | hex string
 *   size        — "xs" | "sm" | "md"
 *   animated    — boolean, adds stripe animation (default false)
 *   className   — extra wrapper classes
 */

const COLOR_MAP = {
  primary:   { bar: "linear-gradient(90deg, #2563EB, #00A6FF)", glow: "rgba(37,99,235,0.38)" },
  secondary: { bar: "linear-gradient(90deg, #22D3EE, #00A6FF)", glow: "rgba(34,211,238,0.35)" },
  success:   { bar: "linear-gradient(90deg, #22C55E, #16a34a)", glow: "rgba(34,197,94,0.4)"   },
  warning:   { bar: "linear-gradient(90deg, #F59E0B, #D97706)", glow: "rgba(245,158,11,0.35)" },
  danger:    { bar: "linear-gradient(90deg, #EF4444, #DC2626)", glow: "rgba(239,68,68,0.35)" },
};

const SIZE_H = { xs: "h-1", sm: "h-1.5", md: "h-2.5" };

export function ProgressBar({
  value = 0,
  max = 100,
  label,
  showValue = true,
  color = "primary",
  size = "sm",
  animated = false,
  className = "",
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const cfg = COLOR_MAP[color] ?? {
    bar: `linear-gradient(90deg, ${color}, ${color})`,
    glow: `${color}40`,
  };

  return (
    <div className={`w-full ${className}`}>
      {(label !== undefined || showValue) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {label !== undefined && (
            <span className="text-xs font-medium text-slate-300">{label}</span>
          )}
          {showValue && (
            <span className="ml-auto text-xs font-semibold tabular-nums" style={{ color: "#60A5FA" }}>
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}

      {/* Track */}
      <div
        className={`w-full overflow-hidden rounded-full ${SIZE_H[size] ?? SIZE_H.sm}`}
        style={{ background: "rgba(20,36,61,0.9)" }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* Fill */}
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: cfg.bar,
            boxShadow: pct > 5 ? `0 0 8px ${cfg.glow}` : "none",
            backgroundSize: animated ? "200% 100%" : undefined,
            animation: animated && pct > 0 ? "skeletonShimmer 2s linear infinite" : undefined,
          }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
