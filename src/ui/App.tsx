import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  Boxes,
  CircleHelp,
  FileUp,
  Layers,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
} from 'lucide-react';
import LibraryPage from './pages/LibraryPage';
import BuilderPage from './pages/BuilderPage';
import ImportWizard from './pages/ImportWizard';
import HelpPage from './pages/HelpPage';
import { useLibraryStore } from '../store/libraryStore';
import { loadCustomProtocols } from '../store/persistence';
import { usePersistedFlag } from './usePersistedFlag';

const GITHUB_URL = 'https://github.com/theceej/proto-viz';

const NAV = [
  { to: '/builder', label: 'Stack Builder', icon: Layers },
  { to: '/library', label: 'Protocol Library', icon: Boxes },
  { to: '/import', label: 'Import Spec', icon: FileUp },
  { to: '/help', label: 'Help', icon: CircleHelp },
];

type Theme = 'dark' | 'light';

export default function App() {
  const setCustom = useLibraryStore((s) => s.setCustom);
  const [collapsed, setCollapsed] = usePersistedFlag('pv-sidebar-collapsed', false);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('pv-theme') as Theme | null) ?? 'dark',
  );

  useEffect(() => {
    loadCustomProtocols().then((defs) => {
      if (defs.length > 0) setCustom(defs);
    });
  }, [setCustom]);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('pv-theme', theme);
  }, [theme]);

  return (
    <HashRouter>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-cyan-700 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <div className="flex h-screen">
        <aside
          className={`flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/60 transition-[width] duration-150 ${
            collapsed ? 'w-14' : 'w-56'
          }`}
        >
          <div className={`flex items-center gap-2.5 pt-5 pb-6 ${collapsed ? 'justify-center px-0' : 'px-5'}`}>
            <LogoMark className="size-8 shrink-0" />
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold tracking-tight text-zinc-100">
                  proto-viz
                </div>
                <div className="text-[11px] text-zinc-500">protocol explorer</div>
              </div>
            )}
          </div>
          <nav className={`flex flex-col gap-1 ${collapsed ? 'px-2' : 'px-3'}`}>
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={label}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md py-2 text-sm transition-colors ${
                    collapsed ? 'justify-center px-0' : 'px-3'
                  } ${
                    isActive
                      ? 'bg-cyan-500/10 font-medium text-cyan-300'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`
                }
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto">
            {!collapsed && (
              <div className="px-5 py-3 text-[11px] leading-relaxed text-zinc-600">
                Runs entirely in your browser.
                <br />
                Nothing is uploaded anywhere.
                <br />
                <a
                  className="mt-1.5 inline-block hover:text-zinc-400 hover:underline"
                  href={`${GITHUB_URL}/blob/main/LICENSE`}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="GNU General Public License v3 (opens in a new tab)"
                >
                  GPL-3.0 · © 2026 proto-viz contributors
                </a>
              </div>
            )}
            <div
              className={`flex items-center gap-1 border-t border-zinc-800 py-2 ${
                collapsed ? 'flex-col px-2' : 'px-3'
              }`}
            >
              <button
                className="cursor-pointer rounded-md p-2 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
              <a
                className="cursor-pointer rounded-md p-2 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer noopener"
                title="View source on GitHub"
                aria-label="View source on GitHub (opens in a new tab)"
              >
                <GithubIcon className="size-4" />
              </a>
              <button
                className={`cursor-pointer rounded-md p-2 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200 ${
                  collapsed ? '' : 'ml-auto'
                }`}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!collapsed}
                onClick={() => setCollapsed(!collapsed)}
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
            </div>
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/builder" replace />} />
            <Route path="/builder" element={<BuilderPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/:protocolId" element={<LibraryPage />} />
            <Route path="/import" element={<ImportWizard />} />
            <Route path="/help" element={<HelpPage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

/** The proto-viz mark: a miniature packet header. Mirrors public/favicon.svg. */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0e7490" />
      <rect x="5" y="6" width="13" height="5.5" rx="1.5" fill="#e0f2fe" />
      <rect x="20" y="6" width="7" height="5.5" rx="1.5" fill="#a5f3fc" />
      <rect x="5" y="13.5" width="22" height="5.5" rx="1.5" fill="#67e8f9" />
      <rect x="5" y="21" width="5" height="5.5" rx="1.5" fill="#22d3ee" />
      <rect x="12" y="21" width="4" height="5.5" rx="1.5" fill="#38bdf8" />
      <rect x="18" y="21" width="9" height="5.5" rx="1.5" fill="#7dd3fc" />
    </svg>
  );
}

/** GitHub mark (lucide dropped brand icons). */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97 0 1.95.13 2.87.39 2.18-1.49 3.14-1.18 3.14-1.18.63 1.59.24 2.76.12 3.05.73.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.26 5.67.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
