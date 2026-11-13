/**
 * Tooltip — hover tooltip wrapper
 *
 * Props:
 *   content   — tooltip text / node
 *   placement — "top" | "bottom" | "left" | "right"  (default "top")
 *   delay     — ms before showing (default 300)
 *   children  — trigger element
 */
import { useRef, useState } from "react";

const PLACEMENT_STYLES = {
  top:    { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
  bottom: { top:    "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
  left:   { right:  "calc(100% + 8px)", top:  "50%", transform: "translateY(-50%)" },
  right:  { left:   "calc(100% + 8px)", top:  "50%", transform: "translateY(-50%)" },
};

const ARROW_STYLES = {
  top:    { bottom: "-4px",  left: "50%",  transform: "translateX(-50%) rotate(45deg)" },
  bottom: { top:    "-4px",  left: "50%",  transform: "translateX(-50%) rotate(45deg)" },
  left:   { right:  "-4px",  top:  "50%",  transform: "translateY(-50%) rotate(45deg)" },
  right:  { left:   "-4px",  top:  "50%",  transform: "translateY(-50%) rotate(45deg)" },
};

export function Tooltip({ content, placement = "top", delay = 300, children }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);

  const show = () => {
    timer.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setVisible(false);
  };

  if (!content) return <>{children}</>;

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && (
        <span
          role="tooltip"
          className="pointer-events-none absolute z-50 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium text-white shadow-xl"
          style={{
            ...PLACEMENT_STYLES[placement],
            background: "#14243D",
            border: "1px solid rgba(120,160,220,0.22)",
            backdropFilter: "blur(8px)",
            animation: "fadeIn 0.15s ease-out both",
          }}
        >
          {content}
          {/* Arrow */}
          <span
            className="absolute h-2 w-2"
            style={{
              ...ARROW_STYLES[placement],
              background: "#14243D",
              border: "1px solid rgba(120,160,220,0.22)",
              borderRight: "none",
              borderBottom: "none",
            }}
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  );
}

export default Tooltip;
