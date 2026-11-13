/**
 * Badge — flexible badge / chip component
 *
 * Props:
 *   children  — content
 *   variant   — "default" | "primary" | "secondary" | "success" | "warning" | "danger" | "outline"
 *   size      — "sm" | "md"
 *   dot       — boolean, prepend a coloured dot
 *   className — extra classes
 */

const VARIANTS = {
  default:   { background: "rgba(20,36,61,0.9)",     border: "rgba(120,160,220,0.2)",  color: "#94A3B8" },
  primary:   { background: "rgba(37,99,235,0.15)",   border: "rgba(37,99,235,0.35)",   color: "#60A5FA" },
  secondary: { background: "rgba(0,166,255,0.15)",   border: "rgba(0,166,255,0.35)",   color: "#38BDF8" },
  success:   { background: "rgba(34,197,94,0.15)",   border: "rgba(34,197,94,0.35)",   color: "#22C55E" },
  warning:   { background: "rgba(245,158,11,0.15)",  border: "rgba(245,158,11,0.35)",  color: "#F59E0B" },
  danger:    { background: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.35)",   color: "#EF4444" },
  outline:   { background: "transparent",             border: "rgba(120,160,220,0.3)",   color: "#60A5FA" },
};

const SIZES = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
};

export function Badge({ children, variant = "default", size = "sm", dot = false, className = "" }) {
  const v = VARIANTS[variant] ?? VARIANTS.default;
  const s = SIZES[size] ?? SIZES.sm;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold capitalize ${s} ${className}`}
      style={{ background: v.background, border: `1px solid ${v.border}`, color: v.color }}
    >
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: v.color }}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

export default Badge;
