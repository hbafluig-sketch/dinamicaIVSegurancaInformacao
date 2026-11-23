import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Erro inesperado no aplicativo.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erro capturado pelo ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendly = 'Ocorreu uma falha ao sincronizar dados com o banco na nuvem.';
      if (this.state.message.includes('Quota exceeded')) {
        friendly =
          'A cota diária gratuita do banco de dados foi atingida. Ela é renovada automaticamente no dia seguinte.';
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-sm space-y-4 text-center">
            <h1 className="font-display text-lg font-bold text-slate-900">
              Ops! Algo precisa de atenção
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">{friendly}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold cursor-pointer"
            >
              Recarregar aplicativo
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
