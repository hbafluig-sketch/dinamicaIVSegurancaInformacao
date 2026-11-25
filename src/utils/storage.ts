import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  createDefaultRouletteData,
  DEFAULT_PRIZE_IMAGES,
} from '../data/defaultRoulette.ts';
import { DEFAULT_SCENES } from '../data/defaultScenes.ts';
import { db, handleFirestoreError, hasFirestoreDatabase, OperationType } from '../firebase.ts';
import type {
  ClassificationType,
  GameState,
  Participation,
  ProjectData,
  QuizQuestion,
  RegionPoint,
  RouletteData,
  RouletteSettings,
  Scene,
} from '../types/gincana.ts';

const LOCAL_PROJECT_KEY = 'gincanaSI_v8_project';
const LOCAL_GAME_KEY = 'gincanaSI_v6_gameState';
const LOCAL_ROULETTE_KEY = 'gincanaSI_v7_roulette';

const REMOVED_BUILTIN_IDS = new Set([
  'builtin-teste-6',
  'builtin-teste-7',
  'builtin-teste-8',
  'builtin-teste-9',
]);

const CURRENT_ROULETTE_VERSION = 3;

let quotaFallbackActive = !hasFirestoreDatabase;

export function isFirestoreQuotaFallback(): boolean {
  return quotaFallbackActive && hasFirestoreDatabase;
}

export function isQuotaExceededError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /quota exceeded|resource-exhausted|not_found|database .* does not exist|cloud firestore api has not been used/i.test(
    msg,
  );
}

