import { useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type LotDetail } from '../lib/api';
import { money, pct, plColor, shares } from '../lib/format';
import { useAsync } from '../lib/useAsync';

export function StockDetail() {
  const { ticker = '' } = useParams();
  const navigate = useNavigate();
  const load = useCallback(() => api.position(ticker.toUpperCase()), [ticker]);
  const { data, error, loading, reload } = useAsync(load);

  const remove = async (id: number) => {
    if (!confirm('Delete this transaction?')) return;
    try {
      await api.deleteTransaction(id);
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete');
    }
  };

  if (loading && !data) return <div className="card mx-4 h-40 animate-pulse" />;
  if (error) return <p className="p-5 text-down">{error}</p>;
  if (!data) return null;

  const { position, transactions } = data;

  return (
    <div className="px-4 pb-6 space-y-4">
      <header className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-muted text-sm">
          ‹ Back
        </button>
        <Link to={`/add?ticker=${position.ticker}`} className="text-amber text-sm font-medium">
          + Transaction
        </Link>
      </header>

      <section className="card p-5">
        <p className="num text-xl font-semibold">{position.ticker}</p>
        <p className="text-xs text-muted">{position.name ?? '—'}</p>

        <p className="num text-amber text-3xl font-semibold mt-3">{money(position.market_value)}</p>
        <p className={`num text-sm ${plColor(position.unrealized_pl)}`}>
          {money(position.unrealized_pl, { sign: true })} ({pct(position.unrealized_pl_pct)})
        </p>

        <dl className="mt-4 divide-y divide-edge/60 border-t border-edge text-sm">
          <Row label="Shares" value={shares(position.shares_held)} />
          <Row label="Avg cost" value={money(position.avg_cost)} />
          <Row
            label="Last price"
            value={position.current_price === null ? '—' : money(position.current_price)}
          />
          <Row
            label="Today"
            value={`${money(position.day_change, { sign: true })} (${pct(position.day_change_pct)})`}
            tone={position.day_change}
          />
          <Row label="Cost basis" value={money(position.cost_basis)} />
          <Row label="Realised" value={money(position.realized_pl, { sign: true })} tone={position.realized_pl} />
          {position.dividend_income > 0 && (
            <Row label="Dividends" value={money(position.dividend_income)} tone={1} />
          )}
          <Row label="Total return" value={money(position.total_return, { sign: true })} tone={position.total_return} />
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="label px-1">Transactions</h2>
        {transactions.length === 0 && <p className="text-sm text-muted px-1">No transactions yet.</p>}
        {transactions.map((tx) => (
          <TxRow key={tx.id} tx={tx} onDelete={() => remove(tx.id)} />
        ))}
      </section>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="flex justify-between gap-2 py-2">
      <dt className="text-muted whitespace-nowrap">{label}</dt>
      <dd className={`num ${tone === undefined ? 'text-slate-100' : plColor(tone)}`}>{value}</dd>
    </div>
  );
}

const TYPE_STYLE: Record<string, string> = {
  buy: 'bg-up/15 text-up',
  sell: 'bg-down/15 text-down',
  dividend: 'bg-amber/15 text-amber',
};

function TxRow({ tx, onDelete }: { tx: LotDetail; onDelete: () => void }) {
  return (
    <div className="card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={`num text-[11px] uppercase px-1.5 py-0.5 rounded ${TYPE_STYLE[tx.type]}`}>
            {tx.type}
          </span>
          <p className="num text-sm mt-1.5">
            {tx.type === 'dividend'
              ? money(tx.price)
              : `${shares(tx.quantity)} @ ${money(tx.price)}`}
            {tx.commission > 0 && <span className="text-muted"> +{money(tx.commission)} fee</span>}
          </p>
          <p className="num text-xs text-muted">{tx.trade_date}</p>
          {tx.note && <p className="text-xs text-muted mt-1 italic">{tx.note}</p>}
        </div>

        <div className="text-right shrink-0">
          {tx.type === 'buy' && tx.lot_pl !== undefined && (
            <>
              <p className={`num text-sm ${plColor(tx.lot_pl)}`}>{money(tx.lot_pl, { sign: true })}</p>
              <p className={`num text-xs ${plColor(tx.lot_pl)}`}>{pct(tx.lot_pl_pct ?? 0)}</p>
              <p className="num text-[11px] text-muted mt-0.5">lot {money(tx.lot_cost ?? 0, { decimals: 0 })}</p>
            </>
          )}
          {tx.type === 'sell' && tx.realized_pl !== undefined && (
            <>
              <p className={`num text-sm ${plColor(tx.realized_pl)}`}>
                {money(tx.realized_pl, { sign: true })}
              </p>
              <p className="num text-[11px] text-muted">realised</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 flex gap-4 border-t border-edge/60 pt-2 text-xs">
        <Link to={`/edit/${tx.id}`} className="text-muted">
          Edit
        </Link>
        <button onClick={onDelete} className="text-muted">
          Delete
        </button>
      </div>
    </div>
  );
}
