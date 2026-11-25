/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { User } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminView } from './components/AdminView.tsx';
import { GameView } from './components/GameView.tsx';
import { ResultView } from './components/ResultView.tsx';
import { RouletteView } from './components/RouletteView.tsx';
import { StartView } from './components/StartView.tsx';
import { TopBar } from './components/TopBar.tsx';
import { createDefaultRouletteData } from './data/defaultRoulette.ts';
import { DEFAULT_SCENES, ROUND_TARGET } from './data/defaultScenes.ts';
import {
  clearGoogleAccessToken,
  googleSignIn,
  googleSignOut,
  initGoogleAuth,
} from './firebase.ts';
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
  appendParticipationToSheet,
  clearParticipationsInSheet,
  createGincanaSpreadsheet,
  type GoogleSheetConfig,
  GoogleSheetsAuthError,
  inspectSpreadsheet,
  loadAllFromGoogleSheet,
  loadSavedSheetConfig,
  saveSheetConfig,
  syncAllToGoogleSheet,
  syncScenesToSheet,
  syncSettingsToSheet,
  syncStocksToSheet,
} from './utils/googleSheets.ts';
import {
  cacheProjectLocal,
  cacheRouletteLocal,
  clearPersistedGameState,
  clearRouletteParticipations,
  isFirestoreQuotaFallback,
  loadGameState,
  loadProject,
  loadRouletteData,
  persistGameState,
  recordLocalRouletteSpin,
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
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [sheetConfig, setSheetConfig] = useState<GoogleSheetConfig | null>(() =>
    loadSavedSheetConfig(),
  );
  const [sheetBusyAction, setSheetBusyAction] = useState<string | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastLocalSceneEditRef = useRef<number>(0);

  const rouletteDataRef = useRef<RouletteData>(rouletteData);
  rouletteDataRef.current = rouletteData;
  const scenesRef = useRef<Scene[]>(scenes);
  scenesRef.current = scenes;
  const googleTokenRef = useRef<string | null>(googleToken);
  googleTokenRef.current = googleToken;
  const sheetConfigRef = useRef<GoogleSheetConfig | null>(sheetConfig);
  sheetConfigRef.current = sheetConfig;

  const showToast = useCallback((text: string, tone: 'info' | 'success' | 'warn' = 'info') => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), text, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2800);
  }, []);

  useEffect(() => {
    const unsubAuth = initGoogleAuth(
      (user, token) => {
        setGoogleUser(user);
        setGoogleToken(token);
      },
      (user) => {
        setGoogleUser(user);
        setGoogleToken(null);
      },
    );
    return () => unsubAuth();
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

        if (isFirestoreQuotaFallback()) {
          showToast(
            'Cota diária do Firebase atingida. Exibindo últimos dados em cache local para consulta e exportação.',
            'warn',
          );
        }

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

  const handleSheetsError = useCallback(
    (err: unknown, fallbackMessage: string) => {
      console.error(err);
      if (err instanceof GoogleSheetsAuthError) {
        clearGoogleAccessToken();
        setGoogleToken(null);
        showToast(
          err.message ||
            'Sessão do Google expirada. Faça login novamente na aba Google Sheets.',
          'warn',
        );
        return;
      }
      showToast(err instanceof Error ? err.message : fallbackMessage, 'warn');
    },
    [showToast],
  );

  const touchSheetSyncTime = useCallback(() => {
    const cur = sheetConfigRef.current;
    if (!cur) return;
    const updated: GoogleSheetConfig = { ...cur, lastSyncedAt: new Date().toISOString() };
    setSheetConfig(updated);
    saveSheetConfig(updated);
  }, []);

  const handlePullAllFromSheet = useCallback(
    async (explicitToken?: string, explicitConfig?: GoogleSheetConfig) => {
      const token = explicitToken ?? googleTokenRef.current;
      const cfg = explicitConfig ?? sheetConfigRef.current;
      if (!token || !cfg) return;
      setSheetBusyAction('pull');
      try {
        const loaded = await loadAllFromGoogleSheet(
          token,
          cfg.spreadsheetId,
          rouletteDataRef.current,
          scenesRef.current,
        );
        if (loaded.hasSheetData) {
          setRouletteData(loaded.rouletteData);
          setScenes(loaded.scenes);
          cacheRouletteLocal(loaded.rouletteData);
          cacheProjectLocal({
            version: 8,
            updatedAt: new Date().toISOString(),
            scenes: loaded.scenes,
          });
          touchSheetSyncTime();
          showToast('Dados carregados da planilha Google Sheets.', 'success');
        } else {
          showToast('A planilha conectada ainda não possui dados preenchidos.', 'info');
        }
      } catch (err) {
        handleSheetsError(err, 'Erro ao ler dados do Google Sheets.');
      } finally {
        setSheetBusyAction(null);
      }
    },
    [handleSheetsError, showToast, touchSheetSyncTime],
  );

  const handleGoogleSignIn = useCallback(async () => {
    setIsGoogleSigningIn(true);
    try {
      const { user, accessToken } = await googleSignIn();
      setGoogleUser(user);
      setGoogleToken(accessToken);
      showToast('Conta Google conectada ao Google Sheets.', 'success');
      if (sheetConfigRef.current) {
        await handlePullAllFromSheet(accessToken, sheetConfigRef.current);
      }
    } catch (err) {
      console.error(err);
      showToast(
        err instanceof Error ? err.message : 'Não foi possível conectar sua conta Google.',
        'warn',
      );
    } finally {
      setIsGoogleSigningIn(false);
    }
  }, [handlePullAllFromSheet, showToast]);

  const handleGoogleSignOut = useCallback(async () => {
    await googleSignOut();
    setGoogleUser(null);
    setGoogleToken(null);
    showToast('Sessão Google desconectada.', 'info');
  }, [showToast]);

  const handleCreateSpreadsheet = useCallback(
    async (title: string) => {
      const token = googleTokenRef.current;
      if (!token) {
        showToast('Conecte sua conta Google primeiro.', 'warn');
        return;
      }
      setSheetBusyAction('create');
      try {
        const cfg = await createGincanaSpreadsheet(
          token,
          rouletteDataRef.current,
          scenesRef.current,
          title,
        );
        setSheetConfig(cfg);
        showToast(`Planilha "${cfg.spreadsheetTitle}" criada e sincronizada!`, 'success');
      } catch (err) {
        handleSheetsError(err, 'Não foi possível criar a planilha no Google Sheets.');
      } finally {
        setSheetBusyAction(null);
      }
    },
    [handleSheetsError, showToast],
  );

  const handleConnectSpreadsheet = useCallback(
    async (spreadsheetId: string) => {
      const token = googleTokenRef.current;
      if (!token) {
        showToast('Conecte sua conta Google primeiro.', 'warn');
        return;
      }
      setSheetBusyAction('connect');
      try {
        const info = await inspectSpreadsheet(token, spreadsheetId);
        const cfg: GoogleSheetConfig = {
          spreadsheetId: info.spreadsheetId,
          spreadsheetTitle: info.spreadsheetTitle,
          spreadsheetUrl: info.spreadsheetUrl,
          autoSyncEnabled: false,
        };
        setSheetConfig(cfg);
        saveSheetConfig(cfg);
        showToast(`Planilha "${cfg.spreadsheetTitle}" vinculada com sucesso.`, 'success');
        await handlePullAllFromSheet(token, cfg);
      } catch (err) {
        handleSheetsError(err, 'Não foi possível acessar a planilha informada.');
      } finally {
        setSheetBusyAction(null);
      }
    },
    [handlePullAllFromSheet, handleSheetsError, showToast],
  );

  const handleToggleSheetAutoSync = useCallback(
    (enabled: boolean) => {
      const cur = sheetConfigRef.current;
      if (!cur) return;
      const updated: GoogleSheetConfig = { ...cur, autoSyncEnabled: enabled };
      setSheetConfig(updated);
      saveSheetConfig(updated);
      showToast(
        enabled
          ? 'Gravação automática no Google Sheets ativada.'
          : 'Gravação automática no Google Sheets desativada.',
        enabled ? 'success' : 'info',
      );
    },
    [showToast],
  );

  const handlePushAllToSheet = useCallback(async () => {
    const token = googleTokenRef.current;
    const cfg = sheetConfigRef.current;
    if (!token || !cfg) return;
    setSheetBusyAction('push');
    try {
      await syncAllToGoogleSheet(
        token,
        cfg.spreadsheetId,
        rouletteDataRef.current,
        scenesRef.current,
      );
      touchSheetSyncTime();
      showToast('Todos os dados foram enviados para o Google Sheets.', 'success');
    } catch (err) {
      handleSheetsError(err, 'Erro ao enviar dados para o Google Sheets.');
    } finally {
      setSheetBusyAction(null);
    }
  }, [handleSheetsError, showToast, touchSheetSyncTime]);

  const handleClearSheetParticipations = useCallback(async () => {
    const token = googleTokenRef.current;
    const cfg = sheetConfigRef.current;
    if (!token || !cfg) return;
    setSheetBusyAction('clear');
    try {
      await clearParticipationsInSheet(token, cfg.spreadsheetId);
      touchSheetSyncTime();
      showToast('Aba Participacoes limpa no Google Sheets.', 'info');
    } catch (err) {
      handleSheetsError(err, 'Erro ao limpar participações na planilha.');
    } finally {
      setSheetBusyAction(null);
    }
  }, [handleSheetsError, showToast, touchSheetSyncTime]);

  const handleDisconnectSheet = useCallback(() => {
    setSheetConfig(null);
    saveSheetConfig(null);
    showToast('Planilha desvinculada do aplicativo.', 'info');
  }, [showToast]);

  const totalRegions = totalRegionsInScenes(scenes);
  const canPlay = totalRegions >= ROUND_TARGET;
  const remainingRegions = Math.max(0, totalRegions - activeGame.found.length);

  const handleChangeScenes = useCallback(
    async (nextScenes: Scene[]) => {
      lastLocalSceneEditRef.current = Date.now();
      setScenes(nextScenes);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        void saveProject(nextScenes);
        const token = googleTokenRef.current;
        const cfg = sheetConfigRef.current;
        if (token && cfg?.autoSyncEnabled) {
          void syncScenesToSheet(token, cfg.spreadsheetId, nextScenes)
            .then(() => touchSheetSyncTime())
            .catch((err) => handleSheetsError(err, 'Erro ao salvar cenários no Google Sheets.'));
        }
      }, 380);
    },
    [handleSheetsError, touchSheetSyncTime],
  );

  const handleResetDefaults = useCallback(
    async (preserveCustom: boolean) => {
      const data = await resetToDefaultScenes(preserveCustom);
      setScenes(data.scenes);
      const token = googleTokenRef.current;
      const cfg = sheetConfigRef.current;
      if (token && cfg?.autoSyncEnabled) {
        try {
          await syncScenesToSheet(token, cfg.spreadsheetId, data.scenes);
          touchSheetSyncTime();
        } catch (err) {
          handleSheetsError(err, 'Erro ao atualizar cenários na planilha.');
        }
      }
      showToast('Cenários padrão restaurados com sucesso.', 'success');
    },
    [handleSheetsError, showToast, touchSheetSyncTime],
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
        const token = googleTokenRef.current;
        const cfg = sheetConfigRef.current;
        const useSheetsPrimary = Boolean(token && cfg?.autoSyncEnabled);

        const res = useSheetsPrimary
          ? await recordLocalRouletteSpin(rouletteDataRef.current, payload)
          : await recordRouletteSpin(payload, rouletteDataRef.current);

        if ('error' in res) {
          return { ok: false, error: res.error };
        }

        if (useSheetsPrimary && token && cfg) {
          await appendParticipationToSheet(
            token,
            cfg.spreadsheetId,
            res.record,
            res.data.settings.stocks,
            res.data.settings.items,
            res.data.settings.factories,
          );
          touchSheetSyncTime();
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
        if (err instanceof GoogleSheetsAuthError) {
          clearGoogleAccessToken();
          setGoogleToken(null);
          return {
            ok: false,
            error: 'Sessão do Google expirada. Clique em Sign in with Google para continuar salvando na planilha.',
          };
        }
        return {
          ok: false,
          error: 'Não foi possível registrar a participação no banco de dados. Tente novamente.',
        };
      }
    },
    [advanceGameToNextRound, rouletteRoundMode, touchSheetSyncTime],
  );

  const handleSaveRouletteSettings = useCallback(
    async (settings: RouletteSettings, quizQuestions: QuizQuestion[]) => {
      const token = googleTokenRef.current;
      const cfg = sheetConfigRef.current;
      const useSheetsPrimary = Boolean(token && cfg?.autoSyncEnabled);

      try {
        const updated = await saveRouletteSettings(
          settings,
          quizQuestions,
          rouletteData.participations,
          useSheetsPrimary,
        );
        if (useSheetsPrimary && token && cfg) {
          await syncSettingsToSheet(token, cfg.spreadsheetId, updated.settings, updated.quizQuestions);
          touchSheetSyncTime();
        }
        setRouletteData(updated);
      } catch (err) {
        if (err instanceof GoogleSheetsAuthError) {
          handleSheetsError(err, 'Sessão do Google expirada.');
        } else {
          console.error(err);
          showToast('Erro ao salvar configurações da roleta.', 'warn');
        }
        throw err;
      }
    },
    [handleSheetsError, rouletteData.participations, showToast, touchSheetSyncTime],
  );

  const handleSaveRouletteStocks = useCallback(
    async (stocks: Record<string, Record<string, number>>) => {
      const token = googleTokenRef.current;
      const cfg = sheetConfigRef.current;
      const useSheetsPrimary = Boolean(token && cfg?.autoSyncEnabled);

      setRouletteData((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          stocks,
        },
      }));
      try {
        const updatedAt = await saveRouletteStock(stocks, useSheetsPrimary);
        if (useSheetsPrimary && token && cfg) {
          await syncStocksToSheet(
            token,
            cfg.spreadsheetId,
            stocks,
            rouletteDataRef.current.settings.items,
            rouletteDataRef.current.settings.factories,
          );
          touchSheetSyncTime();
        }
        setRouletteData((prev) => ({
          ...prev,
          settings: {
            ...prev.settings,
            stocks,
            updatedAt,
          },
        }));
      } catch (err) {
        if (err instanceof GoogleSheetsAuthError) {
          handleSheetsError(err, 'Sessão do Google expirada.');
        } else {
          console.error(err);
          showToast('Erro ao atualizar o estoque.', 'warn');
        }
        throw err;
      }
    },
    [handleSheetsError, showToast, touchSheetSyncTime],
  );

  const handleClearRouletteHistory = useCallback(async () => {
    const token = googleTokenRef.current;
    const cfg = sheetConfigRef.current;
    const useSheetsPrimary = Boolean(token && cfg?.autoSyncEnabled);

    const updated = await clearRouletteParticipations(useSheetsPrimary);
    if (useSheetsPrimary && token && cfg) {
      try {
        await clearParticipationsInSheet(token, cfg.spreadsheetId);
        touchSheetSyncTime();
      } catch (err) {
        handleSheetsError(err, 'Erro ao limpar participações na planilha.');
      }
    }
    setRouletteData(updated);
    showToast('Histórico da roleta limpo.', 'info');
  }, [handleSheetsError, showToast, touchSheetSyncTime]);

  const handleResetRoulette = useCallback(async () => {
    const token = googleTokenRef.current;
    const cfg = sheetConfigRef.current;
    const useSheetsPrimary = Boolean(token && cfg?.autoSyncEnabled);

    const updated = await resetRouletteDefaults(useSheetsPrimary);
    if (useSheetsPrimary && token && cfg) {
      try {
        await syncSettingsToSheet(token, cfg.spreadsheetId, updated.settings, updated.quizQuestions);
        touchSheetSyncTime();
      } catch (err) {
        handleSheetsError(err, 'Erro ao restaurar padrões na planilha.');
      }
    }
    setRouletteData(updated);
    showToast('Configurações da roleta restauradas.', 'success');
  }, [handleSheetsError, showToast, touchSheetSyncTime]);

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
        view === 'game' || view === 'roulette'
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
            : view === 'roulette'
              ? 'flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 py-2 sm:py-3 flex flex-col min-h-0 overflow-hidden'
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
            needsGoogleAuth={Boolean(sheetConfig?.autoSyncEnabled && !googleToken)}
            isGoogleSigningIn={isGoogleSigningIn}
            onGoogleSignIn={handleGoogleSignIn}
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
            googleUser={googleUser}
            hasGoogleToken={Boolean(googleToken)}
            isGoogleSigningIn={isGoogleSigningIn}
            sheetConfig={sheetConfig}
            sheetBusyAction={sheetBusyAction}
            onGoogleSignIn={handleGoogleSignIn}
            onGoogleSignOut={handleGoogleSignOut}
            onCreateSpreadsheet={handleCreateSpreadsheet}
            onConnectSpreadsheet={handleConnectSpreadsheet}
            onToggleSheetAutoSync={handleToggleSheetAutoSync}
            onPushAllToSheet={handlePushAllToSheet}
            onPullAllFromSheet={() => handlePullAllFromSheet()}
            onClearSheetParticipations={handleClearSheetParticipations}
            onDisconnectSheet={handleDisconnectSheet}
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

      {view !== 'game' && view !== 'roulette' && (
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
