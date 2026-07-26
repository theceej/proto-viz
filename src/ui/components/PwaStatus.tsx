import { useEffect, useState } from 'react';
import { RefreshCcw, WifiOff, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const OFFLINE_SESSION_KEY = 'pv-network-offline';

function rememberOffline(offline: boolean): void {
  try {
    if (offline) sessionStorage.setItem(OFFLINE_SESSION_KEY, '1');
    else sessionStorage.removeItem(OFFLINE_SESSION_KEY);
  } catch {
    // Connectivity status still works when storage is unavailable.
  }
}

function initiallyOnline(): boolean {
  if (!navigator.onLine) return false;
  try {
    return sessionStorage.getItem(OFFLINE_SESSION_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Accessible network and service-worker update status. */
export default function PwaStatus() {
  const [online, setOnline] = useState(initiallyOnline);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    let active = true;
    const connected = async () => {
      if (!navigator.onLine) return;
      try {
        const url = new URL(location.href);
        url.hash = '';
        url.searchParams.set('pv-network-check', String(Date.now()));
        await fetch(url, { cache: 'no-store' });
        if (!active) return;
        rememberOffline(false);
        setOnline(true);
      } catch {
        // A service worker may serve the app while the origin remains unreachable.
      }
    };
    const disconnected = () => {
      rememberOffline(true);
      setOnline(false);
    };
    const handleOnline = () => void connected();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', disconnected);
    // Recheck after subscribing in case connectivity changed during render.
    if (!navigator.onLine) disconnected();
    else if (!online) void connected();
    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', disconnected);
    };
  }, [online]);

  if (!needRefresh && online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-3 bottom-3 z-50 flex max-w-sm items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[12px] text-zinc-300 shadow-xl"
    >
      {needRefresh ? (
        <>
          <RefreshCcw className="size-4 shrink-0 text-cyan-400" aria-hidden />
          <span>A new version of proto-viz is available.</span>
          <button
            className="cursor-pointer rounded bg-cyan-700 px-2 py-1 font-medium text-white hover:bg-cyan-600"
            onClick={() => void updateServiceWorker(true)}
          >
            Update
          </button>
          <button
            className="cursor-pointer rounded p-1 text-zinc-500 hover:text-zinc-200"
            aria-label="Dismiss update notification"
            onClick={() => setNeedRefresh(false)}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </>
      ) : (
        <>
          <WifiOff className="size-4 shrink-0 text-amber-400" aria-hidden />
          <span>Offline — the builder and protocol library remain available.</span>
        </>
      )}
    </div>
  );
}
