import {
  FILTERS,
  SORTS,
  SORT_KEYS,
  type FilterKey,
  type SortDir,
  type SortKey,
  type ViewMode,
} from '../lib/positionView';

interface Props {
  search: string;
  onSearch: (value: string) => void;
  filter: FilterKey;
  onFilter: (value: FilterKey) => void;
  sort: SortKey;
  dir: SortDir;
  onSort: (value: SortKey) => void;
  onToggleDir: () => void;
  view: ViewMode;
  onView: (value: ViewMode) => void;
  /** Rendered on each chip so empty filters are obvious before you tap them. */
  counts: Record<FilterKey, number>;
}

export function PositionControls({
  search,
  onSearch,
  filter,
  onFilter,
  sort,
  dir,
  onSort,
  onToggleDir,
  view,
  onView,
  counts,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          {/* No text-size class here: the base stylesheet pins inputs to 16px so
              iOS Safari doesn't zoom the page when the field takes focus. */}
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search ticker or name"
            aria-label="Search positions"
            className="w-full py-2 pl-9 pr-9"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <span
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          >
            ⌕
          </span>
          {search && (
            <button
              type="button"
              onClick={() => onSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full text-muted active:bg-edge"
            >
              ×
            </button>
          )}
        </div>

        <div
          className="flex shrink-0 overflow-hidden rounded-xl border border-edge"
          role="group"
          aria-label="View mode"
        >
          <ViewButton current={view} value="cards" onView={onView} label="Cards" />
          <ViewButton current={view} value="table" onView={onView} label="Table" />
        </div>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
        {FILTERS.filter((f) => f.key !== 'closed' || counts.closed > 0).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition active:scale-[0.98] ${
              filter === f.key
                ? 'border-amber bg-amber text-ink font-medium'
                : 'border-edge bg-card text-muted'
            }`}
          >
            {f.label}
            <span className={`num ml-1.5 ${filter === f.key ? 'text-ink/70' : 'text-muted/70'}`}>
              {counts[f.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="sort" className="label shrink-0">
          Sort
        </label>
        <select
          id="sort"
          value={sort}
          onChange={(e) => onSort(e.target.value as SortKey)}
          className="min-w-0 flex-1 py-2"
        >
          {SORT_KEYS.map((key) => (
            <option key={key} value={key}>
              {SORTS[key].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onToggleDir}
          className="btn-ghost shrink-0 px-3 py-2 num text-sm"
          aria-label={dir === 'desc' ? 'Sorted high to low' : 'Sorted low to high'}
        >
          {dir === 'desc' ? '↓ High' : '↑ Low'}
        </button>
      </div>
    </div>
  );
}

function ViewButton({
  current,
  value,
  onView,
  label,
}: {
  current: ViewMode;
  value: ViewMode;
  onView: (v: ViewMode) => void;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onView(value)}
      aria-pressed={active}
      className={`px-3 py-2 text-xs transition ${
        active ? 'bg-amber text-ink font-medium' : 'bg-card text-muted'
      }`}
    >
      {label}
    </button>
  );
}
