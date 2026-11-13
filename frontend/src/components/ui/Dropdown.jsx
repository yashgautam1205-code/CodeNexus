/**
 * Dropdown — elegant dropdown menu component
 *
 * Props:
 *   trigger   — React node that opens the menu (button, avatar, etc.)
 *   items     — array of { label, icon?, onClick?, href?, divider?, disabled? }
 *   align     — "left" | "right"  (default "right")
 *   className — extra class for the menu panel
 */
import { useEffect, useRef, useState } from "react";

export function Dropdown({ trigger, items = [], align = "right", className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      {/* Trigger */}
      <div onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer" }}>
        {trigger}
      </div>

      {/* Menu panel */}
      {open && (
        <div
          className={`absolute z-50 mt-2 min-w-[180px] rounded-xl py-1 shadow-2xl ${align === "left" ? "left-0" : "right-0"} ${className}`}
          style={{
            background: "#0C1A30",
            border: "1px solid rgba(120,160,220,0.18)",
            backdropFilter: "blur(12px)",
            animation: "slideInUp 0.18s ease-out both",
          }}
          role="menu"
        >
          {items.map((item, i) => {
            if (item.divider) {
              return (
                <div key={i} className="my-1 h-px" style={{ background: "rgba(120,160,220,0.1)" }} role="separator" />
              );
            }

            const Tag = item.href ? "a" : "button";
            return (
              <Tag
                key={i}
                href={item.href}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (!item.disabled) {
                    item.onClick?.();
                    setOpen(false);
                  }
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: "none", border: "none", textAlign: "left", cursor: item.disabled ? "not-allowed" : "pointer" }}
              >
                {item.icon && (
                  <span className="shrink-0 text-slate-400" style={{ width: 16, height: 16 }}>
                    {item.icon}
                  </span>
                )}
                {item.label}
              </Tag>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Dropdown;
