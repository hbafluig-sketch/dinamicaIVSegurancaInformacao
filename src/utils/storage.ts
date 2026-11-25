import {
  createDefaultRouletteData,
  DEFAULT_PRIZE_IMAGES,
} from '../data/defaultRoulette.ts';
import { DEFAULT_SCENES } from '../data/defaultScenes.ts';
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
import { resolveAssetUrl } from './assetUrl.ts';

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

function isJsonResponse(res: Response): boolean {
  return res.ok && (res.headers.get('content-type') || '').toLowerCase().includes('application/json');
}

function normalizeProjectAssets(project: ProjectData): ProjectData {
  return {
    ...project,
    scenes: project.scenes.map((s) => ({
      ...s,
      imageUrl: resolveAssetUrl(s.imageUrl),
      thumbUrl: s.thumbUrl ? resolveAssetUrl(s.thumbUrl) : undefined,
    })),
  };
}

function normalizeRouletteAssets(data: RouletteData): RouletteData {
  return {
    ...data,
    settings: {
      ...data.settings,
      items: data.settings.items.map((it) => {
        const resolved = resolveAssetUrl(it.imageUrl || DEFAULT_PRIZE_IMAGES[it.id]);
        return {
          ...it,
          imageUrl: resolved || undefined,
        };
      }),
    },
  };
}