function readLocalProject(): ProjectData | null {
  try {
    const raw = localStorage.getItem(LOCAL_PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProjectData>;
    if (Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
      return {
        version: typeof parsed.version === 'number' ? parsed.version : 8,
        updatedAt:
          typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        scenes: parsed.scenes.filter((s) => !REMOVED_BUILTIN_IDS.has(s.id)),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function readLocalRoulette(): RouletteData | null {
  try {
    const raw = localStorage.getItem(LOCAL_ROULETTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RouletteData>;
    if (parsed && parsed.settings && Array.isArray(parsed.settings.items)) {
      const defaults = createDefaultRouletteData();
      return {
        version: typeof parsed.version === 'number' ? parsed.version : CURRENT_ROULETTE_VERSION,
        settings: parsed.settings,
        participations: Array.isArray(parsed.participations) ? parsed.participations : [],
        quizQuestions:
          Array.isArray(parsed.quizQuestions) && parsed.quizQuestions.length > 0
            ? parsed.quizQuestions
            : defaults.quizQuestions,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export function uid(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function safeFirestoreId(raw: string, fallbackPrefix = 'id'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  return cleaned || uid(fallbackPrefix);
}

export function classificationLabel(type: ClassificationType): string {
  if (type === 'publica') return 'Informação pública';
  if (type === 'interna') return 'Informação interna';
  return 'Informação confidencial';
}

export function totalRegionsInScenes(scenes: Scene[]): number {
  return scenes.reduce((acc, s) => acc + s.points.length, 0);
}

function sanitizePoints(points: RegionPoint[]): RegionPoint[] {
  return (Array.isArray(points) ? points : []).slice(0, 60).map((p, idx) => ({
    id: safeFirestoreId(String(p.id || `pt-${idx}`), 'pt'),
    x: Number(Number(p.x ?? 0).toFixed(2)),
    y: Number(Number(p.y ?? 0).toFixed(2)),
    w: Number(Number(p.w ?? 10).toFixed(2)),
    h: Number(Number(p.h ?? 10).toFixed(2)),
    type:
      p.type === 'interna' || p.type === 'confidencial' ? p.type : 'publica',
    desc: String(p.desc || 'Região cadastrada').slice(0, 160),
    explain: String(p.explain || '').slice(0, 600),
  }));
}

interface FirestoreSceneDoc extends Scene {
  order: number;
  updatedAt: number;
}

function sanitizeSceneDoc(scene: Scene, order: number): FirestoreSceneDoc {
  const id = safeFirestoreId(scene.id, 'scene');
  const docData: FirestoreSceneDoc = {
    id,
    order: Math.max(0, Math.min(1000, Math.floor(order))),
    name: (scene.name || `Cenário ${order + 1}`).trim().slice(0, 120) || 'Cenário',
    imageUrl: String(scene.imageUrl || '').slice(0, 700000),
    hideLegendPct: Math.max(0, Math.min(60, Number(scene.hideLegendPct ?? 0))),
    isBuiltin: Boolean(scene.isBuiltin),
    points: sanitizePoints(scene.points),
    updatedAt: Date.now(),
  };

  if (scene.thumbUrl && scene.thumbUrl.length <= 120000) {
    docData.thumbUrl = scene.thumbUrl;
  }
  if (
    typeof scene.naturalWidth === 'number' &&
    scene.naturalWidth > 0 &&
    scene.naturalWidth <= 10000
  ) {
    docData.naturalWidth = Math.round(scene.naturalWidth);
  }
  if (
    typeof scene.naturalHeight === 'number' &&
    scene.naturalHeight > 0 &&
    scene.naturalHeight <= 10000
  ) {
    docData.naturalHeight = Math.round(scene.naturalHeight);
  }

  return docData;
}

function docToScene(data: Partial<FirestoreSceneDoc>, fallbackOrder: number): Scene {
  return {
    id: String(data.id || uid('scene')),
    name: String(data.name || `Cenário ${fallbackOrder + 1}`),
    imageUrl: String(data.imageUrl || ''),
    thumbUrl: typeof data.thumbUrl === 'string' ? data.thumbUrl : undefined,
    naturalWidth: typeof data.naturalWidth === 'number' ? data.naturalWidth : undefined,
    naturalHeight: typeof data.naturalHeight === 'number' ? data.naturalHeight : undefined,
    hideLegendPct: typeof data.hideLegendPct === 'number' ? data.hideLegendPct : 0,
    isBuiltin: Boolean(data.isBuiltin),
    points: Array.isArray(data.points) ? data.points : [],
  };
}

export function cacheProjectLocal(project: ProjectData): void {
  try {
    localStorage.setItem(LOCAL_PROJECT_KEY, JSON.stringify(project));
  } catch {
    // ignore quota on localStorage
  }
}

async function mirrorProjectToExpress(project: ProjectData): Promise<void> {
  try {
    await fetch('/api/project', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
  } catch {
    // optional local server mirror
  }
}

function scenesQuery() {
  return query(
    collection(db, 'scenes'),
    where('order', '>=', 0),
    orderBy('order', 'asc'),
    limit(100),
  );
}

function participationsQuery() {
  return query(
    collection(db, 'participations'),
    where('timestamp', '>', 0),
    orderBy('timestamp', 'desc'),
    limit(2000),
  );
}

/* ---------- Project / Scenes Firestore Persistence ---------- */

export async function loadProject(): Promise<ProjectData> {
  if (!hasFirestoreDatabase) {
    const local = readLocalProject();
    if (local) return local;
    try {
      const res = await fetch('/api/project');
      if (res.ok) {
        const serverData = (await res.json()) as ProjectData;
        if (Array.isArray(serverData.scenes) && serverData.scenes.length > 0) {
          return serverData;
        }
      }
    } catch {
      // ignore
    }
    return {
      version: 8,
      updatedAt: new Date().toISOString(),
      scenes: structuredClone(DEFAULT_SCENES),
    };
  }

  let snapshot;
  try {
    snapshot = await getDocs(scenesQuery());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      quotaFallbackActive = true;
      console.warn('Cota do Firestore atingida ao carregar cenários; usando backup local.', error);
      const local = readLocalProject();
      if (local) return local;
      try {
        const res = await fetch('/api/project');
        if (res.ok) {
          const serverData = (await res.json()) as ProjectData;
          if (Array.isArray(serverData.scenes) && serverData.scenes.length > 0) {
            return serverData;
          }
        }
      } catch {
        // ignore
      }
      return {
        version: 8,
        updatedAt: new Date().toISOString(),
        scenes: structuredClone(DEFAULT_SCENES),
      };
    }
    handleFirestoreError(error, OperationType.LIST, 'scenes');
  }

  if (snapshot.empty) {
    let seedScenes: Scene[] = structuredClone(DEFAULT_SCENES);
    try {
      const res = await fetch('/api/project');
      if (res.ok) {
        const serverData = (await res.json()) as ProjectData;
        if (Array.isArray(serverData.scenes) && serverData.scenes.length > 0) {
          const customFromServer = serverData.scenes.filter(
            (s) => !s.isBuiltin && !s.id.startsWith('builtin-teste-') && !REMOVED_BUILTIN_IDS.has(s.id),
          );
          seedScenes = [...structuredClone(DEFAULT_SCENES), ...customFromServer];
        }
      }
    } catch {
      // ignore if Express unreachable
    }

    try {
      const batch = writeBatch(db);
      seedScenes.forEach((sc, idx) => {
        const clean = sanitizeSceneDoc(sc, idx);
        batch.set(doc(db, 'scenes', clean.id), clean);
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'scenes');
    }

    const seeded: ProjectData = {
      version: 8,
      updatedAt: new Date().toISOString(),
      scenes: seedScenes,
    };
    cacheProjectLocal(seeded);
    return seeded;
  }

  const scenes: Scene[] = [];
  const staleIds: string[] = [];
  snapshot.docs.forEach((d, idx) => {
    const data = d.data() as Partial<FirestoreSceneDoc>;
    if (REMOVED_BUILTIN_IDS.has(d.id)) {
      staleIds.push(d.id);
      return;
    }
    scenes.push(docToScene(data, idx));
  });

  if (staleIds.length > 0) {
    try {
      const batch = writeBatch(db);
      staleIds.forEach((id) => batch.delete(doc(db, 'scenes', id)));
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'scenes');
    }
  }

  const project: ProjectData = {
    version: 8,
    updatedAt: new Date().toISOString(),
    scenes,
  };
  cacheProjectLocal(project);
  return project;
}

export function subscribeProject(onScenes: (scenes: Scene[]) => void): Unsubscribe {
  if (quotaFallbackActive) {
    return () => {};
  }
  return onSnapshot(
    scenesQuery(),
    (snapshot) => {
      if (snapshot.empty) return;
      const list: Scene[] = [];
      snapshot.docs.forEach((d, idx) => {
        if (REMOVED_BUILTIN_IDS.has(d.id)) return;
        list.push(docToScene(d.data() as Partial<FirestoreSceneDoc>, idx));
      });
      if (list.length > 0) {
        cacheProjectLocal({
          version: 8,
          updatedAt: new Date().toISOString(),
          scenes: list,
        });
        onScenes(list);
      }
    },
    (error) => {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
        console.warn('Cota do Firestore atingida na sincronização de cenários.', error);
        return;
      }
      handleFirestoreError(error, OperationType.LIST, 'scenes');
    },
  );
}

export async function saveProject(scenes: Scene[]): Promise<ProjectData> {
  const cleanList = scenes
    .filter((s) => !REMOVED_BUILTIN_IDS.has(s.id))
    .map((sc, idx) => sanitizeSceneDoc(sc, idx));

  const nextIds = new Set(cleanList.map((s) => s.id));

  const payload: ProjectData = {
    version: 8,
    updatedAt: new Date().toISOString(),
    scenes: cleanList.map((sc, idx) => docToScene(sc, idx)),
  };

  if (!quotaFallbackActive) {
    let existingSnap;
    try {
      existingSnap = await getDocs(scenesQuery());
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
        console.warn('Cota do Firestore atingida ao salvar cenários; salvando localmente.', error);
        cacheProjectLocal(payload);
        void mirrorProjectToExpress(payload);
        return payload;
      }
      handleFirestoreError(error, OperationType.LIST, 'scenes');
    }

    try {
      const batch = writeBatch(db);
      existingSnap.docs.forEach((d) => {
        if (!nextIds.has(d.id)) {
          batch.delete(doc(db, 'scenes', d.id));
        }
      });
      cleanList.forEach((sc) => {
        batch.set(doc(db, 'scenes', sc.id), sc);
      });
      await batch.commit();
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
        console.warn('Cota do Firestore atingida ao gravar cenários; salvando localmente.', error);
      } else {
        handleFirestoreError(error, OperationType.WRITE, 'scenes');
      }
    }
  }

  cacheProjectLocal(payload);
  void mirrorProjectToExpress(payload);
  return payload;
}

export async function resetToDefaultScenes(preserveCustom: boolean): Promise<ProjectData> {
  let currentDocs: Scene[] = readLocalProject()?.scenes ?? [];
  if (!quotaFallbackActive && hasFirestoreDatabase) {
    try {
      const snap = await getDocs(scenesQuery());
      currentDocs = snap.docs.map((d, idx) => docToScene(d.data() as Partial<FirestoreSceneDoc>, idx));
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
      } else {
        handleFirestoreError(error, OperationType.LIST, 'scenes');
      }
    }
  }

  const customScenes = preserveCustom
    ? currentDocs.filter(
        (s) => !s.isBuiltin && !s.id.startsWith('builtin-teste-') && !REMOVED_BUILTIN_IDS.has(s.id),
      )
    : [];

  const nextScenes = [...structuredClone(DEFAULT_SCENES), ...customScenes];
  return saveProject(nextScenes);
}

/* ---------- Game State Persistence ---------- */

export async function loadGameState(): Promise<GameState | null> {
  if (hasFirestoreDatabase && !quotaFallbackActive) {
    try {
      const snap = await getDoc(doc(db, 'game_state', 'active'));
      if (snap.exists()) {
        const data = snap.data() as GameState & { updatedAt?: number };
        const state: GameState = {
          sceneIndex: Number(data.sceneIndex ?? 0),
          hits: Number(data.hits ?? 0),
          misses: Number(data.misses ?? 0),
          found: Array.isArray(data.found) ? data.found : [],
          roundHits: Number(data.roundHits ?? 0),
          round: Number(data.round ?? 1),
          pendingReset: Boolean(data.pendingReset),
        };
        try {
          localStorage.setItem(LOCAL_GAME_KEY, JSON.stringify(state));
        } catch {
          // ignore
        }
        return state;
      }
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
        console.warn('Cota do Firestore atingida ao carregar estado do jogo; usando backup local.', error);
      } else {
        handleFirestoreError(error, OperationType.GET, 'game_state/active');
      }
    }
  }

  try {
    const raw = localStorage.getItem(LOCAL_GAME_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

export async function persistGameState(state: GameState): Promise<void> {
  const payload = {
    sceneIndex: Math.max(0, Math.floor(state.sceneIndex)),
    hits: Math.max(0, Math.floor(state.hits)),
    misses: Math.max(0, Math.floor(state.misses)),
    found: (Array.isArray(state.found) ? state.found : []).slice(0, 500),
    roundHits: Math.max(0, Math.floor(state.roundHits)),
    round: Math.max(1, Math.floor(state.round)),
    pendingReset: Boolean(state.pendingReset),
    updatedAt: Date.now(),
  };

  try {
    localStorage.setItem(LOCAL_GAME_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }

  if (!quotaFallbackActive) {
    try {
      await setDoc(doc(db, 'game_state', 'active'), payload);
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
        console.warn('Cota do Firestore atingida ao salvar estado do jogo; mantendo cache local.', error);
      } else {
        handleFirestoreError(error, OperationType.WRITE, 'game_state/active');
      }
    }
  }

  try {
    await fetch('/api/game-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  } catch {
    // ignore optional server cache
  }
}

export async function clearPersistedGameState(): Promise<void> {
  try {
    localStorage.removeItem(LOCAL_GAME_KEY);
  } catch {
    // ignore
  }
  if (!quotaFallbackActive && hasFirestoreDatabase) {
    try {
      await deleteDoc(doc(db, 'game_state', 'active'));
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
      } else {
        handleFirestoreError(error, OperationType.DELETE, 'game_state/active');
      }
    }
  }
  try {
    await fetch('/api/game-state', { method: 'DELETE' });
  } catch {
    // ignore
  }
}

/* ---------- Roulette & Quiz Firestore Persistence ---------- */

interface WheelConfigDoc {
  factories: string[];
  items: RouletteSettings['items'];
  quizEnabled: boolean;
  allowDuplicateRegistration: boolean;
  version: number;
  updatedAt: string;
}

interface WheelStockDoc {
  stocks: Record<string, Record<string, number>>;
  updatedAt: string;
}

interface QuizBankDoc {
  questions: QuizQuestion[];
  updatedAt: string;
}

function buildConfigDoc(settings: RouletteSettings): WheelConfigDoc {
  return {
    factories: settings.factories.slice(0, 40),
    items: settings.items.slice(0, 24).map((it) => {
      const cleaned: RouletteSettings['items'][number] = {
        id: safeFirestoreId(it.id, 'item'),
        label: String(it.label || 'Item').slice(0, 80),
        color: String(it.color || '#0284c7').slice(0, 24),
        textColor: String(it.textColor || '#ffffff').slice(0, 24),
        outcomeType: it.outcomeType === 'dica' ? 'dica' : 'prize',
        weight: Math.max(1, Math.min(20, Number(it.weight ?? 1))),
      };
      if (it.imageUrl) {
        cleaned.imageUrl = String(it.imageUrl).slice(0, 180000);
      }
      return cleaned;
    }),
    quizEnabled: Boolean(settings.quizEnabled),
    allowDuplicateRegistration: Boolean(settings.allowDuplicateRegistration),
    version: CURRENT_ROULETTE_VERSION,
    updatedAt: settings.updatedAt || new Date().toISOString(),
  };
}

function sanitizeStocksMap(
  stocks: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  const cleaned: Record<string, Record<string, number>> = {};
  for (const [factoryName, itemsMap] of Object.entries(stocks || {}).slice(0, 40)) {
    const cleanFactory: Record<string, number> = {};
    for (const [itemId, qty] of Object.entries(itemsMap || {})) {
      const n = Number(qty);
      cleanFactory[itemId] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }
    cleaned[factoryName] = cleanFactory;
  }
  return cleaned;
}

function buildStockDoc(stocks: Record<string, Record<string, number>>, updatedAt?: string): WheelStockDoc {
  return {
    stocks: sanitizeStocksMap(stocks),
    updatedAt: (updatedAt || new Date().toISOString()).slice(0, 64),
  };
}

function buildQuizDoc(questions: QuizQuestion[], updatedAt?: string): QuizBankDoc {
  return {
    questions: questions.slice(0, 100).map((q) => ({
      id: safeFirestoreId(q.id, 'quiz'),
      question: String(q.question || '').slice(0, 500),
      options: (q.options || []).slice(0, 5).map((o) => String(o).slice(0, 300)),
      correctIndex: Math.max(0, Number(q.correctIndex ?? 0)),
      explanation: String(q.explanation || '').slice(0, 600),
    })),
    updatedAt: updatedAt || new Date().toISOString(),
  };
}

export function cacheRouletteLocal(data: RouletteData): void {
  try {
    localStorage.setItem(LOCAL_ROULETTE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export async function loadRouletteData(): Promise<RouletteData> {
  const defaults = createDefaultRouletteData();

  if (!hasFirestoreDatabase) {
    const local = readLocalRoulette();
    if (local) return local;
    try {
      const res = await fetch('/api/roulette');
      if (res.ok) {
        return (await res.json()) as RouletteData;
      }
    } catch {
      // ignore
    }
    return defaults;
  }

  let configSnap;
  let stockSnap;
  let quizSnap;
  let partSnap;

  try {
    [configSnap, stockSnap, quizSnap, partSnap] = await Promise.all([
      getDoc(doc(db, 'settings', 'wheel_config')),
      getDoc(doc(db, 'settings', 'wheel_stock')),
      getDoc(doc(db, 'settings', 'quiz_bank')),
      getDocs(participationsQuery()),
    ]);
  } catch (error) {
    if (isQuotaExceededError(error)) {
      quotaFallbackActive = true;
      console.warn('Cota do Firestore atingida ao carregar dados da roleta; usando backup local.', error);
      const local = readLocalRoulette();
      if (local) return local;
      try {
        const res = await fetch('/api/roulette');
        if (res.ok) {
          return (await res.json()) as RouletteData;
        }
      } catch {
        // ignore
      }
      return defaults;
    }
    handleFirestoreError(error, OperationType.GET, 'settings/wheel_config');
  }

  let serverFallback: RouletteData | null = null;
  if (!configSnap.exists() || !stockSnap.exists() || !quizSnap.exists()) {
    try {
      const res = await fetch('/api/roulette');
      if (res.ok) {
        serverFallback = (await res.json()) as RouletteData;
      }
    } catch {
      // ignore
    }
  }

  const seedSource = serverFallback ?? defaults;
  let needsSeedBatch = false;
  const seedBatch = writeBatch(db);

  let configData: WheelConfigDoc;
  if (configSnap.exists()) {
    const raw = configSnap.data() as Partial<WheelConfigDoc>;
    const needsImageUpgrade = typeof raw.version !== 'number' || raw.version < CURRENT_ROULETTE_VERSION;
    const upgradedItems = Array.isArray(raw.items)
      ? raw.items.map((it) => ({
          ...it,
          imageUrl: needsImageUpgrade
            ? (DEFAULT_PRIZE_IMAGES[it.id] ?? it.imageUrl)
            : it.imageUrl,
        }))
      : seedSource.settings.items;

    configData = {
      factories: Array.isArray(raw.factories) && raw.factories.length > 0 ? raw.factories : seedSource.settings.factories,
      items: upgradedItems,
      quizEnabled: Boolean(raw.quizEnabled),
      allowDuplicateRegistration: Boolean(raw.allowDuplicateRegistration),
      version: CURRENT_ROULETTE_VERSION,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    };

    if (needsImageUpgrade) {
      seedBatch.set(doc(db, 'settings', 'wheel_config'), buildConfigDoc({
        ...configData,
        stocks: {},
      }));
      needsSeedBatch = true;
    }
  } else {
    configData = buildConfigDoc(seedSource.settings);
    seedBatch.set(doc(db, 'settings', 'wheel_config'), configData);
    needsSeedBatch = true;
  }

  let stockData: WheelStockDoc;
  if (stockSnap.exists()) {
    const raw = stockSnap.data() as Partial<WheelStockDoc>;
    stockData = {
      stocks: raw.stocks ?? seedSource.settings.stocks,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    };
  } else {
    stockData = buildStockDoc(seedSource.settings.stocks);
    seedBatch.set(doc(db, 'settings', 'wheel_stock'), stockData);
    needsSeedBatch = true;
  }

  let quizData: QuizBankDoc;
  if (quizSnap.exists()) {
    const raw = quizSnap.data() as Partial<QuizBankDoc>;
    quizData = {
      questions: Array.isArray(raw.questions) && raw.questions.length > 0
        ? raw.questions
        : defaults.quizQuestions,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    };
  } else {
    quizData = buildQuizDoc(
      seedSource.quizQuestions.length > 0 ? seedSource.quizQuestions : defaults.quizQuestions,
    );
    seedBatch.set(doc(db, 'settings', 'quiz_bank'), quizData);
    needsSeedBatch = true;
  }

  const participations: Participation[] = partSnap.docs.map(
    (d) => d.data() as Participation,
  );

  if (participations.length === 0 && serverFallback?.participations?.length) {
    for (const p of serverFallback.participations) {
      const pId = safeFirestoreId(p.id, 'part');
      const cleanPart = sanitizeParticipation({ ...p, id: pId });
      seedBatch.set(doc(db, 'participations', pId), cleanPart);
      participations.push(cleanPart);
    }
    needsSeedBatch = true;
  }

  if (needsSeedBatch) {
    try {
      await seedBatch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings');
    }
  }

  const result: RouletteData = {
    version: CURRENT_ROULETTE_VERSION,
    settings: {
      factories: configData.factories,
      items: configData.items,
      stocks: stockData.stocks,
      quizEnabled: configData.quizEnabled,
      allowDuplicateRegistration: configData.allowDuplicateRegistration,
      updatedAt: stockData.updatedAt || configData.updatedAt,
    },
    participations,
    quizQuestions: quizData.questions,
  };

  cacheRouletteLocal(result);
  return result;
}

export function subscribeRouletteData(
  initialData: RouletteData,
  onUpdate: (data: RouletteData) => void,
): Unsubscribe {
  if (quotaFallbackActive) {
    return () => {};
  }

  let latest: RouletteData = structuredClone(initialData);

  const emit = () => {
    cacheRouletteLocal(latest);
    onUpdate({
      ...latest,
      settings: { ...latest.settings },
    });
  };

  const handleSubError = (error: unknown, op: OperationType, path: string) => {
    if (isQuotaExceededError(error)) {
      quotaFallbackActive = true;
      console.warn(`Cota do Firestore atingida em ${path}.`, error);
      return;
    }
    handleFirestoreError(error, op, path);
  };

  const unsubConfig = onSnapshot(
    doc(db, 'settings', 'wheel_config'),
    (snap) => {
      if (!snap.exists()) return;
      const raw = snap.data() as WheelConfigDoc;
      latest = {
        ...latest,
        version: raw.version ?? CURRENT_ROULETTE_VERSION,
        settings: {
          ...latest.settings,
          factories: raw.factories,
          items: raw.items,
          quizEnabled: raw.quizEnabled,
          allowDuplicateRegistration: raw.allowDuplicateRegistration,
          updatedAt: raw.updatedAt,
        },
      };
      emit();
    },
    (error) => handleSubError(error, OperationType.GET, 'settings/wheel_config'),
  );

  const unsubStock = onSnapshot(
    doc(db, 'settings', 'wheel_stock'),
    (snap) => {
      if (!snap.exists()) return;
      const raw = snap.data() as WheelStockDoc;
      latest = {
        ...latest,
        settings: {
          ...latest.settings,
          stocks: raw.stocks,
          updatedAt: raw.updatedAt,
        },
      };
      emit();
    },
    (error) => handleSubError(error, OperationType.GET, 'settings/wheel_stock'),
  );

  const unsubQuiz = onSnapshot(
    doc(db, 'settings', 'quiz_bank'),
    (snap) => {
      if (!snap.exists()) return;
      const raw = snap.data() as QuizBankDoc;
      latest = {
        ...latest,
        quizQuestions: raw.questions,
      };
      emit();
    },
    (error) => handleSubError(error, OperationType.GET, 'settings/quiz_bank'),
  );

  const unsubParts = onSnapshot(
    participationsQuery(),
    (snap) => {
      latest = {
        ...latest,
        participations: snap.docs.map((d) => d.data() as Participation),
      };
      emit();
    },
    (error) => handleSubError(error, OperationType.LIST, 'participations'),
  );

  return () => {
    unsubConfig();
    unsubStock();
    unsubQuiz();
    unsubParts();
  };
}

export async function saveRouletteStock(
  stocks: Record<string, Record<string, number>>,
  skipFirestore = false,
): Promise<string> {
  const nowIso = new Date().toISOString();
  const payload = buildStockDoc(stocks, nowIso);
  const local = readLocalRoulette();
  if (local) {
    cacheRouletteLocal({
      ...local,
      settings: {
        ...local.settings,
        stocks: payload.stocks,
        updatedAt: nowIso,
      },
    });
  }
  if (!skipFirestore && !quotaFallbackActive) {
    try {
      await setDoc(doc(db, 'settings', 'wheel_stock'), payload);
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
        console.warn('Cota do Firestore atingida ao atualizar estoque; mantendo cache local.', error);
      } else {
        handleFirestoreError(error, OperationType.WRITE, 'settings/wheel_stock');
      }
    }
  }
  return nowIso;
}

export async function saveRouletteSettings(
  settings: RouletteSettings,
  quizQuestions: QuizQuestion[],
  cachedParticipations?: Participation[],
  skipFirestore = false,
): Promise<RouletteData> {
  const nowIso = new Date().toISOString();
  const nextSettings: RouletteSettings = {
    ...settings,
    stocks: sanitizeStocksMap(settings.stocks),
    updatedAt: nowIso,
  };

  if (!skipFirestore && !quotaFallbackActive) {
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'settings', 'wheel_config'), buildConfigDoc(nextSettings));
      batch.set(doc(db, 'settings', 'wheel_stock'), buildStockDoc(nextSettings.stocks, nowIso));
      batch.set(doc(db, 'settings', 'quiz_bank'), buildQuizDoc(quizQuestions, nowIso));
      await batch.commit();
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
        console.warn('Cota do Firestore atingida ao salvar configurações; mantendo cache local.', error);
      } else {
        handleFirestoreError(error, OperationType.WRITE, 'settings');
      }
    }
  }

  let participations: Participation[] = cachedParticipations ?? [];
  if (!cachedParticipations && !skipFirestore && !quotaFallbackActive) {
    try {
      const partSnap = await getDocs(participationsQuery());
      participations = partSnap.docs.map((d) => d.data() as Participation);
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
      } else {
        handleFirestoreError(error, OperationType.LIST, 'participations');
      }
    }
  }

  const next: RouletteData = {
    version: CURRENT_ROULETTE_VERSION,
    settings: nextSettings,
    participations,
    quizQuestions,
  };
  cacheRouletteLocal(next);

  try {
    await fetch('/api/roulette/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: nextSettings, quizQuestions }),
    });
  } catch {
    // ignore optional server mirror
  }

  return next;
}

function sanitizeParticipation(input: Participation): Participation {
  const record: Participation = {
    id: safeFirestoreId(input.id, 'part'),
    timestamp: Number(input.timestamp || Date.now()),
    factory: String(input.factory).slice(0, 64),
    registrationNumber: String(input.registrationNumber).trim().slice(0, 64),
    outcomeType: input.outcomeType === 'dica' ? 'dica' : 'prize',
    prizeId: String(input.prizeId || '').slice(0, 64),
    prizeName: String(input.prizeName).slice(0, 128),
  };
  if (input.accentColor) {
    record.accentColor = String(input.accentColor).slice(0, 32);
  }
  if (input.tipText) {
    record.tipText = String(input.tipText).slice(0, 400);
  }
  if (typeof input.quizCorrect === 'boolean') {
    record.quizCorrect = input.quizCorrect;
  }
  if (typeof input.roundNumber === 'number' && input.roundNumber >= 1) {
    record.roundNumber = Math.floor(input.roundNumber);
  }
  return record;
}

export async function recordLocalRouletteSpin(
  currentData: RouletteData,
  participation: Omit<Participation, 'id' | 'timestamp'>,
): Promise<{ data: RouletteData; record: Participation } | { error: string }> {
  const regNormalized = String(participation.registrationNumber || '').trim();
  if (!regNormalized || !participation.factory || !participation.prizeName) {
    return { error: 'Dados da participação incompletos.' };
  }

  if (!currentData.settings.allowDuplicateRegistration) {
    const duplicate = currentData.participations.find(
      (p) => p.registrationNumber.trim().toLowerCase() === regNormalized.toLowerCase(),
    );
    if (duplicate) {
      return {
        error: `Este registro já participou do sorteio (${duplicate.factory}). Não é permitido registrar o mesmo código duas vezes.`,
      };
    }
  }

  const recordId = safeFirestoreId(
    `part-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    'part',
  );
  const record = sanitizeParticipation({
    ...participation,
    id: recordId,
    timestamp: Date.now(),
    registrationNumber: regNormalized,
  });

  const updatedStocks = structuredClone(currentData.settings.stocks);
  if (record.prizeId) {
    if (!updatedStocks[record.factory]) {
      updatedStocks[record.factory] = {};
    }
    const avail = Number(updatedStocks[record.factory][record.prizeId] ?? 0);
    if (avail > 0) {
      updatedStocks[record.factory][record.prizeId] = avail - 1;
    }
  }

  const nowIso = new Date().toISOString();
  const data: RouletteData = {
    version: CURRENT_ROULETTE_VERSION,
    settings: {
      ...currentData.settings,
      stocks: updatedStocks,
      updatedAt: nowIso,
    },
    participations: [record, ...currentData.participations],
    quizQuestions: currentData.quizQuestions,
  };

  cacheRouletteLocal(data);

  try {
    await fetch('/api/roulette/spin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(participation),
    });
  } catch {
    // ignore optional server mirror
  }

  return { data, record };
}

export async function recordRouletteSpin(
  participation: Omit<Participation, 'id' | 'timestamp'>,
  fallbackData?: RouletteData,
): Promise<{ data: RouletteData; record: Participation } | { error: string }> {
  const regNormalized = String(participation.registrationNumber || '').trim();
  if (!regNormalized || !participation.factory || !participation.prizeName) {
    return { error: 'Dados da participação incompletos.' };
  }

  if (quotaFallbackActive && fallbackData) {
    return recordLocalRouletteSpin(fallbackData, participation);
  }

  let configSnap;
  let existingPartsSnap;
  try {
    [configSnap, existingPartsSnap] = await Promise.all([
      getDoc(doc(db, 'settings', 'wheel_config')),
      getDocs(participationsQuery()),
    ]);
  } catch (error) {
    if (isQuotaExceededError(error) && fallbackData) {
      quotaFallbackActive = true;
      return recordLocalRouletteSpin(fallbackData, participation);
    }
    handleFirestoreError(error, OperationType.GET, 'participations');
  }

  const defaults = createDefaultRouletteData();
  const configData = configSnap.exists()
    ? (configSnap.data() as WheelConfigDoc)
    : buildConfigDoc(defaults.settings);

  const existingParts = existingPartsSnap.docs.map((d) => d.data() as Participation);

  if (!configData.allowDuplicateRegistration) {
    const duplicate = existingParts.find(
      (p) => p.registrationNumber.trim().toLowerCase() === regNormalized.toLowerCase(),
    );
    if (duplicate) {
      return {
        error: `Este registro já participou do sorteio (${duplicate.factory}). Não é permitido registrar o mesmo código duas vezes.`,
      };
    }
  }

  const recordId = safeFirestoreId(`part-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, 'part');
  const record = sanitizeParticipation({
    ...participation,
    id: recordId,
    timestamp: Date.now(),
    registrationNumber: regNormalized,
  });

  let updatedStocks: Record<string, Record<string, number>> = {};
  const nowIso = new Date().toISOString();

  try {
    await runTransaction(db, async (tx) => {
      const stockRef = doc(db, 'settings', 'wheel_stock');
      const stockDoc = await tx.get(stockRef);
      const currentStocks = stockDoc.exists()
        ? structuredClone((stockDoc.data() as WheelStockDoc).stocks)
        : structuredClone(defaults.settings.stocks);

      if (record.prizeId) {
        if (!currentStocks[record.factory]) {
          currentStocks[record.factory] = {};
        }
        const avail = Number(currentStocks[record.factory][record.prizeId] ?? 0);
        if (avail > 0) {
          currentStocks[record.factory][record.prizeId] = avail - 1;
        }
      }

      updatedStocks = currentStocks;
      tx.set(stockRef, buildStockDoc(currentStocks, nowIso));
      tx.set(doc(db, 'participations', record.id), record);
    });
  } catch (error) {
    if (isQuotaExceededError(error) && fallbackData) {
      quotaFallbackActive = true;
      return recordLocalRouletteSpin(fallbackData, participation);
    }
    handleFirestoreError(error, OperationType.WRITE, `participations/${record.id}`);
  }

  let quizQuestions = defaults.quizQuestions;
  try {
    const qSnap = await getDoc(doc(db, 'settings', 'quiz_bank'));
    if (qSnap.exists()) {
      quizQuestions = (qSnap.data() as QuizBankDoc).questions;
    }
  } catch {
    // ignore secondary read failure
  }

  const data: RouletteData = {
    version: CURRENT_ROULETTE_VERSION,
    settings: {
      factories: configData.factories,
      items: configData.items,
      stocks: updatedStocks,
      quizEnabled: configData.quizEnabled,
      allowDuplicateRegistration: configData.allowDuplicateRegistration,
      updatedAt: nowIso,
    },
    participations: [record, ...existingParts],
    quizQuestions,
  };

  cacheRouletteLocal(data);

  try {
    await fetch('/api/roulette/spin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(participation),
    });
  } catch {
    // ignore optional server mirror
  }

  return { data, record };
}

export async function clearRouletteParticipations(skipFirestore = false): Promise<RouletteData> {
  if (!skipFirestore && !quotaFallbackActive) {
    let partSnap;
    try {
      partSnap = await getDocs(participationsQuery());
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
      } else {
        handleFirestoreError(error, OperationType.LIST, 'participations');
      }
    }

    if (partSnap) {
      const docs = partSnap.docs;
      try {
        for (let i = 0; i < docs.length; i += 400) {
          const batch = writeBatch(db);
          docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      } catch (error) {
        if (isQuotaExceededError(error)) {
          quotaFallbackActive = true;
        } else {
          handleFirestoreError(error, OperationType.DELETE, 'participations');
        }
      }
    }
  }

  const local = readLocalRoulette();
  if (local) {
    cacheRouletteLocal({
      ...local,
      participations: [],
    });
  }

  try {
    await fetch('/api/roulette/participations', { method: 'DELETE' });
  } catch {
    // ignore
  }

  if (skipFirestore || quotaFallbackActive) {
    return readLocalRoulette() ?? createDefaultRouletteData();
  }

  return loadRouletteData();
}

export async function resetRouletteDefaults(skipFirestore = false): Promise<RouletteData> {
  const defaults = createDefaultRouletteData();
  const nowIso = new Date().toISOString();

  if (!skipFirestore && !quotaFallbackActive) {
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'settings', 'wheel_config'), buildConfigDoc(defaults.settings));
      batch.set(doc(db, 'settings', 'wheel_stock'), buildStockDoc(defaults.settings.stocks, nowIso));
      batch.set(doc(db, 'settings', 'quiz_bank'), buildQuizDoc(defaults.quizQuestions, nowIso));
      await batch.commit();
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaFallbackActive = true;
      } else {
        handleFirestoreError(error, OperationType.WRITE, 'settings');
      }
    }
  }

  const existingLocal = readLocalRoulette();
  const nextLocal: RouletteData = {
    ...defaults,
    participations: existingLocal?.participations ?? [],
  };
  cacheRouletteLocal(nextLocal);

  try {
    await fetch('/api/roulette/reset', { method: 'POST' });
  } catch {
    // ignore
  }

  if (skipFirestore || quotaFallbackActive) {
    return nextLocal;
  }

  return loadRouletteData();
}

