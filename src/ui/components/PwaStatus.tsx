import { useEffect, useState } from 'react';
import { RefreshCcw, WifiOff, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Accessible network and service-worker update status. */
export default function PwaStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
    };
  }, []);

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