function readLocalProject(): ProjectData | null {
  try {
    const raw = localStorage.getItem(LOCAL_PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProjectData>;
    if (Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
      return normalizeProjectAssets({
        version: typeof parsed.version === 'number' ? parsed.version : 8,
        updatedAt:
          typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        scenes: parsed.scenes.filter((s) => !REMOVED_BUILTIN_IDS.has(s.id)),
      });
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
      return normalizeRouletteAssets({
        version: typeof parsed.version === 'number' ? parsed.version : CURRENT_ROULETTE_VERSION,
        settings: parsed.settings,
        participations: Array.isArray(parsed.participations) ? parsed.participations : [],
        quizQuestions:
          Array.isArray(parsed.quizQuestions) && parsed.quizQuestions.length > 0
            ? parsed.quizQuestions
            : defaults.quizQuestions,
      });
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

export function safeId(raw: string, fallbackPrefix = 'id'): string {
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
    id: safeId(String(p.id || `pt-${idx}`), 'pt'),
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

function sanitizeScene(scene: Scene, order: number): Scene {
  const id = safeId(scene.id, 'scene');
  const cleaned: Scene = {
    id,
    name: (scene.name || `Cenário ${order + 1}`).trim().slice(0, 120) || 'Cenário',
    imageUrl: resolveAssetUrl(String(scene.imageUrl || '')).slice(0, 700000),
    hideLegendPct: Math.max(0, Math.min(60, Number(scene.hideLegendPct ?? 0))),
    isBuiltin: Boolean(scene.isBuiltin),
    points: sanitizePoints(scene.points),
  };

  if (scene.thumbUrl && scene.thumbUrl.length <= 120000) {
    cleaned.thumbUrl = resolveAssetUrl(scene.thumbUrl);
  }
  if (
    typeof scene.naturalWidth === 'number' &&
    scene.naturalWidth > 0 &&
    scene.naturalWidth <= 10000
  ) {
    cleaned.naturalWidth = Math.round(scene.naturalWidth);
  }
  if (
    typeof scene.naturalHeight === 'number' &&
    scene.naturalHeight > 0 &&
    scene.naturalHeight <= 10000
  ) {
    cleaned.naturalHeight = Math.round(scene.naturalHeight);
  }

  return cleaned;
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

/* ---------- Project / Scenes Persistence ---------- */

export async function loadProject(): Promise<ProjectData> {
  const local = readLocalProject();
  if (local) return local;

  try {
    const res = await fetch('/api/project');
    if (isJsonResponse(res)) {
      const serverData = (await res.json()) as ProjectData;
      if (Array.isArray(serverData.scenes) && serverData.scenes.length > 0) {
        return normalizeProjectAssets(serverData);
      }
    }
  } catch {
    // ignore on static hosting
  }

  return {
    version: 8,
    updatedAt: new Date().toISOString(),
    scenes: structuredClone(DEFAULT_SCENES),
  };
}

export async function saveProject(scenes: Scene[]): Promise<ProjectData> {
  const cleanList = scenes
    .filter((s) => !REMOVED_BUILTIN_IDS.has(s.id))
    .map((sc, idx) => sanitizeScene(sc, idx));

  const payload: ProjectData = {
    version: 8,
    updatedAt: new Date().toISOString(),
    scenes: cleanList,
  };

  cacheProjectLocal(payload);
  void mirrorProjectToExpress(payload);
  return payload;
}

export async function resetToDefaultScenes(preserveCustom: boolean): Promise<ProjectData> {
  const currentDocs: Scene[] = readLocalProject()?.scenes ?? [];
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
  try {
    const raw = localStorage.getItem(LOCAL_GAME_KEY);
    if (raw) return JSON.parse(raw) as GameState;
  } catch {
    // ignore
  }

  try {
    const res = await fetch('/api/game-state');
    if (isJsonResponse(res)) {
      const state = (await res.json()) as GameState | null;
      if (state && typeof state.round === 'number') {
        return state;
      }
    }
  } catch {
    // ignore on static hosting
  }

  return null;
}

export async function persistGameState(state: GameState): Promise<void> {
  try {
    localStorage.setItem(LOCAL_GAME_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }

  try {
    await fetch('/api/game-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  } catch {
    // optional server cache
  }
}

export async function clearPersistedGameState(): Promise<void> {
  try {
    localStorage.removeItem(LOCAL_GAME_KEY);
  } catch {
    // ignore
  }

  try {
    await fetch('/api/game-state', { method: 'DELETE' });
  } catch {
    // ignore
  }
}

/* ---------- Roulette, Stock, Quiz & Participation Persistence ---------- */

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

export function cacheRouletteLocal(data: RouletteData): void {
  try {
    localStorage.setItem(LOCAL_ROULETTE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export async function loadRouletteData(): Promise<RouletteData> {
  const local = readLocalRoulette();
  if (local) return local;

  try {
    const res = await fetch('/api/roulette');
    if (isJsonResponse(res)) {
      return normalizeRouletteAssets((await res.json()) as RouletteData);
    }
  } catch {
    // ignore on static hosting
  }

  return createDefaultRouletteData();
}

export async function saveRouletteStock(
  stocks: Record<string, Record<string, number>>,
): Promise<string> {
  const nowIso = new Date().toISOString();
  const cleanStocks = sanitizeStocksMap(stocks);
  const local = readLocalRoulette() ?? createDefaultRouletteData();
  cacheRouletteLocal({
    ...local,
    settings: {
      ...local.settings,
      stocks: cleanStocks,
      updatedAt: nowIso,
    },
  });
  return nowIso;
}

export async function saveRouletteSettings(
  settings: RouletteSettings,
  quizQuestions: QuizQuestion[],
  cachedParticipations?: Participation[],
): Promise<RouletteData> {
  const nowIso = new Date().toISOString();
  const nextSettings: RouletteSettings = {
    ...settings,
    stocks: sanitizeStocksMap(settings.stocks),
    updatedAt: nowIso,
  };

  const local = readLocalRoulette();
  const participations: Participation[] = cachedParticipations ?? local?.participations ?? [];

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
    id: safeId(input.id, 'part'),
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

  const recordId = safeId(
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

export async function clearRouletteParticipations(): Promise<RouletteData> {
  const local = readLocalRoulette() ?? createDefaultRouletteData();
  const next: RouletteData = {
    ...local,
    participations: [],
  };
  cacheRouletteLocal(next);

  try {
    await fetch('/api/roulette/participations', { method: 'DELETE' });
  } catch {
    // ignore
  }

  return next;
}

export async function resetRouletteDefaults(): Promise<RouletteData> {
  const defaults = createDefaultRouletteData();
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

  return nextLocal;
}

/* ---------- Image optimization (self-contained data URLs) ---------- */

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
  source: File | Blob,
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
    // optional dev backup
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
    let imageUrl = resolveAssetUrl(raw.imageUrl || '');
    let thumbUrl = resolveAssetUrl(raw.imageUrl || '');
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
      isBuiltin: Boolean(
        raw.isBuiltin && (imageUrl.startsWith('/assets/') || imageUrl.startsWith('./assets/')),
      ),
      points,
    });
  }

  return imported;
}
