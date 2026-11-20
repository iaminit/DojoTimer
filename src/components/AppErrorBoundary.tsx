import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { STORAGE_KEYS } from '../services/storage';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  public state: AppErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    const isDev = Boolean(import.meta.env?.DEV);
    return {
      hasError: true,
      errorMessage: isDev ? (error?.message || 'Errore sconosciuto').slice(0, 200) : '',
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env?.DEV) {
      console.error('[DojoTimer] Uncaught render error:', error, info.componentStack);
    }
  }

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  private handleResetAndReload = () => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        for (const key of Object.values(STORAGE_KEYS)) {
          window.localStorage.removeItem(key);
        }
      }
    } catch {
      // Ignore storage access errors
    }
    this.handleReload();
  };

  public render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="flex h-[100dvh] w-screen flex-col items-center justify-center bg-black px-6 text-center text-white">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-3xl border border-red-500/45 bg-neutral-950 p-6 shadow-2xl sm:p-8">
          <span className="text-xs font-extrabold tracking-[0.2em] text-red-400 uppercase">
            DOJO TIMER
          </span>
          <h1 className="text-xl font-extrabold tracking-wide text-white sm:text-2xl">
            Si è verificato un errore imprevisto
          </h1>
          {this.state.errorMessage && (
            <p className="w-full break-words rounded-xl border border-white/10 bg-black/80 px-3 py-2 font-mono text-xs text-slate-300">
              {this.state.errorMessage}
            </p>
          )}

          <div className="mt-2 flex w-full flex-col gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border-2 border-yellow-400 bg-yellow-400 px-4 text-sm font-extrabold tracking-[0.12em] text-black uppercase transition-transform active:scale-95 cursor-pointer"
            >
              <RefreshCw className="h-4 w-4 shrink-0" />
              <span>Ricarica App</span>
            </button>

            <button
              type="button"
              onClick={this.handleResetAndReload}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border border-white/25 bg-black px-4 text-xs font-extrabold tracking-[0.12em] text-slate-200 uppercase hover:border-white/50 active:scale-95 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4 shrink-0" />
              <span>Ripristina Impostazioni Default</span>
            </button>
          </div>
        </div>
      </main>
    );
  }
}
