/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminView } from './components/AdminView.tsx';
import { GameView } from './components/GameView.tsx';
import { ResultView } from './components/ResultView.tsx';
import { RouletteView } from './components/RouletteView.tsx';
import { StartView } from './components/StartView.tsx';
import { TopBar } from './components/TopBar.tsx';
import { createDefaultRouletteData } from './data/defaultRoulette.ts';
import { DEFAULT_SCENES, ROUND_TARGET } from './data/defaultScenes.ts';
import type {
  GameState,
  Participation,
  QuizQuestion,
  RouletteData,
  RouletteSettings,
  Scene,
  ViewMode,
} from './types/gincana.ts';
import {
  clearPersistedGameState,
  clearRouletteParticipations,
  loadGameState,
  loadProject,
  loadRouletteData,
  persistGameState,
  recordRouletteSpin,
  resetRouletteDefaults,
  resetToDefaultScenes,
  saveProject,
  saveRouletteSettings,
  saveRouletteStock,
  subscribeProject,
  subscribeRouletteData,
  totalRegionsInScenes,
} from './utils/storage.ts';

interface ToastMessage {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'warn';
}

const INITIAL_GAME_STATE: GameState = {
  sceneIndex: 0,
  hits: 0,
  misses: 0,
  found: [],
  roundHits: 0,
  round: 1,
  pendingReset: false,
};

