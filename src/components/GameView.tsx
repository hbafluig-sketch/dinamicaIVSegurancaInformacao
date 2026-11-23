import {
  ArrowLeft,
  ArrowRight,
  Flag,
  HelpCircle,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ROUND_TARGET } from '../data/defaultScenes.ts';
import type { GameState, RegionPoint, Scene } from '../types/gincana.ts';
import { playTone } from '../utils/sound.ts';
import { totalRegionsInScenes } from '../utils/storage.ts';
import { CLASSIFICATION_META, ClassificationBadge } from './ClassificationBadge.tsx';
import { SceneStageFrame } from './SceneStageFrame.tsx';

interface GameViewProps {
  scenes: Scene[];
  gameState: GameState;
  muted: boolean;
  onToggleMute: () => void;
  onUpdateGame: (next: GameState) => void;
  onTriggerRoundRoulette: (nextSceneIndex?: number) => void;
  onFinishGame: () => void;
  onShowToast: (msg: string, tone?: 'info' | 'success' | 'warn') => void;
}

function findNextUnfinishedSceneIndex(
  scenes: Scene[],
  foundSet: Set<string>,
  currentIdx: number,
): number | null {
  for (let offset = 1; offset < scenes.length; offset++) {
    const idx = (currentIdx + offset) % scenes.length;
    const sc = scenes[idx];
    if (sc.points.some((_, pi) => !foundSet.has(`${idx}-${pi}`))) {
      return idx;
    }
  }
  const cur = scenes[currentIdx];
  if (cur && cur.points.some((_, pi) => !foundSet.has(`${currentIdx}-${pi}`))) {
    return currentIdx;
  }
  return null;
}

