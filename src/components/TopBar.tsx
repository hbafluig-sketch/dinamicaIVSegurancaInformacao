import type { ViewMode } from '../types/gincana.ts';

interface TopBarProps {
  view: ViewMode;
  hasSavedGame: boolean;
  canStartGame: boolean;
  onNavigate: (next: ViewMode) => void;
  onPrimaryAction: () => void;
}

export function TopBar({
  view,
  hasSavedGame,
  canStartGame,
  onNavigate,
  onPrimaryAction,
}: TopBarProps) {
  const ctaLabel =
    view === 'game'
      ? 'Encerrar rodada'
      : hasSavedGame
        ? 'Continuar jogo'
        : 'Iniciar jogo';

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onNavigate('start')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 hover:text-sky-700 transition-colors cursor-pointer"
        >
          Gincana de Segurança
        </button>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => onNavigate('start')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              view === 'start'
                ? 'border-sky-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Início
          </button>
          <button
            type="button"
            onClick={() => onNavigate('game')}
            disabled={!canStartGame}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              view === 'game'
                ? 'border-sky-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Jogar
          </button>
          <button
            type="button"
            onClick={() => onNavigate('roulette')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              view === 'roulette'
                ? 'border-sky-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Roleta
          </button>
          <button
            type="button"
            onClick={() => onNavigate('result')}
            disabled={!canStartGame}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              view === 'result'
                ? 'border-sky-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Gabarito
          </button>
          <button
            type="button"
            onClick={() => onNavigate('admin')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              view === 'admin'
                ? 'border-sky-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Admin
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onPrimaryAction}
            disabled={!canStartGame && view !== 'game'}
            className="px-4 py-2 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {ctaLabel}
          </button>
        </div>
      </div>

      {/* Mobile navigation strip */}
      <div className="flex md:hidden items-center justify-around border-t border-slate-100 px-2 py-1.5 text-xs font-medium text-slate-600">
        {(['start', 'game', 'roulette', 'result', 'admin'] as ViewMode[]).map((tab) => {
          const labels: Record<ViewMode, string> = {
            start: 'Início',
            game: 'Jogar',
            roulette: 'Roleta',
            result: 'Gabarito',
            admin: 'Admin',
          };
          const disabled = (tab === 'game' || tab === 'result') && !canStartGame;
          return (
            <button
              key={tab}
              type="button"
              disabled={disabled}
              onClick={() => onNavigate(tab)}
              className={`px-2.5 py-1.5 rounded-md whitespace-nowrap shrink-0 ${
                view === tab ? 'bg-sky-50 text-sky-800 font-semibold' : ''
              } disabled:opacity-40`}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>
    </header>
  );
}