export default function App() {
  const [view, setView] = useState<ViewMode>('start');
  const [scenes, setScenes] = useState<Scene[]>(DEFAULT_SCENES);
  const [rouletteData, setRouletteData] = useState<RouletteData>(() => createDefaultRouletteData());
  const [rouletteRoundMode, setRouletteRoundMode] = useState(false);
  const [settledRoundNumber, setSettledRoundNumber] = useState<number | null>(null);
  const [savedGame, setSavedGame] = useState<GameState | null>(null);
  const [activeGame, setActiveGame] = useState<GameState>(INITIAL_GAME_STATE);
  const activeGameRef = useRef<GameState>(INITIAL_GAME_STATE);
  activeGameRef.current = activeGame;
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const toastTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastLocalSceneEditRef = useRef<number>(0);

  const showToast = useCallback((text: string, tone: 'info' | 'success' | 'warn' = 'info') => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), text, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2400);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubScenes: (() => void) | null = null;
    let unsubRoulette: (() => void) | null = null;

    Promise.all([loadProject(), loadGameState(), loadRouletteData()])
      .then(([project, game, roulette]) => {
        if (!active) return;
        if (project.scenes.length > 0) {
          setScenes(project.scenes);
        }
        if (game) {
          setSavedGame(game);
          setActiveGame(game);
        }
        setRouletteData(roulette);

        unsubScenes = subscribeProject((nextScenes) => {
          if (!active) return;
          if (Date.now() - lastLocalSceneEditRef.current < 1000) return;
          setScenes(nextScenes);
        });

        unsubRoulette = subscribeRouletteData(roulette, (nextRoulette) => {
          if (!active) return;
          setRouletteData(nextRoulette);
        });
      })
      .catch((err) => {
        console.error(err);
        if (active) {
          showToast('Erro ao carregar dados da nuvem. Recarregue se persistir.', 'warn');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      unsubScenes?.();
      unsubRoulette?.();
    };
  }, []);

  const totalRegions = totalRegionsInScenes(scenes);
  const canPlay = totalRegions >= ROUND_TARGET;
  const remainingRegions = Math.max(0, totalRegions - activeGame.found.length);

  const handleChangeScenes = useCallback(async (nextScenes: Scene[]) => {
    lastLocalSceneEditRef.current = Date.now();
    setScenes(nextScenes);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveProject(nextScenes);
    }, 380);
  }, []);

  const handleResetDefaults = useCallback(
    async (preserveCustom: boolean) => {
      const data = await resetToDefaultScenes(preserveCustom);
      setScenes(data.scenes);
      showToast('Cenários padrão restaurados com sucesso.', 'success');
    },
    [showToast],
  );

  const handleStartNewGame = useCallback(() => {
    if (!canPlay) {
      showToast(`Cadastre pelo menos ${ROUND_TARGET} regiões no total para iniciar.`, 'warn');
      return;
    }
    const fresh: GameState = {
      sceneIndex: 0,
      hits: 0,
      misses: 0,
      found: [],
      roundHits: 0,
      round: 1,
      pendingReset: false,
    };
    setActiveGame(fresh);
    setSavedGame(fresh);
    void persistGameState(fresh);
    setSettledRoundNumber(null);
    setRouletteRoundMode(false);
    setView('game');
  }, [canPlay, showToast]);

  const handleResumeGame = useCallback(() => {
    if (!canPlay) {
      showToast(`Cadastre pelo menos ${ROUND_TARGET} regiões no total para iniciar.`, 'warn');
      return;
    }
    if (savedGame) {
      setActiveGame(savedGame);
    }
    setSettledRoundNumber(null);
    setRouletteRoundMode(false);
    setView('game');
  }, [canPlay, savedGame, showToast]);

  const handleUpdateGame = useCallback((next: GameState) => {
    setActiveGame(next);
    setSavedGame(next);
    void persistGameState(next);
  }, []);

  const handleTriggerRoundRoulette = useCallback((nextSceneIndex?: number) => {
    if (typeof nextSceneIndex === 'number') {
      const updated = { ...activeGameRef.current, sceneIndex: nextSceneIndex };
      activeGameRef.current = updated;
      setActiveGame(updated);
      setSavedGame(updated);
      void persistGameState(updated);
    }
    setSettledRoundNumber(null);
    setRouletteRoundMode(true);
    setView('roulette');
  }, []);

  const advanceGameToNextRound = useCallback(
    (source: GameState): GameState =>
      source.pendingReset
        ? {
            sceneIndex: 0,
            hits: 0,
            misses: 0,
            found: [],
            roundHits: 0,
            round: source.round + 1,
            pendingReset: false,
          }
        : {
            ...source,
            round: source.round + 1,
            roundHits: 0,
          },
    [],
  );

  const handleFinishRoundNextPlayer = useCallback(() => {
    const nextState =
      settledRoundNumber !== null ? activeGame : advanceGameToNextRound(activeGame);
    if (settledRoundNumber === null) {
      setActiveGame(nextState);
      setSavedGame(nextState);
      void persistGameState(nextState);
    }
    setSettledRoundNumber(null);
    setRouletteRoundMode(false);
    setView('game');
    showToast(`Rodada ${nextState.round} iniciada!`, 'info');
  }, [activeGame, advanceGameToNextRound, settledRoundNumber, showToast]);

  const handleSpinComplete = useCallback(
    async (payload: Omit<Participation, 'id' | 'timestamp'>) => {
      try {
        const res = await recordRouletteSpin(payload);
        if ('error' in res) {
          return { ok: false, error: res.error };
        }
        setRouletteData(res.data);
        const currentGame = activeGameRef.current;
        if (rouletteRoundMode || currentGame.roundHits >= ROUND_TARGET) {
          const justFinishedRound = currentGame.round;
          const nextState = advanceGameToNextRound(currentGame);
          setSettledRoundNumber(justFinishedRound);
          setActiveGame(nextState);
          setSavedGame(nextState);
          void persistGameState(nextState);
        }
        return { ok: true, record: res.record };
      } catch (err) {
        console.error(err);
        return {
          ok: false,
          error: 'Não foi possível registrar a participação no banco de dados. Tente novamente.',
        };
      }
    },
    [advanceGameToNextRound, rouletteRoundMode],
  );

  const handleSaveRouletteSettings = useCallback(
    async (settings: RouletteSettings, quizQuestions: QuizQuestion[]) => {
      try {
        const updated = await saveRouletteSettings(
          settings,
          quizQuestions,
          rouletteData.participations,
        );
        setRouletteData(updated);
      } catch (err) {
        console.error(err);
        showToast('Erro ao salvar configurações da roleta.', 'warn');
        throw err;
      }
    },
    [rouletteData.participations, showToast],
  );

  const handleSaveRouletteStocks = useCallback(
    async (stocks: Record<string, Record<string, number>>) => {
      setRouletteData((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          stocks,
        },
      }));
      try {
        const updatedAt = await saveRouletteStock(stocks);
        setRouletteData((prev) => ({
          ...prev,
          settings: {
            ...prev.settings,
            stocks,
            updatedAt,
          },
        }));
      } catch (err) {
        console.error(err);
        showToast('Erro ao atualizar o estoque no Firebase.', 'warn');
        throw err;
      }
    },
    [showToast],
  );

  const handleClearRouletteHistory = useCallback(async () => {
    const updated = await clearRouletteParticipations();
    setRouletteData(updated);
    showToast('Histórico da roleta limpo.', 'info');
  }, [showToast]);

  const handleResetRoulette = useCallback(async () => {
    const updated = await resetRouletteDefaults();
    setRouletteData(updated);
    showToast('Configurações da roleta restauradas.', 'success');
  }, [showToast]);

  const handleFinishGame = useCallback(() => {
    setRouletteRoundMode(false);
    setView('result');
  }, []);

  const handleRestartFromResults = useCallback(() => {
    setSavedGame(null);
    setActiveGame(INITIAL_GAME_STATE);
    void clearPersistedGameState();
    setRouletteRoundMode(false);
    setView('start');
  }, []);

  const handleFinishAdmin = useCallback(() => {
    if (scenes.length === 0 || scenes.some((s) => s.points.length === 0)) {
      showToast('Cadastre ao menos uma região em cada imagem.', 'warn');
      return;
    }
    void saveProject(scenes);
    setView('start');
  }, [scenes, showToast]);

  const handleNavigate = useCallback(
    (next: ViewMode) => {
      if ((next === 'game' || next === 'result') && !canPlay) {
        showToast(`Cadastre pelo menos ${ROUND_TARGET} regiões para jogar.`, 'warn');
        return;
      }
      if (next === 'roulette') {
        setSettledRoundNumber(null);
        setRouletteRoundMode(false);
        setView('roulette');
        return;
      }
      if (next === 'game' && view !== 'game') {
        if (savedGame) {
          setActiveGame(savedGame);
        } else {
          handleStartNewGame();
          return;
        }
      }
      setSettledRoundNumber(null);
      setRouletteRoundMode(false);
      setView(next);
    },
    [canPlay, handleStartNewGame, savedGame, showToast, view],
  );

  const handlePrimaryAction = useCallback(() => {
    if (view === 'game') {
      handleFinishGame();
    } else if (savedGame) {
      handleResumeGame();
    } else {
      handleStartNewGame();
    }
  }, [handleFinishGame, handleResumeGame, handleStartNewGame, savedGame, view]);

  return (
    <div
      className={
        view === 'game'
          ? 'h-dvh overflow-hidden flex flex-col bg-slate-50 text-slate-900'
          : 'min-h-screen flex flex-col bg-slate-50 text-slate-900'
      }
    >
      <TopBar
        view={view}
        hasSavedGame={Boolean(savedGame)}
        canStartGame={canPlay}
        onNavigate={handleNavigate}
        onPrimaryAction={handlePrimaryAction}
      />

      <main
        className={
          view === 'game'
            ? 'flex-1 w-full max-w-none mx-auto px-2.5 sm:px-4 py-2 flex flex-col min-h-0 overflow-hidden'
            : 'flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8'
        }
      >
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
            Carregando cenários, imagens e roleta...
          </div>
        ) : view === 'start' ? (
          <StartView
            scenes={scenes}
            savedGame={savedGame}
            onStartNew={handleStartNewGame}
            onResumeGame={handleResumeGame}
            onOpenAdmin={() => setView('admin')}
          />
        ) : view === 'game' ? (
          <GameView
            scenes={scenes}
            gameState={activeGame}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            onUpdateGame={handleUpdateGame}
            onTriggerRoundRoulette={handleTriggerRoundRoulette}
            onFinishGame={handleFinishGame}
            onShowToast={showToast}
          />
        ) : view === 'roulette' ? (
          <RouletteView
            rouletteData={rouletteData}
            roundMode={rouletteRoundMode}
            roundNumber={settledRoundNumber ?? activeGame.round}
            remainingRegions={remainingRegions}
            pendingReset={activeGame.pendingReset}
            muted={muted}
            onSpinComplete={handleSpinComplete}
            onFinishRoundNextPlayer={handleFinishRoundNextPlayer}
            onBackToGame={() => {
              setSettledRoundNumber(null);
              setRouletteRoundMode(false);
              setView('game');
            }}
            onShowToast={showToast}
          />
        ) : view === 'result' ? (
          <ResultView
            scenes={scenes}
            gameState={activeGame}
            onRestart={handleRestartFromResults}
            onOpenAdmin={() => setView('admin')}
          />
        ) : (
          <AdminView
            scenes={scenes}
            rouletteData={rouletteData}
            onChangeScenes={handleChangeScenes}
            onResetDefaults={handleResetDefaults}
            onSaveRouletteSettings={handleSaveRouletteSettings}
            onSaveRouletteStocks={handleSaveRouletteStocks}
            onClearRouletteHistory={handleClearRouletteHistory}
            onResetRoulette={handleResetRoulette}
            onFinishAdmin={handleFinishAdmin}
            onShowToast={showToast}
          />
        )}
      </main>

      {view !== 'game' && (
        <footer className="border-t border-slate-200 bg-white py-4 px-4 text-center text-xs font-semibold text-slate-600">
          Segurança da Informação é responsabilidade de todos.
        </footer>
      )}

      {toast && (
        <div
          key={toast.id}
          role="status"
          className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg border transition-opacity ${
            toast.tone === 'success'
              ? 'bg-emerald-900 text-white border-emerald-700'
              : toast.tone === 'warn'
                ? 'bg-rose-900 text-white border-rose-700'
                : 'bg-slate-900 text-white border-slate-700'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
