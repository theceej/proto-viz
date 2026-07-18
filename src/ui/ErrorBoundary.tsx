import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Copy, RefreshCcw, RotateCcw, Trash2 } from 'lucide-react';

const UI_STATE_KEYS = [
  'pv-theme',
  'pv-sidebar-collapsed',
  'pv-osi-panel',
  'pv-pane-fields',
  'pv-pane-diagrams',
  'pv-pane-hex',
] as const;

interface Props {
  children: ReactNode;
  reload?: () => void;
  copyText?: (text: string) => Promise<void>;
}

interface State {
  error: Error | null;
  componentStack: string;
  copied: boolean;
  recoveryKey: number;
}

/** Last-resort recovery UI for unexpected render and lifecycle errors. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '', copied: false, recoveryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  private diagnostics = () => {
    const route = window.location.hash.split('?')[0] || '#/';
    const components = this.state.componentStack
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12)
      .join('\n');
    return [
      'Application: proto-viz',
      `Route: ${route}`,
      `Error type: ${this.state.error?.name ?? 'Error'}`,
      `Browser: ${navigator.userAgent}`,
      components ? `Component stack:\n${components}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  private retry = () => {
    this.setState((state) => ({
      error: null,
      componentStack: '',
      copied: false,
      recoveryKey: state.recoveryKey + 1,
    }));
  };

  private reload = () => (this.props.reload ?? (() => window.location.reload()))();

  private resetUi = () => {
    for (const key of UI_STATE_KEYS) localStorage.removeItem(key);
    this.reload();
  };

  private copy = async () => {
    const copyText = this.props.copyText ?? ((text: string) => navigator.clipboard.writeText(text));
    await copyText(this.diagnostics());
    this.setState({ copied: true });
  };

  render() {
    if (!this.state.error) return <div key={this.state.recoveryKey}>{this.props.children}</div>;

    return (
      <main className="grid min-h-screen place-items-center bg-zinc-950 p-6 text-zinc-200">
        <section className="w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl" aria-labelledby="fatal-error-title">
          <h1 id="fatal-error-title" className="text-lg font-semibold text-zinc-100">
            proto-viz hit an unexpected error
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
            Your packet and imported documents have not been included in the diagnostics below.
            Try the page again, reload it, or reset display preferences if the problem persists.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Action icon={RotateCcw} onClick={this.retry}>Try again</Action>
            <Action icon={RefreshCcw} onClick={this.reload}>Reload</Action>
            <Action icon={Trash2} onClick={this.resetUi}>Reset UI preferences</Action>
          </div>
          <details className="mt-5 rounded-md border border-zinc-700 bg-zinc-950/60 p-3">
            <summary className="cursor-pointer text-[13px] font-medium text-zinc-300">Diagnostic details</summary>
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-400" tabIndex={0}>{this.diagnostics()}</pre>
            <button className="mt-3 flex cursor-pointer items-center gap-1.5 rounded border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-cyan-600" onClick={() => void this.copy()}>
              <Copy className="size-3.5" aria-hidden />
              {this.state.copied ? 'Diagnostics copied' : 'Copy diagnostics'}
            </button>
          </details>
        </section>
      </main>
    );
  }
}

function Action({ icon: Icon, onClick, children }: { icon: typeof RotateCcw; onClick: () => void; children: ReactNode }) {
  return <button className="flex cursor-pointer items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600" onClick={onClick}><Icon className="size-3.5" aria-hidden />{children}</button>;
}
