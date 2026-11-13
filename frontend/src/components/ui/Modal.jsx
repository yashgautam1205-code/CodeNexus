/**
 * Modal — reusable modal dialog with animated backdrop
 *
 * Props:
 *   open        — boolean, controls visibility
 *   onClose     — called when backdrop or Esc pressed
 *   title       — modal heading (string | node)
 *   description — optional subtitle
 *   children    — body content
 *   footer      — optional footer node (action buttons, etc.)
 *   size        — "sm" | "md" | "lg" | "xl"  (default "md")
 */
import { useEffect } from "react";
import { X } from "lucide-react";

const SIZE_MAP = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({ open, onClose, title, description, children, footer, size = "md" }) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(5,11,24,0.76)", backdropFilter: "blur(6px)", animation: "fadeIn 0.2s ease-out" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={`relative z-10 w-full ${SIZE_MAP[size] ?? SIZE_MAP.md} rounded-2xl shadow-2xl`}
        style={{
          background: "#101D33",
          border: "1px solid rgba(120,160,220,0.2)",
          animation: "slideInUp 0.25s ease-out both",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4" style={{ borderColor: "rgba(120,160,220,0.12)" }}>
          <div>
            {title && <h2 className="text-base font-semibold text-white">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t px-6 py-4" style={{ borderColor: "rgba(120,160,220,0.12)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