export function GameView({
  scenes,
  gameState,
  muted,
  onToggleMute,
  onUpdateGame,
  onTriggerRoundRoulette,
  onFinishGame,
  onShowToast,
}: GameViewProps) {
  const [missPulse, setMissPulse] = useState<{ x: number; y: number; key: number } | null>(null);
  const [lastFound, setLastFound] = useState<RegionPoint | null>(null);
  const [confirmAction, setConfirmAction] = useState<'next' | 'end' | null>(null);
  const [transitioningToRoulette, setTransitioningToRoulette] = useState(false);
  const [advancingScene, setAdvancingScene] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSidebarInFullscreen, setShowSidebarInFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const safeSceneIdx = Math.max(0, Math.min(gameState.sceneIndex, scenes.length - 1));
  const scene = scenes[safeSceneIdx];
  const totalRegions = totalRegionsInScenes(scenes);
  const foundSet = new Set(gameState.found);
  const remaining = Math.max(0, totalRegions - foundSet.size);

  // Preload next scene image for instant navigation
  useEffect(() => {
    const nextScene = scenes[safeSceneIdx + 1];
    if (nextScene) {
      const img = new Image();
      img.src = nextScene.imageUrl;
    }
  }, [safeSceneIdx, scenes]);

  // Sync Escape key and native browser fullscreen exit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        setShowSidebarInFullscreen(false);
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
        }
      }
    };
    const handleFsChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
        setShowSidebarInFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFsChange);
    };
  }, [isFullscreen]);

  const exitFullscreenCleanly = () => {
    setIsFullscreen(false);
    setShowSidebarInFullscreen(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  };

  const toggleFullscreen = () => {
    if (isFullscreen) {
      exitFullscreenCleanly();
      return;
    }
    setIsFullscreen(true);
    if (rootRef.current?.requestFullscreen) {
      void rootRef.current.requestFullscreen().catch(() => {
        // CSS fixed inset-0 fullscreen still works cleanly inside iframes
      });
    }
  };

  if (!scene) {
    return null;
  }

  const foundInCurrentScene = scene.points
    .map((p, idx) => ({ p, idx, key: `${safeSceneIdx}-${idx}` }))
    .filter((item) => foundSet.has(item.key));

  const handleRegionClick = (e: React.MouseEvent, point: RegionPoint, idx: number) => {
    e.stopPropagation();
    if (transitioningToRoulette || advancingScene) return;

    const key = `${safeSceneIdx}-${idx}`;
    if (foundSet.has(key)) {
      setLastFound(point);
      onShowToast('Esta região já foi encontrada. Procure outra.', 'info');
      return;
    }

    const nextFound = [...gameState.found, key];
    const nextFoundSet = new Set(nextFound);
    const baseRoundHits = gameState.roundHits >= ROUND_TARGET ? 0 : gameState.roundHits;
    const nextRoundHits = baseRoundHits + 1;
    const nextHits = gameState.hits + 1;
    const nextRemaining = Math.max(0, totalRegions - nextFound.length);
    const completedRound = nextRoundHits >= ROUND_TARGET;
    const allFoundInCurrentScene = scene.points.every((_, pi) =>
      nextFoundSet.has(`${safeSceneIdx}-${pi}`),
    );
    const nextUnfinishedIdx = allFoundInCurrentScene
      ? findNextUnfinishedSceneIndex(scenes, nextFoundSet, safeSceneIdx)
      : safeSceneIdx;

    const nextState: GameState = {
      ...gameState,
      sceneIndex: safeSceneIdx,
      hits: nextHits,
      roundHits: nextRoundHits,
      found: nextFound,
      pendingReset: completedRound ? nextRemaining < ROUND_TARGET : gameState.pendingReset,
    };

    onUpdateGame(nextState);
    setLastFound(point);
    playTone(completedRound ? 'round' : 'hit', muted);

    if (completedRound) {
      setTransitioningToRoulette(true);
      onShowToast('3 pontos encontrados! Abrindo a roleta de cibersegurança...', 'success');
      const targetAfterRound =
        allFoundInCurrentScene && nextUnfinishedIdx !== null && nextUnfinishedIdx !== safeSceneIdx
          ? nextUnfinishedIdx
          : undefined;
      setTimeout(() => {
        setTransitioningToRoulette(false);
        exitFullscreenCleanly();
        onTriggerRoundRoulette(targetAfterRound);
      }, 650);
    } else if (allFoundInCurrentScene) {
      setAdvancingScene(true);
      if (nextUnfinishedIdx !== null && nextUnfinishedIdx !== safeSceneIdx) {
        onShowToast('Cenário concluído! Avançando para a próxima imagem...', 'success');
        setTimeout(() => {
          setAdvancingScene(false);
          setLastFound(null);
          onUpdateGame({
            ...nextState,
            sceneIndex: nextUnfinishedIdx,
          });
        }, 650);
      } else {
        onShowToast('Todas as regiões foram encontradas! Exibindo resultado final...', 'success');
        setTimeout(() => {
          setAdvancingScene(false);
          exitFullscreenCleanly();
          onFinishGame();
        }, 750);
      }
    } else {
      onShowToast(`Informação encontrada: ${point.desc}`, 'success');
    }
  };

  const handleStageMiss = (e: React.MouseEvent<HTMLDivElement>) => {
    if (transitioningToRoulette || advancingScene || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMissPulse({ x, y, key: Date.now() });
    playTone('miss', muted);
    onUpdateGame({
      ...gameState,
      sceneIndex: safeSceneIdx,
      misses: gameState.misses + 1,
    });
    onShowToast('Nenhuma informação exposta foi cadastrada neste ponto.', 'warn');
  };

  const tryAdvanceScene = () => {
    const allFoundInScene = scene.points.every((_, i) => foundSet.has(`${safeSceneIdx}-${i}`));
    if (!allFoundInScene) {
      setConfirmAction('next');
      return;
    }
    proceedNextScene();
  };

  const proceedNextScene = () => {
    setConfirmAction(null);
    setLastFound(null);
    if (safeSceneIdx < scenes.length - 1) {
      onUpdateGame({
        ...gameState,
        sceneIndex: safeSceneIdx + 1,
      });
    } else {
      exitFullscreenCleanly();
      onFinishGame();
    }
  };

  const handlePrevScene = () => {
    if (safeSceneIdx > 0) {
      setLastFound(null);
      onUpdateGame({
        ...gameState,
        sceneIndex: safeSceneIdx - 1,
      });
    }
  };

  const sidebarContent = (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <HelpCircle className="w-4 h-4 text-sky-700" />
          <span>Como jogar</span>
        </div>
        <p className="mt-1.5 text-xs sm:text-sm text-slate-600 leading-relaxed">
          Clique diretamente nos elementos da imagem onde houver informação exposta. Ao completar{' '}
          <strong className="text-slate-900">3 acertos</strong>, a Roleta de Cibersegurança será aberta automaticamente.
        </p>
      </div>

      {lastFound && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-500">Última descoberta</div>
          <ClassificationBadge type={lastFound.type} />
          <div className="font-display font-bold text-sm text-slate-900">{lastFound.desc}</div>
          <p className="text-xs text-slate-600 leading-relaxed">{lastFound.explain}</p>
        </div>
      )}

      <div className="pt-3 border-t border-slate-200">
        <h3 className="text-xs sm:text-sm font-bold text-slate-900 mb-2.5 tabular-nums">
          Descobertas neste cenário ({foundInCurrentScene.length}/{scene.points.length})
        </h3>
        {foundInCurrentScene.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nenhuma região encontrada nesta imagem ainda. Clique nos pontos de risco da cena.
          </p>
        ) : (
          <ul className="space-y-2">
            {foundInCurrentScene.map(({ p, idx }) => (
              <li
                key={p.id}
                className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/70 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <ClassificationBadge type={p.type} compact />
                  <span className="text-[11px] text-slate-400 tabular-nums">#{idx + 1}</span>
                </div>
                <div className="text-xs font-semibold text-slate-900">{p.desc}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-40 bg-slate-950 text-white flex flex-col overflow-hidden'
          : 'flex-1 flex flex-col gap-3 min-h-0 lg:h-[calc(100dvh-84px)]'
      }
    >
      {/* Top HUD Bar */}
      <div
        className={
          isFullscreen
            ? 'shrink-0 bg-slate-900/95 border-b border-slate-800 px-3 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-3'
            : 'shrink-0 bg-white rounded-xl border border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3'
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm">
          <div
            className={`font-display font-bold tabular-nums ${
              isFullscreen ? 'text-white' : 'text-slate-900'
            }`}
          >
            Imagem {safeSceneIdx + 1}/{scenes.length}
            {isFullscreen && (
              <span className="hidden sm:inline font-normal text-slate-300"> · {scene.name}</span>
            )}
          </div>
          <span className={isFullscreen ? 'text-slate-700' : 'text-slate-300'} aria-hidden="true">
            |
          </span>
          <div className={isFullscreen ? 'text-slate-300 tabular-nums' : 'text-slate-600 tabular-nums'}>
            Rodada{' '}
            <strong className={isFullscreen ? 'text-white font-bold' : 'text-slate-900 font-bold'}>
              {gameState.round}
            </strong>
          </div>
          <div className={isFullscreen ? 'text-slate-300 tabular-nums' : 'text-slate-600 tabular-nums'}>
            Pessoa atual:{' '}
            <strong className={isFullscreen ? 'text-sky-400 font-bold' : 'text-sky-700 font-bold'}>
              {gameState.roundHits >= ROUND_TARGET && !transitioningToRoulette ? 0 : gameState.roundHits}/{ROUND_TARGET}
            </strong>
          </div>
          <div className={isFullscreen ? 'text-slate-300 tabular-nums' : 'text-slate-600 tabular-nums'}>
            Encontrados:{' '}
            <strong className={isFullscreen ? 'text-emerald-400 font-bold' : 'text-emerald-700 font-bold'}>
              {foundSet.size}
            </strong>
          </div>
          <div className={isFullscreen ? 'text-slate-300 tabular-nums' : 'text-slate-600 tabular-nums'}>
            Restantes:{' '}
            <strong className={isFullscreen ? 'text-white font-bold' : 'text-slate-900 font-bold'}>
              {remaining}
            </strong>
          </div>
          <div className={isFullscreen ? 'text-slate-300 tabular-nums' : 'text-slate-600 tabular-nums'}>
            Erros:{' '}
            <strong className={isFullscreen ? 'text-rose-400 font-bold' : 'text-rose-700 font-bold'}>
              {gameState.misses}
            </strong>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isFullscreen && (
            <>
              <button
                type="button"
                onClick={handlePrevScene}
                disabled={safeSceneIdx === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold disabled:opacity-40 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Anterior</span>
              </button>
              <button
                type="button"
                onClick={tryAdvanceScene}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer"
              >
                <span>{safeSceneIdx === scenes.length - 1 ? 'Finalizar' : 'Próxima'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction('end')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold cursor-pointer"
              >
                <Flag className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Encerrar</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSidebarInFullscreen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold cursor-pointer"
              >
                {showSidebarInFullscreen ? (
                  <PanelRightClose className="w-3.5 h-3.5" />
                ) : (
                  <PanelRightOpen className="w-3.5 h-3.5" />
                )}
                <span className="hidden md:inline">Painel</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Ativar sons' : 'Silenciar sons'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
              isFullscreen
                ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{muted ? 'Som mudo' : 'Som ativo'}</span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
              isFullscreen
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                : 'bg-slate-900 hover:bg-slate-800 text-white'
            }`}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Sair da tela cheia</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Tela cheia</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Stage + Optional Sidebar */}
      <div
        className={
          isFullscreen
            ? 'flex-1 min-h-0 flex relative overflow-hidden'
            : 'flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4'
        }
      >
        {/* Interactive Scene Stage */}
        <div
          className={
            isFullscreen
              ? 'flex-1 min-w-0 min-h-0 flex flex-col p-2 sm:p-3 gap-2'
              : 'min-h-0 bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 flex flex-col gap-3'
          }
        >
          {!isFullscreen && (
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 truncate">
                  {scene.name}
                </h2>
                <p className="text-xs text-slate-500 tabular-nums">
                  {foundInCurrentScene.length} de {scene.points.length} regiões identificadas nesta imagem
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handlePrevScene}
                  disabled={safeSceneIdx === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Anterior</span>
                </button>
                <button
                  type="button"
                  onClick={tryAdvanceScene}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>{safeSceneIdx === scenes.length - 1 ? 'Finalizar' : 'Próxima imagem'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAction('end')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>Encerrar</span>
                </button>
              </div>
            </div>
          )}

          {/* Uniform Auto-Sized Fullscreen Stage Container */}
          <div
            className={
              isFullscreen
                ? 'flex-1 min-h-0 w-full'
                : 'h-[64dvh] min-h-[380px] lg:h-auto lg:flex-1 lg:min-h-0 w-full'
            }
          >
            <SceneStageFrame
              imageUrl={scene.imageUrl}
              alt={scene.name}
              naturalWidth={scene.naturalWidth}
              naturalHeight={scene.naturalHeight}
              hideLegendPct={scene.hideLegendPct}
              applyCrop={true}
              fillStage={true}
              innerRef={stageRef}
              onStageClick={handleStageMiss}
              className="cursor-crosshair"
            >
              {scene.points.map((point, idx) => {
                const isFound = foundSet.has(`${safeSceneIdx}-${idx}`);
                const meta = CLASSIFICATION_META[point.type];
                return (
                  <button
                    key={point.id}
                    type="button"
                    aria-label={isFound ? `${point.desc} (${meta.shortLabel})` : 'Ponto interativo'}
                    onClick={(e) => handleRegionClick(e, point, idx)}
                    style={{
                      left: `${point.x}%`,
                      top: `${point.y}%`,
                      width: `${point.w}%`,
                      height: `${point.h}%`,
                    }}
                    className={`absolute rounded-lg transition-all duration-150 cursor-pointer focus:outline-none ${
                      isFound
                        ? `${meta.regionBg} border-2 ${meta.regionBorder}`
                        : 'bg-transparent border-0 hover:bg-white/5'
                    }`}
                  >
                    {isFound && (
                      <span className="sr-only">
                        {point.desc} - {meta.label}
                      </span>
                    )}
                  </button>
                );
              })}

              {missPulse && (
                <span
                  key={missPulse.key}
                  style={{ left: `${missPulse.x}%`, top: `${missPulse.y}%` }}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 border-rose-500 bg-rose-500/20 animate-ping"
                />
              )}
            </SceneStageFrame>
          </div>

          {/* Scene quick switcher */}
          <div className="shrink-0 flex items-center gap-2 overflow-x-auto pb-0.5">
            {scenes.map((sc, i) => {
              const scFound = sc.points.filter((_, pi) => foundSet.has(`${i}-${pi}`)).length;
              const isCurrent = i === safeSceneIdx;
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => {
                    setLastFound(null);
                    onUpdateGame({ ...gameState, sceneIndex: i });
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                    isFullscreen
                      ? isCurrent
                        ? 'bg-sky-600 border-sky-500 text-white font-semibold'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                      : isCurrent
                        ? 'bg-sky-50 border-sky-300 text-sky-900 font-semibold'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {i + 1}. {sc.name.split('—')[0].trim()} ({scFound}/{sc.points.length})
                </button>
              );
            })}
          </div>
        </div>

        {/* Normal Desktop Sidebar */}
        {!isFullscreen && (
          <aside className="bg-white rounded-2xl border border-slate-200 p-4 overflow-y-auto min-h-0">
            {sidebarContent}
          </aside>
        )}

        {/* Collapsible Drawer Sidebar inside Fullscreen */}
        {isFullscreen && showSidebarInFullscreen && (
          <aside className="w-80 max-w-[85vw] shrink-0 bg-white text-slate-900 border-l border-slate-200 p-4 overflow-y-auto shadow-2xl">
            {sidebarContent}
          </aside>
        )}
      </div>

      {/* Confirmation Modal (Next Scene / End Game) */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 text-slate-900">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="font-display text-lg font-bold text-slate-900">
              {confirmAction === 'next'
                ? 'Avançar com regiões pendentes?'
                : 'Encerrar o jogo agora?'}
            </h3>
            <p className="text-sm text-slate-600">
              {confirmAction === 'next'
                ? 'Ainda existem regiões não encontradas nesta imagem. Deseja avançar para a próxima mesmo assim?'
                : 'Você será direcionado para a tela de resultado final com o gabarito completo de todas as regiões.'}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold cursor-pointer"
              >
                Continuar jogando
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmAction === 'next') proceedNextScene();
                  else {
                    setConfirmAction(null);
                    exitFullscreenCleanly();
                    onFinishGame();
                  }
                }}
                className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold cursor-pointer"
              >
                {confirmAction === 'next' ? 'Avançar' : 'Ver resultado final'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
