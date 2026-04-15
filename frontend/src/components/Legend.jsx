import MultiSelectDropdown from './MultiSelectDropdown';

export default function Legend({ owners, checkedRepIds, onToggle, onClear }) {
  const items = owners
    .filter((o) => o.fullName)
    .map((o) => ({ id: o.id, label: o.fullName, color: o.color }));

  if (items.length === 0) return null;

  return (
    <MultiSelectDropdown
      label="Reps"
      allLabel="All Reps"
      items={items}
      checkedIds={checkedRepIds}
      onToggle={onToggle}
      onClear={onClear}
    />
  );
}