/* ---------- Image optimization (Cloud Firestore-safe self-contained data URLs) ---------- */

function canvasToDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL('image/webp', quality);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/jpeg', quality);
}

async function compressBitmapToLimit(
  bmp: ImageBitmap,
  maxDimStart: number,
  maxChars: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const dimCandidates = [maxDimStart, Math.round(maxDimStart * 0.78), Math.round(maxDimStart * 0.6)];
  const qualityCandidates = [0.82, 0.7, 0.58, 0.45];

  let lastUrl = '';
  let lastW = bmp.width;
  let lastH = bmp.height;

  for (const maxDim of dimCandidates) {
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, w, h);

    for (const q of qualityCandidates) {
      const url = canvasToDataUrl(canvas, q);
      lastUrl = url;
      lastW = w;
      lastH = h;
      if (url.length <= maxChars) {
        return { dataUrl: url, width: w, height: h };
      }
    }
  }

  return { dataUrl: lastUrl, width: lastW, height: lastH };
}

export async function optimizeAndUploadImage(
  source: Blob,
  sceneId: string,
  options?: { maxDim?: number; maxDataUrlChars?: number },
): Promise<{
  imageUrl: string;
  thumbUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}> {
  const bmp = await createImageBitmap(source);
  const maxDim = options?.maxDim ?? 1400;
  const maxChars = options?.maxDataUrlChars ?? 500000;

  const main = await compressBitmapToLimit(bmp, maxDim, maxChars);
  const thumb = await compressBitmapToLimit(bmp, 280, 48000);
  bmp.close();

  const ext = main.dataUrl.startsWith('data:image/webp') ? 'webp' : 'jpg';
  try {
    await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: sceneId,
        imageDataUrl: main.dataUrl,
        thumbDataUrl: thumb.dataUrl,
        ext,
      }),
    });
  } catch {
    // optional dev backup; data URLs persist directly inside Firestore
  }

  return {
    imageUrl: main.dataUrl,
    thumbUrl: thumb.dataUrl,
    naturalWidth: main.width,
    naturalHeight: main.height,
  };
}

