import { useRef, useState, type ReactNode } from 'react';

const TRIGGER_PX = 70;
const MAX_PULL = 110;

/**
 * Touch pull-to-refresh for the dashboard. Only engages when the page is
 * already scrolled to the top, so it never fights normal scrolling.
 */
export function PullToRefresh({
  onRefresh,
  busy,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  busy?: boolean;
  children: ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [running, setRunning] = useState(false);
  const start = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY > 0 || running) return;
    start.current = e.touches[0].clientY;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (start.current === null) return;
    const delta = e.touches[0].clientY - start.current;
    if (delta <= 0) {
      setPull(0);
      return;
    }
    // Resist as the pull grows, the way native scroll views do.
    setPull(Math.min(MAX_PULL, delta * 0.5));
  };

  const onTouchEnd = async () => {
    const distance = pull;
    start.current = null;
    if (distance < TRIGGER_PX) {
      setPull(0);
      return;
    }
    setRunning(true);
    setPull(TRIGGER_PX / 2);
    try {
      await onRefresh();
    } finally {
      setRunning(false);
      setPull(0);
    }
  };

  const active = running || busy;

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div
        className="flex items-center justify-center overflow-hidden text-xs text-muted transition-[height] duration-150"
        style={{ height: active ? TRIGGER_PX / 2 : pull }}
      >
        {active ? (
          <span className="num text-amber">refreshing prices…</span>
        ) : pull > 0 ? (
          <span className="num">{pull >= TRIGGER_PX ? 'release to refresh' : 'pull to refresh'}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
