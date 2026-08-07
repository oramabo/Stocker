import { useEffect, useState, type ReactNode } from 'react';
import { api, getToken, onUnauthorized, setToken } from '../lib/api';

/**
 * Single-user auth: prompt once for the bearer token, keep it in localStorage,
 * and re-prompt whenever the API rejects it.
 */
export function TokenGate({ children }: { children: ReactNode }) {
  const [authorized, setAuthorized] = useState(Boolean(getToken()));
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const handler = () => setAuthorized(false);
    onUnauthorized.add(handler);
    return () => {
      onUnauthorized.delete(handler);
    };
  }, []);

  if (authorized) return <>{children}</>;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const candidate = value.trim();
    if (!candidate) return;
    setChecking(true);
    setError(null);
    setToken(candidate);
    try {
      await api.summary();
      setValue('');
      setAuthorized(true);
    } catch (err) {
      setToken(null);
      setError(err instanceof Error ? err.message : 'Could not verify token');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center px-5">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-amber num">STOCKER</h1>
          <p className="text-sm text-muted mt-1">Enter your access token to continue.</p>
        </div>
        <input
          type="password"
          className="w-full"
          placeholder="APP_TOKEN"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {error && <p className="text-sm text-down">{error}</p>}
        <button className="btn-primary w-full" disabled={checking || !value.trim()}>
          {checking ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
