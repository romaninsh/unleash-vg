import { useState } from "react";

/** A secret or temporary password, shown once with a copy button (spec 05 screens 8, 9). */
export function ShowOnce({ title, label, value, note, onClose }: { title: string; label: string; value: string; note?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overlay">
      <div className="card dialog" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        <p className="muted">This is the only time it is shown. Copy it now.</p>
        <label>
          {label}
          <input readOnly value={value} className="mono" onFocus={(e) => e.target.select()} aria-label={label} />
        </label>
        {note && <p className="hint">{note}</p>}
        <div className="actions">
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(value);
              setCopied(true);
            }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