export async function optimizePrizeImage(source: Blob, itemId: string): Promise<string> {
  const result = await optimizeAndUploadImage(source, `prize_${itemId}_${Date.now()}`, {
    maxDim: 560,
    maxDataUrlChars: 135000,
  });
  return result.imageUrl;
}

export async function deleteUploadedFile(sceneId: string): Promise<void> {
  try {
    await fetch(`/api/uploads/${encodeURIComponent(sceneId)}`, { method: 'DELETE' });
  } catch {
    // ignore
  }
}

async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function exportProjectBundle(scenes: Scene[]): Promise<Blob> {
  const exportedScenes = await Promise.all(
    scenes.map(async (sc) => ({
      ...sc,
      image: await urlToDataUrl(sc.imageUrl),
    })),
  );
  return new Blob(
    [
      JSON.stringify(
        {
          version: 8,
          exportedAt: new Date().toISOString(),
          scenes: exportedScenes,
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
}

interface LegacySceneInput {
  id?: string;
  name?: string;
  image?: string;
  imageUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  hideLegendPct?: number;
  isBuiltin?: boolean;
  points?: Array<Partial<RegionPoint>>;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    arr[i] = bin.charCodeAt(i);
  }
  return new Blob([arr], { type: mime });
}

export async function importProjectBundle(
  jsonText: string,
  onProgress?: (current: number, total: number, name: string) => void,
): Promise<Scene[]> {
  const parsed = JSON.parse(jsonText) as { scenes?: LegacySceneInput[] };
  if (!parsed || !Array.isArray(parsed.scenes)) {
    throw new Error('Arquivo de projeto inválido.');
  }

  const imported: Scene[] = [];
  for (let i = 0; i < parsed.scenes.length; i++) {
    const raw = parsed.scenes[i];
    const name = raw.name || `Imagem ${i + 1}`;
    onProgress?.(i + 1, parsed.scenes.length, name);

    const id = uid('scene');
    let imageUrl = raw.imageUrl || '';
    let thumbUrl = raw.imageUrl || '';
    let naturalWidth = raw.naturalWidth;
    let naturalHeight = raw.naturalHeight;

    if (raw.image && raw.image.startsWith('data:')) {
      const blob = dataUrlToBlob(raw.image);
      const uploaded = await optimizeAndUploadImage(blob, id);
      imageUrl = uploaded.imageUrl;
      thumbUrl = uploaded.thumbUrl;
      naturalWidth = uploaded.naturalWidth;
      naturalHeight = uploaded.naturalHeight;
    } else if (!imageUrl) {
      throw new Error(`Imagem ausente na cena "${name}".`);
    }

    const points: RegionPoint[] = (raw.points || []).map((p, idx) => ({
      id: p.id || uid(`pt-${idx}`),
      x: Number(p.x ?? 0),
      y: Number(p.y ?? 0),
      w: Number(p.w ?? 10),
      h: Number(p.h ?? 10),
      type: p.type === 'interna' || p.type === 'confidencial' ? p.type : 'publica',
      desc: String(p.desc || 'Região cadastrada'),
      explain: String(p.explain || ''),
    }));

    imported.push({
      id,
      name,
      imageUrl,
      thumbUrl,
      naturalWidth,
      naturalHeight,
      hideLegendPct: Number(raw.hideLegendPct ?? 0),
      isBuiltin: Boolean(raw.isBuiltin && imageUrl.startsWith('/assets/')),
      points,
    });
  }

  return imported;
}
