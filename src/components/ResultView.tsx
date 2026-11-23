import { CheckCircle2, RotateCcw, Settings2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { PASSING_THRESHOLD } from '../data/defaultScenes.ts';
import type { ClassificationType, GameState, Scene } from '../types/gincana.ts';
import { totalRegionsInScenes } from '../utils/storage.ts';
import { ClassificationBadge } from './ClassificationBadge.tsx';

interface ResultViewProps {
  scenes: Scene[];
  gameState: GameState;
  onRestart: () => void;
  onOpenAdmin: () => void;
}

export function ResultView({ scenes, gameState, onRestart, onOpenAdmin }: ResultViewProps) {
  const [filter, setFilter] = useState<'all' | ClassificationType>('all');
  const foundSet = new Set(gameState.found);
  const totalAttempts = gameState.hits + gameState.misses;
  const accuracyPct = totalAttempts > 0 ? Math.round((gameState.hits / totalAttempts) * 100) : 0;
  const approved = accuracyPct >= PASSING_THRESHOLD;
  const totalRegions = totalRegionsInScenes(scenes);

  return (
    <div className="space-y-8">
      <section className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-10 text-center">
        <div className="max-w-xl mx-auto space-y-4">
          <div className="text-xs font-semibold text-slate-500">
            Resultado final · Critério mínimo {PASSING_THRESHOLD}%
          </div>

          <div
            className={`font-display text-6xl font-extrabold tabular-nums ${
              approved ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {accuracyPct}%
          </div>

          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-sm font-bold bg-slate-50 border-slate-200">
            {approved ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <span className="text-emerald-800">APROVADO</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-rose-700" />
                <span className="text-rose-800">NÃO APROVADO</span>
              </>
            )}
          </div>

          <p className="text-sm text-slate-600 tabular-nums">
            <strong className="text-slate-900">{gameState.hits}</strong> acerto(s) ·{' '}
            <strong className="text-slate-900">{gameState.misses}</strong> erro(s) ·{' '}
            <strong className="text-slate-900">
              {foundSet.size} de {totalRegions}
            </strong>{' '}
            regiões descobertas
          </p>

          <div className="pt-3 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Jogar novamente</span>
            </button>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold cursor-pointer"
            >
              <Settings2 className="w-4 h-4" />
              <span>Área admin</span>
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900">
              Explicativo das regiões
            </h2>
            <p className="text-sm text-slate-600">
              Gabarito completo com a justificativa de classificação de cada item.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'all', label: 'Todas' },
                { id: 'publica', label: 'Pública' },
                { id: 'interna', label: 'Interna' },
                { id: 'confidencial', label: 'Confidencial' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-8">
          {scenes.map((scene, si) => {
            const visiblePoints = scene.points
              .map((p, pi) => ({ p, pi, found: foundSet.has(`${si}-${pi}`) }))
              .filter((item) => filter === 'all' || item.p.type === filter);

            if (visiblePoints.length === 0) return null;

            return (
              <div key={scene.id} className="space-y-3">
                <div className="flex items-center gap-3 pb-2 border-b border-slate-200">
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Cenário {si + 1}: {scene.name}
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {visiblePoints.length} item(ns)
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {visiblePoints.map(({ p, pi, found }) => (
                    <div
                      key={p.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <ClassificationBadge type={p.type} />
                        <span
                          className={`text-xs font-medium tabular-nums ${
                            found ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          Região {pi + 1} · {found ? 'Encontrada' : 'Não encontrada'}
                        </span>
                      </div>
                      <div className="font-semibold text-sm text-slate-900">{p.desc}</div>
                      <p className="text-xs text-slate-600 leading-relaxed">{p.explain}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
