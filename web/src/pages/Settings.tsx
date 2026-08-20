import { useState } from 'react';
import { api, getToken, setToken } from '../lib/api';
import { relativeTime } from '../lib/format';

/** RFC 4180 quoting so notes with commas or quotes survive the round trip. */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');
}

export function Settings() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [widgetStatus, setWidgetStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const token = getToken() ?? '';
  const masked = token ? `${token.slice(0, 3)}${'•'.repeat(Math.max(token.length - 3, 4))}` : '—';

  const refresh = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await api.refresh();
      setStatus(
        `Refreshed ${result.refreshed.length} ticker(s) ${relativeTime(result.updated_at)}` +
          (result.failed.length ? ` · failed: ${result.failed.map((f) => f.ticker).join(', ')}` : ''),
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const rows = await api.transactions();
      if (rows.length === 0) {
        setStatus('Nothing to export yet.');
        return;
      }
      const blob = new Blob([toCsv(rows as unknown as Record<string, unknown>[])], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `stocker-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${rows.length} transaction(s).`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  /**
   * The script ships with a placeholder BASE so the public repo carries nobody's
   * deployment URL. Point it at wherever this page is being served from.
   */
  const personalise = (script: string) =>
    script.replace(/const BASE = "[^"]*";/, `const BASE = "${location.origin}";`);

  /**
   * Safari only allows a clipboard write inside the user gesture that triggered
   * it, so an `await fetch(...)` before `writeText` gets rejected on iOS. The
   * supported way round it is to hand ClipboardItem the pending promise and let
   * the browser resolve it itself.
   */
  const copyWidget = async () => {
    setWidgetStatus(null);
    const src = '/widget.js';
    try {
      const ClipboardItemCtor = (window as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (ClipboardItemCtor && navigator.clipboard?.write) {
        const text = fetch(src)
          .then((r) => r.text())
          .then((t) => new Blob([personalise(t)], { type: 'text/plain' }));
        await navigator.clipboard.write([new ClipboardItemCtor({ 'text/plain': text })]);
      } else {
        const text = await fetch(src).then((r) => r.text());
        await navigator.clipboard.writeText(personalise(text));
      }
      setCopied(true);
      setWidgetStatus('Script copied. Paste it into a new Scriptable script named “Stocker”.');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.open(src, '_blank');
      setWidgetStatus('Copy was blocked, so the script opened in a new tab — long-press it and Select All.');
    }
  };

  const signOut = () => {
    setToken(null);
    location.reload();
  };

  return (
    <div className="px-4 pb-6 space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <section className="card p-4 space-y-3">
        <div>
          <p className="label">Access token</p>
          <p className="num text-sm break-all">{masked}</p>
        </div>
        <p className="text-xs text-muted">
          The token is stored in this browser only. To rotate it, run{' '}
          <code className="num text-slate-300">wrangler secret put APP_TOKEN</code>, then sign out and
          enter the new value.
        </p>
        <button onClick={signOut} className="btn-ghost w-full">
          Forget token on this device
        </button>
      </section>

      <section className="card p-4 space-y-3">
        <p className="label">Data</p>
        <button onClick={refresh} disabled={busy} className="btn-ghost w-full">
          Refresh prices now
        </button>
        <button onClick={exportCsv} disabled={busy} className="btn-ghost w-full">
          Export transactions as CSV
        </button>
        {status && <p className="text-xs text-muted">{status}</p>}
      </section>

      <section className="card p-4 space-y-3">
        <div>
          <p className="label">Home screen widget</p>
          <p className="text-xs text-muted mt-1">
            Install <span className="text-slate-300">Scriptable</span> from the App Store, copy the
            script, paste it into a new script named “Stocker”, then run it once to store your token.
            Add the widget from the home screen with long-press → + → Scriptable.
          </p>
        </div>
        <button onClick={copyWidget} className="btn-ghost w-full">
          {copied ? 'Copied ✓' : 'Copy widget script'}
        </button>
        {widgetStatus && <p className="text-xs text-muted">{widgetStatus}</p>}
      </section>

      <section className="card p-4">
        <p className="label mb-2">iOS Shortcut</p>
        <p className="text-xs text-muted">
          Point a “Get Contents of URL” action at{' '}
          <code className="num text-slate-300 break-all">{location.origin}/api/shortcut/summary</code>{' '}
          with an <code className="num text-slate-300">Authorization: Bearer …</code> header to get a
          one-line portfolio summary. Setup steps are in the README.
        </p>
      </section>
    </div>
  );
}
