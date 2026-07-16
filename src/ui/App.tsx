import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Boxes, FileUp, Layers } from 'lucide-react';
import LibraryPage from './pages/LibraryPage';
import BuilderPage from './pages/BuilderPage';
import ImportWizard from './pages/ImportWizard';

const NAV = [
  { to: '/builder', label: 'Stack Builder', icon: Layers },
  { to: '/library', label: 'Protocol Library', icon: Boxes },
  { to: '/import', label: 'Import Spec', icon: FileUp },
];

export default function App() {
  return (
    <HashRouter>
      <div className="flex h-screen">
        <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
            <div className="grid size-8 place-items-center rounded-lg bg-cyan-700/80 font-mono text-sm font-bold text-cyan-50">
              pv
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-zinc-100">
                proto-viz
              </div>
              <div className="text-[11px] text-zinc-500">protocol explorer</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1 px-3">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-cyan-500/10 font-medium text-cyan-300'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto px-5 py-4 text-[11px] leading-relaxed text-zinc-600">
            Runs entirely in your browser.
            <br />
            Nothing is uploaded anywhere.
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/builder" replace />} />
            <Route path="/builder" element={<BuilderPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/:protocolId" element={<LibraryPage />} />
            <Route path="/import" element={<ImportWizard />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
