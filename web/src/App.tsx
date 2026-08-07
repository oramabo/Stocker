import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { Nav } from './components/Nav';
import { TokenGate } from './components/TokenGate';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { StockDetail } from './pages/StockDetail';
import { TransactionForm } from './pages/TransactionForm';

// The chart library is a third of the bundle; keep it off the dashboard's path.
const History = lazy(() => import('./pages/History').then((m) => ({ default: m.History })));

export function App() {
  return (
    <BrowserRouter>
      <TokenGate>
        <div className="mx-auto max-w-lg pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
          <Suspense fallback={<div className="card mx-4 h-64 animate-pulse" />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/stock/:ticker" element={<StockDetail />} />
              <Route path="/add" element={<TransactionForm />} />
              <Route path="/edit/:id" element={<TransactionForm />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
        <Nav />
      </TokenGate>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <div className="px-4 py-16 text-center space-y-3">
      <p className="text-muted">Nothing here.</p>
      <Link to="/" className="text-amber">
        Back to portfolio
      </Link>
    </div>
  );
}
