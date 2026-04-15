import { useRef, useEffect, useState } from 'react';

/**
 * Generic multi-select dropdown with checkboxes.
 *
 * Props:
 *   label      — header label shown beside the button (e.g. "REPS", "STAGE")
 *   allLabel   — button text when nothing is checked (e.g. "All Reps")
 *   items      — [{ id, label, color? }]
 *   checkedIds — Set of checked ids
 *   onToggle   — fn(id)
 *   onClear    — fn()
 */
export default function MultiSelectDropdown({
  label,
  allLabel,
  items,
  checkedIds,
  onToggle,
  onClear,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const hasFilter = checkedIds.size > 0;
  const btnLabel = hasFilter
    ? `${checkedIds.size} selected`
    : (allLabel || `All ${label}s`);

  const checkedItems = items.filter((i) => checkedIds.has(i.id));
  const showDots = checkedItems.some((i) => i.color);

  // Close on outside click
  useEffect(() => {
    const handle = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div className="rep-dropdown" ref={ref}>
      <span className="rep-dropdown-label-text">{label.toUpperCase()}</span>
      <button
        className={`rep-dropdown-btn${hasFilter ? ' rep-dropdown-btn--active' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {hasFilter && showDots && (
          <span className="rep-dropdown-dots">
            {checkedItems.slice(0, 4).map((item) =>
              item.color ? (
                <span
                  key={item.id}
                  className="rep-dropdown-dot-sm"
                  style={{ backgroundColor: item.color }}
                />
              ) : null
            )}
          </span>
        )}
        <span>{btnLabel}</span>
        <span className="rep-dropdown-chevron">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="rep-dropdown-panel">
          <div className="rep-dropdown-panel-header">
            <span>Filter by {label}</span>
            {hasFilter && (
              <button className="rep-dropdown-clear-btn" onClick={onClear}>
                ✕ Clear
              </button>
            )}
          </div>
          <div className="rep-dropdown-list">
            {items.map((item) => {
              const checked = checkedIds.has(item.id);
              return (
                <label
                  key={item.id}
                  className={`rep-dropdown-item${checked ? ' rep-dropdown-item--checked' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="rep-dropdown-checkbox"
                    checked={checked}
                    onChange={() => onToggle(item.id)}
                  />
                  {item.color && (
                    <span
                      className="rep-dropdown-dot"
                      style={{ backgroundColor: item.color }}
                    />
                  )}
                  <span className="rep-dropdown-name">{item.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
