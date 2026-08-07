import { useCallback, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { money, pct, plColor } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const RANGES = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '1Y', days: 365 },
  { label: 'All', days: 3650 },
];

export function History() {
  const [range, setRange] = useState(RANGES[1]);
  const load = useCallback(() => api.history(range.days), [range.days]);
  const { data, error, loading } = useAsync(load, [range.days]);

  const points = (data ?? []).map((snap) => ({
    date: snap.snap_date,
    value: snap.total_value,
    cost: snap.total_cost,
  }));

  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last ? last.value - first.value : 0;
  const changePct = first && first.value > 0 ? (change / first.value) * 100 : 0;

  return (
    <div className="px-4 pb-6 space-y-4">
      <h1 className="text-lg font-semibold">History</h1>

      <div className="flex gap-2">
        {RANGES.map((option) => (
          <button
            key={option.label}
            onClick={() => setRange(option)}
            className={`num flex-1 rounded-lg py-2 text-sm border ${
              option.label === range.label
                ? 'bg-amber text-ink border-amber'
                : 'bg-card text-muted border-edge'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <section className="card p-4">
        {error && <p className="text-down text-sm">{error}</p>}
        {loading && !data && <div className="h-56 animate-pulse" />}

        {data && points.length < 2 && (
          <p className="text-sm text-muted py-10 text-center">
            Not enough history yet — a snapshot is recorded after each market close.
          </p>
        )}

        {points.length >= 2 && (
          <>
            <p className="num text-2xl text-amber font-semibold">{money(last.value)}</p>
            <p className={`num text-sm ${plColor(change)}`}>
              {money(change, { sign: true })} ({pct(changePct)}) over {range.label}
            </p>

            <div className="h-56 mt-4 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="value" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F5B841" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#F5B841" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#243141" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#8397AE', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis
                    tick={{ fill: '#8397AE', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#18212C',
                      border: '1px solid #243141',
                      borderRadius: 12,
                      fontFamily: 'IBM Plex Mono, monospace',
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#8397AE' }}
                    formatter={(value: number, name: string) => [money(value), name]}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="value"
                    stroke="#F5B841"
                    strokeWidth={2}
                    fill="url(#value)"
                  />
                  <Area
                    type="monotone"
                    dataKey="cost"
                    name="cost"
                    stroke="#8397AE"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    fill="none"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
