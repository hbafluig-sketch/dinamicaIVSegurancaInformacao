import { ArrowRight, Play, RotateCcw, Settings2 } from 'lucide-react';
import { PASSING_THRESHOLD, ROUND_TARGET } from '../data/defaultScenes.ts';
import type { GameState, Scene } from '../types/gincana.ts';
import { totalRegionsInScenes } from '../utils/storage.ts';
import { CLASSIFICATION_META, ClassificationIcon } from './ClassificationBadge.tsx';

interface StartViewProps {
  scenes: Scene[];
  savedGame: GameState | null;
  onStartNew: () => void;
  onResumeGame: () => void;
  onOpenAdmin: () => void;
}

export function StartView({
  scenes,
  savedGame,
  onStartNew,
  onResumeGame,
  onOpenAdmin,
}: StartViewProps) {
  const totalRegions = totalRegionsInScenes(scenes);
  const canPlay = totalRegions >= ROUND_TARGET;

  return (
    <div className="space-y-8">
      <section className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-10">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 mb-3">
            <span>A informação certa, com a proteção certa</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{scenes.length} cenários carregados</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{totalRegions} regiões mapeadas</span>
          </div>

          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 text-balance">
            Gincana de Segurança da Informação
          </h1>

          <p className="mt-4 text-base text-slate-600 leading-relaxed max-w-2xl">
            Observe cada cenário corporativo e clique diretamente onde identificar uma informação exposta. Cada participante deve encontrar{' '}
            <strong className="font-semibold text-slate-900 tabular-nums">{ROUND_TARGET} regiões</strong> para concluir sua rodada e girar a roleta. Critério mínimo de aprovação:{' '}
            <strong className="font-semibold text-slate-900 tabular-nums">{PASSING_THRESHOLD}%</strong> de precisão.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            {savedGame ? (
              <>
                <button
                  type="button"
                  onClick={onResumeGame}
                  disabled={!canPlay}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                >
                  <Play className="w-4 h-4" />
                  <span>
                    Continuar partida (Rodada {savedGame.round} · {savedGame.found.length}/{totalRegions})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onStartNew}
                  disabled={!canPlay}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Iniciar nova partida</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onStartNew}
                disabled={!canPlay}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
              >
                <Play className="w-4 h-4" />
                <span>Iniciar jogo</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={onOpenAdmin}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Settings2 className="w-4 h-4" />
              <span>Gerenciar cenários e regiões</span>
            </button>
          </div>

          {!canPlay && (
            <p className="mt-4 text-sm text-rose-700 font-medium">
              Cadastre pelo menos {ROUND_TARGET} regiões na Área admin para liberar o jogo.
            </p>
          )}
        </div>

        <div className="mt-10 pt-8 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-5">
          {(['publica', 'interna', 'confidencial'] as const).map((type) => {
            const meta = CLASSIFICATION_META[type];
            return (
              <div
                key={type}
                className={`rounded-xl border p-5 ${meta.bgClass} ${meta.borderClass}`}
              >
                <div className="flex items-center gap-2">
                  <ClassificationIcon type={type} className="w-5 h-5 shrink-0" />
                  <h2 className={`font-display text-base font-bold ${meta.textClass}`}>
                    {meta.label}
                  </h2>
                </div>
                <p className="mt-2.5 text-sm text-slate-700 leading-relaxed">{meta.summary}</p>
                <p className="mt-2 text-xs text-slate-600">{meta.examples}</p>
              </div>
            );
          })}
        </div>
      </section>

      {scenes.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Cenários incluídos nesta gincana
              </h2>
              <p className="text-sm text-slate-600">
                Todas as imagens e regiões ficam salvas no servidor e disponíveis imediatamente.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {scenes.map((scene, idx) => (
              <div
                key={scene.id}
                className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex flex-col"
              >
                <div className="aspect-[4/3] bg-slate-200 overflow-hidden">
                  <img
                    src={scene.thumbUrl || scene.imageUrl}
                    alt={scene.name}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="w-full h-full object-cover object-top"
                  />
                </div>
                <div className="p-3">
                  <div className="text-xs text-slate-500 tabular-nums">
                    Cenário {idx + 1} · {scene.points.length} regiões
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-slate-900 truncate" title={scene.name}>
                    {scene.name}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
