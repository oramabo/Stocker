import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type TxType } from '../lib/api';
import { today } from '../lib/format';

interface FormState {
  ticker: string;
  type: TxType;
  quantity: string;
  price: string;
  commission: string;
  trade_date: string;
  note: string;
}

const EMPTY: FormState = {
  ticker: '',
  type: 'buy',
  quantity: '',
  price: '',
  commission: '',
  trade_date: today(),
  note: '',
};

export function TransactionForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editing = Boolean(id);

  const [form, setForm] = useState<FormState>({
    ...EMPTY,
    ticker: params.get('ticker')?.toUpperCase() ?? '',
  });
  const [tickers, setTickers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    api.stocks().then((rows) => setTickers(rows.map((r) => r.ticker))).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!editing) return;
    api
      .transactions()
      .then((rows) => {
        const tx = rows.find((r) => r.id === Number(id));
        if (!tx) {
          setError(`Transaction ${id} not found`);
          return;
        }
        setForm({
          ticker: tx.ticker,
          type: tx.type,
          quantity: String(tx.quantity),
          price: String(tx.price),
          commission: tx.commission ? String(tx.commission) : '',
          trade_date: tx.trade_date,
          note: tx.note ?? '',
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load'))
      .finally(() => setLoaded(true));
  }, [editing, id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      ticker: form.ticker.trim().toUpperCase(),
      type: form.type,
      quantity: form.type === 'dividend' ? 0 : Number(form.quantity),
      price: Number(form.price),
      commission: form.commission ? Number(form.commission) : 0,
      trade_date: form.trade_date,
      note: form.note.trim() || null,
    };

    try {
      if (editing) await api.updateTransaction(Number(id), payload);
      else await api.createTransaction(payload);
      navigate(`/stock/${payload.ticker}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id || !confirm('Delete this transaction?')) return;
    try {
      await api.deleteTransaction(Number(id));
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    }
  };

  if (!loaded) return <div className="card mx-4 h-64 animate-pulse" />;

  const isDividend = form.type === 'dividend';

  return (
    <form onSubmit={submit} className="px-4 pb-6 space-y-4">
      <h1 className="text-lg font-semibold">{editing ? 'Edit transaction' : 'Add transaction'}</h1>

      <div className="card p-4 space-y-4">
        <Field label="Ticker">
          <input
            className="w-full uppercase num"
            list="known-tickers"
            required
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="AAPL"
            value={form.ticker}
            onChange={(e) => set('ticker', e.target.value.toUpperCase())}
          />
          <datalist id="known-tickers">
            {tickers.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>

        <Field label="Type">
          <div className="grid grid-cols-3 gap-2">
            {(['buy', 'sell', 'dividend'] as TxType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => set('type', type)}
                className={`btn py-2.5 text-sm capitalize border ${
                  form.type === type
                    ? 'bg-amber text-ink border-amber'
                    : 'bg-ink text-slate-300 border-edge'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </Field>

        {!isDividend && (
          <Field label="Quantity">
            <input
              className="w-full num"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              required
              placeholder="10"
              value={form.quantity}
              onChange={(e) => set('quantity', e.target.value)}
            />
          </Field>
        )}

        <Field label={isDividend ? 'Amount received' : 'Price per share'}>
          <input
            className="w-full num"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            required
            placeholder={isDividend ? '23.50' : '100.00'}
            value={form.price}
            onChange={(e) => set('price', e.target.value)}
          />
        </Field>

        <Field label="Commission">
          <input
            className="w-full num"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder="0"
            value={form.commission}
            onChange={(e) => set('commission', e.target.value)}
          />
        </Field>

        <Field label="Date">
          <input
            className="w-full num"
            type="date"
            required
            max={today()}
            value={form.trade_date}
            onChange={(e) => set('trade_date', e.target.value)}
          />
        </Field>

        <Field label="Note">
          <input
            className="w-full"
            placeholder="optional"
            value={form.note}
            onChange={(e) => set('note', e.target.value)}
          />
        </Field>
      </div>

      {error && <p className="text-sm text-down px-1">{error}</p>}

      <div className="flex gap-3">
        <button type="button" onClick={() => navigate(-1)} className="btn-ghost flex-1">
          Cancel
        </button>
        <button className="btn-primary flex-1" disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save' : 'Add'}
        </button>
      </div>

      {editing && (
        <button type="button" onClick={remove} className="w-full text-sm text-down py-2">
          Delete transaction
        </button>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
