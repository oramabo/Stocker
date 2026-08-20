import { useNavigate } from 'react-router-dom';
import type { Position } from '../lib/api';
import { money, pct, plColor, shares } from '../lib/format';
import type { SortDir, SortKey } from '../lib/positionView';

interface Props {
  positions: Position[];
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'ticker', label: 'Ticker' },
  { key: 'shares', label: 'Shares' },
  { key: 'avg', label: 'Avg' },
  { key: 'price', label: 'Last' },
  { key: 'value', label: 'Value' },
  { key: 'daycash', label: 'Day $' },
  { key: 'day', label: 'Day %' },
  { key: 'pl', label: 'P/L $' },
  { key: 'plpct', label: 'P/L %' },
];

/**
 * Dense view for comparing holdings side by side. Wider than a phone, so it
 * scrolls horizontally with the ticker column pinned to keep rows readable.
 */
export function PositionTable({ positions, sort, dir, onSort }: Props) {
  const navigate = useNavigate();

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-edge">
            {COLUMNS.map((col, i) => {
              const active = sort === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`whitespace-nowrap p-0 font-normal ${
                    i === 0 ? 'sticky left-0 z-10 bg-card text-left' : 'text-right'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className={`w-full px-2.5 py-2 uppercase tracking-wide transition ${
                      i === 0 ? 'text-left' : 'text-right'
                    } ${active ? 'text-amber' : 'text-muted'}`}
                  >
                    {col.label}
                    {active && <span className="num ml-0.5">{dir === 'desc' ? '↓' : '↑'}</span>}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {positions.map((p) => {
            const unpriced = p.current_price === null;
            return (
              <tr
                key={p.ticker}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/stock/${p.ticker}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/stock/${p.ticker}`);
                  }
                }}
                className="cursor-pointer border-b border-edge/40 last:border-0 active:bg-edge/40"
              >
                <td className="sticky left-0 z-10 bg-card px-2.5 py-2.5 text-left">
                  <span className="num font-semibold text-slate-100">{p.ticker}</span>
                </td>
                <Cell>{shares(p.shares_held)}</Cell>
                <Cell>{money(p.avg_cost)}</Cell>
                <Cell muted={unpriced}>{unpriced ? '—' : money(p.current_price as number)}</Cell>
                <Cell strong>{money(p.market_value, { decimals: 0 })}</Cell>
                <Cell tone={unpriced ? undefined : p.day_change}>
                  {unpriced ? '—' : money(p.day_change, { sign: true, decimals: 0 })}
                </Cell>
                <Cell tone={unpriced ? undefined : p.day_change}>
                  {unpriced ? '—' : pct(p.day_change_pct)}
                </Cell>
                <Cell tone={unpriced ? undefined : p.unrealized_pl}>
                  {unpriced ? '—' : money(p.unrealized_pl, { sign: true, decimals: 0 })}
                </Cell>
                <Cell tone={unpriced ? undefined : p.unrealized_pl}>
                  {unpriced ? '—' : pct(p.unrealized_pl_pct)}
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  children,
  tone,
  strong,
  muted,
}: {
  children: React.ReactNode;
  tone?: number;
  strong?: boolean;
  muted?: boolean;
}) {
  const colour =
    tone !== undefined ? plColor(tone) : muted ? 'text-muted' : strong ? 'text-slate-100' : 'text-slate-300';
  return (
    <td className={`num whitespace-nowrap px-2.5 py-2.5 text-right ${colour} ${strong ? 'font-medium' : ''}`}>
      {children}
    </td>
  );
}
