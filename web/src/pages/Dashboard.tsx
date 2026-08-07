import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Position, type Summary } from '../lib/api';
import { money, pct, plColor, relativeTime, shares } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { PullToRefresh } from '../components/PullToRefresh';

export function Dashboard() {
  const load = useCallback(
    async () => ({ summary: await api.summary(), positions: await api.positions() }),
    [],
  );
  const { data, error, loading, reload } = useAsync(load);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const result = await api.refresh();
      if (result.failed.length) {
        setNotice(`Could not price ${result.failed.map((f) => f.ticker).join(', ')}`);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      await reload();
      setRefreshing(false);
    }
  };

  if (loading && !data) return <Skeleton />;
  if (error && !data) return <p className="p-5 text-down">{error}</p>;
  if (!data) return null;

  const { summary, positions } = data;
  const held = positions.filter((p) => p.shares_held > 0);
  const closed = positions.filter((p) => p.shares_held <= 0);

  return (
    <PullToRefresh onRefresh={refresh} busy={refreshing}>
      <div className="px-4 pb-6 space-y-4">
        <TotalCard summary={summary} onRefresh={refresh} refreshing={refreshing} />

        {notice && <p className="text-xs text-down px-1">{notice}</p>}

        {held.length === 0 && (
          <div className="card p-6 text-center space-y-3">
            <p className="text-muted text-sm">No open positions yet.</p>
            <Link to="/add" className="btn-primary inline-block">
              Add your first transaction
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {held.map((position) => (
            <PositionCard key={position.ticker} position={position} />
          ))}
        </div>

        {closed.length > 0 && (
          <section className="space-y-3 pt-2">
            <h2 className="label px-1">Closed</h2>
            {closed.map((position) => (
              <PositionCard key={position.ticker} position={position} />
            ))}
          </section>
        )}
      </div>
    </PullToRefresh>
  );
}

function TotalCard({
  summary,
  onRefresh,
  refreshing,
}: {
  summary: Summary;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <section className="card p-5">
      <div className="flex items-start justify-between">
        <span className="label">Total value</span>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="text-xs text-muted num disabled:opacity-50"
          aria-label="Refresh prices"
        >
          {refreshing ? 'refreshing…' : `↻ ${relativeTime(summary.updated_at)}`}
        </button>
      </div>

      <p className="num text-amber text-[2.6rem] leading-tight font-semibold tracking-tight">
        {money(summary.total_value)}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Figure
          label="Unrealised"
          value={`${money(summary.unrealized_pl, { sign: true })}`}
          sub={pct(summary.unrealized_pl_pct)}
          tone={summary.unrealized_pl}
        />
        <Figure
          label="Today"
          value={`${money(summary.day_change, { sign: true })}`}
          sub={pct(summary.day_change_pct)}
          tone={summary.day_change}
        />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-edge pt-3 text-center">
        <SmallStat label="Cost" value={money(summary.total_cost, { decimals: 0 })} />
        <SmallStat
          label="Realised"
          value={money(summary.realized_pl, { decimals: 0, sign: true })}
          tone={summary.realized_pl}
        />
        <SmallStat
          label="Dividends"
          value={money(summary.dividend_income, { decimals: 0 })}
          tone={summary.dividend_income > 0 ? 1 : 0}
        />
      </dl>
    </section>
  );
}

function Figure({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: number;
}) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className={`num text-lg font-medium ${plColor(tone)}`}>{value}</p>
      <p className={`num text-xs ${plColor(tone)}`}>{sub}</p>
    </div>
  );
}

function SmallStat({ label, value, tone = 0 }: { label: string; value: string; tone?: number }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={`num text-sm ${tone ? plColor(tone) : 'text-slate-200'}`}>{value}</dd>
    </div>
  );
}

function PositionCard({ position }: { position: Position }) {
  const closed = position.shares_held <= 0;
  return (
    <Link to={`/stock/${position.ticker}`} className="card block p-4 active:border-amber/50">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="num font-semibold text-slate-100">{position.ticker}</p>
          <p className="text-xs text-muted truncate">{position.name ?? '—'}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="num font-medium">
            {money(closed ? position.realized_pl : position.market_value)}
          </p>
          {!closed && (
            <p className={`num text-xs ${plColor(position.day_change)}`}>
              {money(position.day_change, { sign: true, decimals: 2 })} today
            </p>
          )}
        </div>
      </div>

      {closed ? (
        <p className="mt-2 text-xs text-muted num">
          closed · realised {money(position.realized_pl, { sign: true })}
        </p>
      ) : (
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="num text-xs text-muted space-y-0.5">
            <p>
              {shares(position.shares_held)} sh @ {money(position.avg_cost)}
            </p>
            <p>
              last {position.current_price === null ? '—' : money(position.current_price)}
            </p>
          </div>
          <div className="text-right">
            <p className={`num text-sm font-medium ${plColor(position.unrealized_pl)}`}>
              {money(position.unrealized_pl, { sign: true })}
            </p>
            <p className={`num text-xs ${plColor(position.unrealized_pl)}`}>
              {pct(position.unrealized_pl_pct)}
            </p>
          </div>
        </div>
      )}
    </Link>
  );
}

function Skeleton() {
  return (
    <div className="px-4 space-y-3">
      <div className="card h-48 animate-pulse" />
      <div className="card h-24 animate-pulse" />
      <div className="card h-24 animate-pulse" />
    </div>
  );
}
