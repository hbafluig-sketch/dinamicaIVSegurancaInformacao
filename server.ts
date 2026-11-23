import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultRouletteData } from './src/data/defaultRoulette.ts';
import { DEFAULT_SCENES } from './src/data/defaultScenes.ts';
import type {
  GameState,
  Participation,
  ProjectData,
  QuizQuestion,
  RouletteData,
  RouletteSettings,
  Scene,
} from './src/types/gincana.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PROJECT_FILE = path.join(DATA_DIR, 'project.json');
const GAME_STATE_FILE = path.join(DATA_DIR, 'game-state.json');
const ROULETTE_FILE = path.join(DATA_DIR, 'roulette.json');

function ensureDirs(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  ensureDirs();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

const PROJECT_VERSION = 8;
const REMOVED_BUILTIN_IDS = new Set([
  'builtin-teste-6',
  'builtin-teste-7',
  'builtin-teste-8',
  'builtin-teste-9',
]);

function readProject(): ProjectData {
  ensureDirs();
  if (!fs.existsSync(PROJECT_FILE)) {
    const initial: ProjectData = {
      version: PROJECT_VERSION,
      updatedAt: new Date().toISOString(),
      scenes: structuredClone(DEFAULT_SCENES),
    };
    atomicWriteJson(PROJECT_FILE, initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(PROJECT_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProjectData>;
    if (Array.isArray(parsed.scenes)) {
      const currentVersion = typeof parsed.version === 'number' ? parsed.version : 6;
      if (currentVersion < PROJECT_VERSION) {
        const filtered = parsed.scenes.filter((s) => !REMOVED_BUILTIN_IDS.has(s.id));
        const existingIds = new Set(filtered.map((s) => s.id));
        const missingBuiltins = structuredClone(DEFAULT_SCENES).filter(
          (s) => !existingIds.has(s.id),
        );
        const migrated: ProjectData = {
          version: PROJECT_VERSION,
          updatedAt: new Date().toISOString(),
          scenes: [...filtered, ...missingBuiltins],
        };
        atomicWriteJson(PROJECT_FILE, migrated);
        return migrated;
      }

      return {
        version: currentVersion,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        scenes: parsed.scenes,
      };
    }
  } catch (err) {
    console.error('Erro ao ler project.json, restaurando cenas padrão:', err);
  }

  const fallback: ProjectData = {
    version: PROJECT_VERSION,
    updatedAt: new Date().toISOString(),
    scenes: structuredClone(DEFAULT_SCENES),
  };
  atomicWriteJson(PROJECT_FILE, fallback);
  return fallback;
}

function writeProject(scenes: Scene[]): ProjectData {
  const next: ProjectData = {
    version: PROJECT_VERSION,
    updatedAt: new Date().toISOString(),
    scenes,
  };
  atomicWriteJson(PROJECT_FILE, next);
  return next;
}

const ROULETTE_VERSION = 3;

function readRoulette(): RouletteData {
  ensureDirs();
  if (!fs.existsSync(ROULETTE_FILE)) {
    const initial = createDefaultRouletteData();
    atomicWriteJson(ROULETTE_FILE, initial);
    return initial;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(ROULETTE_FILE, 'utf8')) as Partial<RouletteData>;
    const defaults = createDefaultRouletteData();
    if (typeof parsed.version !== 'number' || parsed.version < ROULETTE_VERSION) {
      const defaultImagesById = new Map(
        defaults.settings.items.map((it) => [it.id, it.imageUrl]),
      );
      const hasLegacyV2 = parsed.version === 2 && parsed.settings && Array.isArray(parsed.settings.items);
      const migratedSettings = hasLegacyV2
        ? {
            ...parsed.settings!,
            items: parsed.settings!.items.map((it) => ({
              ...it,
              imageUrl: defaultImagesById.get(it.id) ?? it.imageUrl,
            })),
            updatedAt: new Date().toISOString(),
          }
        : defaults.settings;

      const migrated: RouletteData = {
        version: ROULETTE_VERSION,
        settings: migratedSettings,
        participations: Array.isArray(parsed.participations) ? parsed.participations : [],
        quizQuestions:
          Array.isArray(parsed.quizQuestions) && parsed.quizQuestions.length > 0
            ? parsed.quizQuestions
            : defaults.quizQuestions,
      };
      atomicWriteJson(ROULETTE_FILE, migrated);
      return migrated;
    }

    return {
      version: parsed.version,
      settings: parsed.settings ?? defaults.settings,
      participations: Array.isArray(parsed.participations) ? parsed.participations : [],
      quizQuestions:
        Array.isArray(parsed.quizQuestions) && parsed.quizQuestions.length > 0
          ? parsed.quizQuestions
          : defaults.quizQuestions,
    };
  } catch (err) {
    console.error('Erro ao ler roulette.json, restaurando padrão:', err);
    const fallback = createDefaultRouletteData();
    atomicWriteJson(ROULETTE_FILE, fallback);
    return fallback;
  }
}

function writeRoulette(data: RouletteData): RouletteData {
  const payload: RouletteData = {
    ...data,
    version: ROULETTE_VERSION,
  };
  atomicWriteJson(ROULETTE_FILE, payload);
  return payload;
}

function decodeBase64DataUrl(dataUrl: string): Buffer {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Buffer.from(base64, 'base64');
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || `img_${Date.now()}`;
}

async function startServer(): Promise<void> {
  ensureDirs();
  readProject();
  readRoulette();

  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.use(
    '/uploads',
    express.static(UPLOADS_DIR, {
      maxAge: '30d',
      immutable: true,
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/project', (_req, res) => {
    res.json(readProject());
  });

  app.put('/api/project', (req, res) => {
    const body = req.body as Partial<ProjectData>;
    if (!body || !Array.isArray(body.scenes)) {
      res.status(400).json({ error: 'Formato inválido de projeto.' });
      return;
    }
    res.json(writeProject(body.scenes));
  });

  app.post('/api/upload', (req, res) => {
    try {
      const { id, imageDataUrl, thumbDataUrl, ext } = req.body as {
        id?: string;
        imageDataUrl?: string;
        thumbDataUrl?: string;
        ext?: string;
      };

      if (!imageDataUrl || typeof imageDataUrl !== 'string') {
        res.status(400).json({ error: 'Imagem ausente.' });
        return;
      }

      const safeId = sanitizeId(id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      const safeExt = ext && /^(webp|png|jpg|jpeg)$/i.test(ext) ? ext.toLowerCase() : 'webp';
      const imageFile = `${safeId}.${safeExt}`;
      const thumbFile = `${safeId}_thumb.${safeExt}`;

      ensureDirs();
      fs.writeFileSync(path.join(UPLOADS_DIR, imageFile), decodeBase64DataUrl(imageDataUrl));

      let thumbUrl = `/uploads/${imageFile}`;
      if (thumbDataUrl && typeof thumbDataUrl === 'string') {
        fs.writeFileSync(path.join(UPLOADS_DIR, thumbFile), decodeBase64DataUrl(thumbDataUrl));
        thumbUrl = `/uploads/${thumbFile}`;
      }

      res.json({
        id: safeId,
        imageUrl: `/uploads/${imageFile}`,
        thumbUrl,
      });
    } catch (err) {
      console.error('Erro ao salvar imagem:', err);
      res.status(500).json({ error: 'Falha ao salvar imagem no servidor.' });
    }
  });

  app.delete('/api/uploads/:id', (req, res) => {
    const safeId = sanitizeId(req.params.id);
    try {
      if (fs.existsSync(UPLOADS_DIR)) {
        for (const file of fs.readdirSync(UPLOADS_DIR)) {
          if (file.startsWith(`${safeId}.`) || file.startsWith(`${safeId}_thumb.`)) {
            fs.unlinkSync(path.join(UPLOADS_DIR, file));
          }
        }
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('Erro ao excluir arquivo:', err);
      res.status(500).json({ error: 'Falha ao excluir imagem.' });
    }
  });

  app.post('/api/reset-defaults', (req, res) => {
    const { preserveCustom } = (req.body || {}) as { preserveCustom?: boolean };
    const current = readProject();
    const customScenes = preserveCustom
      ? current.scenes.filter((s) => !s.isBuiltin && !s.id.startsWith('builtin-teste-'))
      : [];
    const nextScenes = [...structuredClone(DEFAULT_SCENES), ...customScenes];
    res.json(writeProject(nextScenes));
  });

  app.get('/api/game-state', (_req, res) => {
    if (!fs.existsSync(GAME_STATE_FILE)) {
      res.json({ state: null });
      return;
    }
    try {
      const state = JSON.parse(fs.readFileSync(GAME_STATE_FILE, 'utf8')) as GameState;
      res.json({ state });
    } catch {
      res.json({ state: null });
    }
  });

  app.put('/api/game-state', (req, res) => {
    const state = req.body as GameState;
    if (!state || typeof state.sceneIndex !== 'number') {
      res.status(400).json({ error: 'Estado de jogo inválido.' });
      return;
    }
    atomicWriteJson(GAME_STATE_FILE, state);
    res.json({ ok: true, state });
  });

  app.delete('/api/game-state', (_req, res) => {
    if (fs.existsSync(GAME_STATE_FILE)) {
      fs.unlinkSync(GAME_STATE_FILE);
    }
    res.json({ ok: true });
  });

  /* ---------- Roulette & Quiz API ---------- */

  app.get('/api/roulette', (_req, res) => {
    res.json(readRoulette());
  });

  app.put('/api/roulette/settings', (req, res) => {
    const body = req.body as {
      settings?: RouletteSettings;
      quizQuestions?: QuizQuestion[];
    };
    const current = readRoulette();
    const next: RouletteData = {
      settings: body.settings
        ? { ...body.settings, updatedAt: new Date().toISOString() }
        : current.settings,
      participations: current.participations,
      quizQuestions: Array.isArray(body.quizQuestions)
        ? body.quizQuestions
        : current.quizQuestions,
    };
    res.json(writeRoulette(next));
  });

  app.post('/api/roulette/spin', (req, res) => {
    const body = req.body as Partial<Participation>;
    if (!body.factory || !body.registrationNumber || !body.prizeName || !body.outcomeType) {
      res.status(400).json({ error: 'Dados da participação incompletos.' });
      return;
    }

    const current = readRoulette();
    const regNormalized = String(body.registrationNumber).trim();

    if (!current.settings.allowDuplicateRegistration) {
      const duplicate = current.participations.find(
        (p) => p.registrationNumber.trim().toLowerCase() === regNormalized.toLowerCase(),
      );
      if (duplicate) {
        res.status(409).json({
          error: `Este registro já participou do sorteio (${duplicate.factory}). Não é permitido registrar o mesmo código duas vezes.`,
        });
        return;
      }
    }

    const nextStocks = structuredClone(current.settings.stocks);
    if (body.outcomeType === 'prize' && body.prizeId) {
      if (!nextStocks[body.factory]) {
        nextStocks[body.factory] = {};
      }
      const avail = Number(nextStocks[body.factory][body.prizeId] ?? 0);
      if (avail > 0) {
        nextStocks[body.factory][body.prizeId] = avail - 1;
      }
    }

    const record: Participation = {
      id: `part-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      factory: String(body.factory),
      registrationNumber: regNormalized,
      accentColor: body.accentColor,
      outcomeType: body.outcomeType === 'dica' ? 'dica' : 'prize',
      prizeId: String(body.prizeId || ''),
      prizeName: String(body.prizeName),
      tipText: body.tipText ? String(body.tipText) : undefined,
      quizCorrect: body.quizCorrect,
      roundNumber: typeof body.roundNumber === 'number' ? body.roundNumber : undefined,
    };

    const next: RouletteData = {
      ...current,
      settings: {
        ...current.settings,
        stocks: nextStocks,
        updatedAt: new Date().toISOString(),
      },
      participations: [record, ...current.participations],
    };

    writeRoulette(next);
    res.json({ data: next, record });
  });

  app.delete('/api/roulette/participations', (_req, res) => {
    const current = readRoulette();
    const next: RouletteData = {
      ...current,
      participations: [],
    };
    res.json(writeRoulette(next));
  });

  app.post('/api/roulette/reset', (_req, res) => {
    const current = readRoulette();
    const defaults = createDefaultRouletteData();
    const next: RouletteData = {
      ...defaults,
      participations: current.participations,
    };
    res.json(writeRoulette(next));
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Gincana de Segurança rodando na porta ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Erro fatal ao iniciar servidor:', err);
  process.exit(1);
});
