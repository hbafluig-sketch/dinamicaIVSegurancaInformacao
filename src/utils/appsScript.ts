import { createDefaultRouletteData, DEFAULT_PRIZE_IMAGES } from '../data/defaultRoulette.ts';
import type {
  Participation,
  QuizQuestion,
  RegionPoint,
  RouletteData,
  RouletteSettings,
  Scene,
  WheelItem,
} from '../types/gincana.ts';
import { resolveAssetUrl } from './assetUrl.ts';
import {
  compressDataUrlToLimit,
  mergeNewBuiltinScenes,
  SHEETS_SAFE_IMAGE_CHARS,
} from './storage.ts';

export const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbynWbFB3-Yq1xgy-FCJq-SAozijNUc6kEYumRFWI-DPHRIItO1dHkxZOp6KDsusBsBPkg/exec';

export type AppsScriptSyncType =
  | 'participacoes'
  | 'historico'
  | 'estoque'
  | 'quiz'
  | 'cenarios';

export interface AppsScriptLoadResult {
  rouletteData: RouletteData;
  scenes: Scene[];
  hasRemoteData: boolean;
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parseParticipationEntry(raw: unknown, idx: number): Participation | null {
  if (Array.isArray(raw)) {
    const first = String(raw[0] ?? '').trim();
    if (!first || /^id$/i.test(first)) return null;
    // Supports row format [id, dataHora, timestamp, factory, registrationNumber, tipo, prizeId, prizeName, tipText, quizCorrect, roundNumber, accentColor]
    const factory = String(raw[3] ?? raw[1] ?? '').trim();
    const registrationNumber = String(raw[4] ?? raw[2] ?? '').trim();
    const prizeName = String(raw[7] ?? raw[4] ?? '').trim();
    if (!factory || !registrationNumber || !prizeName) return null;
    const tsNum = Number(raw[2]);
    const timestamp = Number.isFinite(tsNum) && tsNum > 0 ? tsNum : Date.now() - idx;
    const tipoStr = String(raw[5] ?? '').toLowerCase();
    const outcomeType: 'prize' | 'dica' = tipoStr.includes('dica') ? 'dica' : 'prize';
    const record: Participation = {
      id: first,
      timestamp,
      factory,
      registrationNumber,
      outcomeType,
      prizeId: String(raw[6] ?? '').trim(),
      prizeName,
    };
    if (raw[8]) record.tipText = String(raw[8]);
    if (raw[9] === 'SIM' || raw[9] === true) record.quizCorrect = true;
    else if (raw[9] === 'NAO' || raw[9] === 'NÃO' || raw[9] === false) record.quizCorrect = false;
    const roundNum = Number(raw[10]);
    if (Number.isFinite(roundNum) && roundNum >= 1) record.roundNumber = Math.floor(roundNum);
    if (raw[11]) record.accentColor = String(raw[11]);
    return record;
  }

  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const factory = String(obj.factory ?? obj.unidade ?? obj.Unidade ?? '').trim();
  const registrationNumber = String(
    obj.registrationNumber ??
      obj.matricula ??
      obj.Matricula ??
      obj['Matrícula'] ??
      obj.registro ??
      obj.Registro ??
      '',
  ).trim();
  const prizeName = String(
    obj.prizeName ?? obj.resultado ?? obj.Resultado ?? obj.premio ?? obj['Prêmio'] ?? '',
  ).trim();
  if (!factory || !registrationNumber || !prizeName) return null;

  const rawTs = Number(obj.timestamp ?? obj.Timestamp);
  const timestamp = Number.isFinite(rawTs) && rawTs > 0 ? rawTs : Date.now() - idx;
  const rawType = String(obj.outcomeType ?? obj.tipo ?? obj.Tipo ?? '').toLowerCase();
  const outcomeType: 'prize' | 'dica' = rawType.includes('dica') ? 'dica' : 'prize';

  const record: Participation = {
    id: String(obj.id ?? obj.ID ?? `part-${timestamp}-${idx}`),
    timestamp,
    factory,
    registrationNumber,
    outcomeType,
    prizeId: String(obj.prizeId ?? obj.prize_id ?? obj['Prize ID'] ?? obj.PrizeID ?? ''),
    prizeName,
  };
  const tipVal = obj.tipText ?? obj.dica ?? obj.Dica;
  if (tipVal) record.tipText = String(tipVal);

  const quizVal = obj.quizCorrect ?? obj['Quiz Correto'] ?? obj.QuizCorreto;
  if (typeof quizVal === 'boolean') {
    record.quizCorrect = quizVal;
  } else if (typeof quizVal === 'string') {
    const upper = quizVal.trim().toUpperCase();
    if (upper === 'SIM' || upper === 'TRUE') record.quizCorrect = true;
    else if (upper === 'NAO' || upper === 'NÃO' || upper === 'FALSE') record.quizCorrect = false;
  }

  const roundNum = Number(obj.roundNumber ?? obj.rodada ?? obj.Rodada);
  if (Number.isFinite(roundNum) && roundNum >= 1) record.roundNumber = Math.floor(roundNum);
  const colorVal = obj.accentColor ?? obj.cor ?? obj.Cor;
  if (colorVal) record.accentColor = String(colorVal);
  return record;
}

function parseHeaderlessParticipationRow(obj: Record<string, unknown>, idx: number): Participation | null {
  const entries = Object.entries(obj);
  const idEntry = entries.find(([, v]) => typeof v === 'string' && /^part-\d+/.test(v));
  if (!idEntry) return null;

  const values = entries.map(([, v]) => v);
  const idIdx = entries.indexOf(idEntry);
  const id = String(idEntry[1]);
  const tsVal = Number(values[idIdx + 1]);
  const timestamp = Number.isFinite(tsVal) && tsVal > 1_000_000_000_000 ? tsVal : Date.now() - idx;
  const factory = String(values[idIdx + 2] ?? '').trim();
  const registrationNumber = String(values[idIdx + 3] ?? '').trim();
  const prizeId = String(values[idIdx + 4] ?? '').trim();
  const prizeName = String(values[idIdx + 5] ?? '').trim();
  if (!factory || !registrationNumber || !prizeName) return null;

  const outcomeType: 'prize' | 'dica' =
    prizeId === 'dica' || prizeName.toLowerCase() === 'dica' ? 'dica' : 'prize';

  const record: Participation = {
    id,
    timestamp,
    factory,
    registrationNumber,
    outcomeType,
    prizeId: prizeId || (outcomeType === 'dica' ? 'dica' : 'prize'),
    prizeName,
  };
  const colorVal = values.find((v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v));
  if (typeof colorVal === 'string') record.accentColor = colorVal;
  return record;
}

function parseSettingsAndStock(
  rawEstoque: unknown,
  fallbackSettings: RouletteSettings,
): { settings: RouletteSettings; found: boolean } {
  const parsed = tryParseJson(rawEstoque);
  if (!parsed) return { settings: fallbackSettings, found: false };

  const defaults = createDefaultRouletteData().settings;

  // Array of stock rows: [[unidade, itemId, itemLabel, qty], ...] or [{ unidade, itemId, estoque, ... }]
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { settings: fallbackSettings, found: false };
    const stocks: Record<string, Record<string, number>> = {};
    let parsedQuizEnabled: boolean | undefined;
    let parsedAllowDuplicate: boolean | undefined;
    const itemOverrides = new Map<string, Partial<WheelItem>>();

    for (const row of parsed) {
      if (Array.isArray(row)) {
        const factory = String(row[0] ?? '').trim();
        const itemId = String(row[1] ?? '').trim();
        if (!factory || !itemId || /^unidade$/i.test(factory)) continue;
        const qty = Math.max(0, Math.floor(Number(row[3] ?? row[2] ?? 0) || 0));
        if (!stocks[factory]) stocks[factory] = {};
        stocks[factory][itemId] = qty;
      } else if (row && typeof row === 'object') {
        const obj = row as Record<string, unknown>;
        const factory = String(obj.factory ?? obj.unidade ?? obj.Unidade ?? '').trim();
        const itemId = String(obj.itemId ?? obj.item_id ?? obj['Item ID'] ?? obj.ItemID ?? '').trim();
        if (!factory || !itemId) continue;
        const qty = Math.max(
          0,
          Math.floor(Number(obj.qty ?? obj.estoque ?? obj.Estoque ?? obj.quantidade ?? obj.Quantidade ?? 0) || 0),
        );
        if (!stocks[factory]) stocks[factory] = {};
        stocks[factory][itemId] = qty;

        const label = String(obj.item ?? obj.Item ?? obj.label ?? '').trim();
        const color = String(obj.color ?? obj.cor ?? '').trim();
        const outcomeRaw = String(obj.outcomeType ?? obj.tipo ?? '').trim().toLowerCase();
        const weightNum = Number(obj.weight ?? obj.peso);
        const imageUrl = String(obj.imageUrl ?? obj.imagemUrl ?? '').trim();
        const existing = itemOverrides.get(itemId) ?? {};
        if (label) existing.label = label;
        if (color) existing.color = color;
        if (outcomeRaw === 'dica' || outcomeRaw === 'prize') existing.outcomeType = outcomeRaw;
        if (Number.isFinite(weightNum) && weightNum >= 1) existing.weight = Math.floor(weightNum);
        if (imageUrl) existing.imageUrl = resolveAssetUrl(imageUrl);
        itemOverrides.set(itemId, existing);

        const qe = obj.quizEnabled;
        if (typeof qe === 'boolean') parsedQuizEnabled = qe;
        else if (typeof qe === 'string' && qe.trim()) {
          parsedQuizEnabled = /^(sim|true|1)$/i.test(qe.trim());
        }

        const ad = obj.allowDuplicateRegistration;
        if (typeof ad === 'boolean') parsedAllowDuplicate = ad;
        else if (typeof ad === 'string' && ad.trim()) {
          parsedAllowDuplicate = /^(sim|true|1)$/i.test(ad.trim());
        }
      }
    }
    const foundFactories = Object.keys(stocks);
    if (foundFactories.length === 0) return { settings: fallbackSettings, found: false };
    const mergedStocks: Record<string, Record<string, number>> = {};
    for (const [fac, map] of Object.entries(fallbackSettings.stocks)) {
      mergedStocks[fac] = { ...map };
    }
    for (const [fac, map] of Object.entries(stocks)) {
      mergedStocks[fac] = { ...(mergedStocks[fac] ?? {}), ...map };
    }
    const mergedItems = fallbackSettings.items.map((it) => {
      const patch = itemOverrides.get(it.id);
      return patch ? { ...it, ...patch } : it;
    });
    for (const [itemId, patch] of itemOverrides.entries()) {
      if (!mergedItems.some((it) => it.id === itemId) && patch.label) {
        mergedItems.push({
          id: itemId,
          label: patch.label,
          color: patch.color || '#0284c7',
          textColor: '#ffffff',
          outcomeType: patch.outcomeType || 'prize',
          weight: patch.weight || 1,
          imageUrl: patch.imageUrl || undefined,
        });
      }
    }

    return {
      found: true,
      settings: {
        ...fallbackSettings,
        factories: Array.from(new Set([...fallbackSettings.factories, ...foundFactories])),
        items: mergedItems,
        stocks: mergedStocks,
        quizEnabled: parsedQuizEnabled ?? fallbackSettings.quizEnabled,
        allowDuplicateRegistration:
          parsedAllowDuplicate ?? fallbackSettings.allowDuplicateRegistration,
      },
    };
  }

  if (typeof parsed !== 'object') return { settings: fallbackSettings, found: false };
  const obj = parsed as Record<string, unknown>;

  // Full settings object `{ stocks, factories, items, quizEnabled, allowDuplicateRegistration }`
  if ('stocks' in obj || 'items' in obj || 'factories' in obj) {
    const factories =
      Array.isArray(obj.factories) && obj.factories.length > 0
        ? obj.factories.map((f) => String(f))
        : fallbackSettings.factories;

    const items: WheelItem[] =
      Array.isArray(obj.items) && obj.items.length > 0
        ? (obj.items as WheelItem[]).map((it) => {
            const def = defaults.items.find((d) => d.id === it.id);
            const resolved = resolveAssetUrl(it.imageUrl || def?.imageUrl);
            return {
              ...it,
              imageUrl: resolved || undefined,
            };
          })
        : fallbackSettings.items;

    const rawStocks =
      obj.stocks && typeof obj.stocks === 'object'
        ? (obj.stocks as Record<string, Record<string, number>>)
        : fallbackSettings.stocks;

    const stocks: Record<string, Record<string, number>> = {};
    for (const [fac, map] of Object.entries(rawStocks)) {
      if (!map || typeof map !== 'object') continue;
      stocks[fac] = {};
      for (const [itemId, qty] of Object.entries(map)) {
        const n = Number(qty);
        stocks[fac][itemId] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
      }
    }

    return {
      found: true,
      settings: {
        factories,
        items,
        stocks: Object.keys(stocks).length > 0 ? stocks : fallbackSettings.stocks,
        quizEnabled:
          typeof obj.quizEnabled === 'boolean' ? obj.quizEnabled : fallbackSettings.quizEnabled,
        allowDuplicateRegistration:
          typeof obj.allowDuplicateRegistration === 'boolean'
            ? obj.allowDuplicateRegistration
            : fallbackSettings.allowDuplicateRegistration,
        updatedAt:
          typeof obj.updatedAt === 'string' ? obj.updatedAt : fallbackSettings.updatedAt,
      },
    };
  }

  // Plain map `{ "Unidade Matriz": { "camiseta": 10, ... } }`
  const mapEntries = Object.entries(obj).filter(
    ([, v]) => v && typeof v === 'object' && !Array.isArray(v),
  );
  if (mapEntries.length === 0) return { settings: fallbackSettings, found: false };

  const stocks: Record<string, Record<string, number>> = {};
  for (const [fac, itemsMap] of mapEntries) {
    stocks[fac] = {};
    for (const [itemId, qty] of Object.entries(itemsMap as Record<string, unknown>)) {
      const n = Number(qty);
      stocks[fac][itemId] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }
  }
  return {
    found: true,
    settings: {
      ...fallbackSettings,
      factories: Array.from(new Set([...fallbackSettings.factories, ...Object.keys(stocks)])),
      stocks,
    },
  };
}

function parseQuizList(rawQuiz: unknown): QuizQuestion[] | null {
  const parsed = tryParseJson(rawQuiz);
  if (!Array.isArray(parsed)) return null;
  const result: QuizQuestion[] = [];
  parsed.forEach((entry, idx) => {
    if (Array.isArray(entry)) {
      const id = String(entry[0] ?? '').trim();
      const question = String(entry[1] ?? '').trim();
      if (!question || /^id$/i.test(id)) return;
      const opts = [String(entry[2] ?? ''), String(entry[3] ?? ''), String(entry[4] ?? '')].filter(
        Boolean,
      );
      if (opts.length < 2) return;
      result.push({
        id: id || `quiz-${idx + 1}`,
        question,
        options: opts,
        correctIndex: Math.max(0, Number(entry[5] ?? 0) || 0),
        explanation: String(entry[6] ?? ''),
      });
      return;
    }

    if (!entry || typeof entry !== 'object') return;
    const obj = entry as Record<string, unknown>;
    const question = String(obj.question ?? obj.pergunta ?? obj.Pergunta ?? '').trim();
    const rawOpts = tryParseJson(
      obj.options ?? obj.opcoes ?? obj.Opcoes ?? obj['Opções'] ?? obj['Opções JSON'],
    );
    const options = Array.isArray(rawOpts)
      ? rawOpts.map((o) => String(o)).filter(Boolean)
      : [
          obj['Alternativa A'] ?? obj.alternativaA,
          obj['Alternativa B'] ?? obj.alternativaB,
          obj['Alternativa C'] ?? obj.alternativaC,
          obj['Alternativa D'] ?? obj.alternativaD,
        ]
          .map((o) => (o == null ? '' : String(o).trim()))
          .filter(Boolean);
    if (!question || options.length < 2) return;
    result.push({
      id: String(obj.id ?? obj.ID ?? `quiz-${idx + 1}`),
      question,
      options,
      correctIndex: Math.max(
        0,
        Number(obj.correctIndex ?? obj.correta ?? obj.Correta ?? obj['Índice Correto'] ?? 0) || 0,
      ),
      explanation: String(
        obj.explanation ?? obj.explicacao ?? obj.Explicacao ?? obj['Explicação'] ?? '',
      ),
    });
  });
  return result.length > 0 ? result : null;
}

function parseSceneList(rawScenes: unknown, fallbackScenes: Scene[]): Scene[] | null {
  const parsed = tryParseJson(rawScenes);
  if (!Array.isArray(parsed)) return null;
  const result: Scene[] = [];

  for (const entry of parsed) {
    if (Array.isArray(entry)) {
      const id = String(entry[0] ?? '').trim();
      const name = String(entry[1] ?? '').trim();
      if (!id || !name || /^id$/i.test(id)) continue;
      const fallback = fallbackScenes.find((s) => s.id === id);
      const rawUrl = String(entry[2] ?? '').trim();
      const rawPoints = tryParseJson(entry[5]);
      const points: RegionPoint[] = Array.isArray(rawPoints)
        ? (rawPoints as RegionPoint[])
        : fallback?.points ?? [];
      const imageUrl = resolveAssetUrl(rawUrl || fallback?.imageUrl || '');
      const thumbUrl = resolveAssetUrl(fallback?.thumbUrl || rawUrl || '');
      if (!imageUrl) continue;
      result.push({
        id,
        name,
        imageUrl,
        thumbUrl: thumbUrl || undefined,
        naturalWidth: fallback?.naturalWidth,
        naturalHeight: fallback?.naturalHeight,
        hideLegendPct: Number(entry[3] ?? fallback?.hideLegendPct ?? 0) || 0,
        isBuiltin: entry[4] === 'SIM' || entry[4] === true || Boolean(fallback?.isBuiltin),
        points,
      });
      continue;
    }

    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const id = String(obj.id ?? obj.ID ?? '').trim();
    const name = String(obj.name ?? obj.nome ?? obj.Nome ?? '').trim();
    if (!id || !name) continue;
    const fallback = fallbackScenes.find((s) => s.id === id);
    const rawUrl = String(
      obj.imageUrl ?? obj.imagemUrl ?? obj['Imagem URL'] ?? obj.ImagemURL ?? obj.imagem ?? '',
    ).trim();
    const rawThumb = String(obj.thumbUrl ?? obj.ThumbUrl ?? obj['Thumb URL'] ?? '').trim();
    const rawPoints = tryParseJson(
      obj.points ?? obj.pontos ?? obj['Pontos JSON'] ?? obj.PontosJSON,
    );
    const points: RegionPoint[] = Array.isArray(rawPoints)
      ? (rawPoints as RegionPoint[])
      : fallback?.points ?? [];
    const imageUrl = resolveAssetUrl(rawUrl || fallback?.imageUrl || '');
    const thumbUrl = resolveAssetUrl(rawThumb || fallback?.thumbUrl || rawUrl || '');
    if (!imageUrl) continue;

    const rawBuiltin = obj.isBuiltin ?? obj.IsBuiltin;
    const isBuiltin =
      typeof rawBuiltin === 'boolean'
        ? rawBuiltin
        : typeof rawBuiltin === 'string'
          ? /^(sim|true|1)$/i.test(rawBuiltin.trim())
          : Boolean(fallback?.isBuiltin);

    result.push({
      id,
      name,
      imageUrl,
      thumbUrl: thumbUrl || undefined,
      naturalWidth:
        typeof obj.naturalWidth === 'number' ? obj.naturalWidth : fallback?.naturalWidth,
      naturalHeight:
        typeof obj.naturalHeight === 'number' ? obj.naturalHeight : fallback?.naturalHeight,
      hideLegendPct:
        Number(obj.hideLegendPct ?? obj.HideLegendPct ?? fallback?.hideLegendPct ?? 0) || 0,
      isBuiltin,
      points,
    });
  }

  return result.length > 0 ? result : null;
}

function formatDateTimePtBr(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function serializeEstoqueForAppsScript(settings: RouletteSettings) {
  const safeImages = new Map<string, string>();
  await Promise.all(
    settings.items.map(async (item) => {
      const raw = item.imageUrl ?? '';
      safeImages.set(
        item.id,
        raw.startsWith('data:image/') && raw.length > SHEETS_SAFE_IMAGE_CHARS
          ? await compressDataUrlToLimit(raw, SHEETS_SAFE_IMAGE_CHARS)
          : raw,
      );
    }),
  );

  const rows: Array<Record<string, unknown>> = [];
  for (const factory of settings.factories) {
    const factoryStocks = settings.stocks[factory] ?? {};
    for (const item of settings.items) {
      rows.push({
        unidade: factory,
        itemId: item.id,
        item: item.label,
        estoque: factoryStocks[item.id] ?? 0,
        outcomeType: item.outcomeType,
        color: item.color,
        weight: item.weight,
        imageUrl: safeImages.get(item.id) ?? '',
        quizEnabled: settings.quizEnabled ? 'SIM' : 'NAO',
        allowDuplicateRegistration: settings.allowDuplicateRegistration ? 'SIM' : 'NAO',
      });
    }
  }
  return rows;
}

export function serializeQuizForAppsScript(quizQuestions: QuizQuestion[]) {
  return quizQuestions.map((q) => ({
    id: q.id,
    question: q.question,
    options: JSON.stringify(q.options),
    correctIndex: q.correctIndex,
    explanation: q.explanation,
  }));
}

export async function serializeCenariosForAppsScript(scenes: Scene[]) {
  return Promise.all(
    scenes.map(async (s) => {
      const safeImage =
        s.imageUrl.startsWith('data:image/') && s.imageUrl.length > SHEETS_SAFE_IMAGE_CHARS
          ? await compressDataUrlToLimit(s.imageUrl, SHEETS_SAFE_IMAGE_CHARS)
          : s.imageUrl;
      const safeThumb =
        s.thumbUrl && s.thumbUrl !== s.imageUrl && s.thumbUrl.length <= 18000
          ? s.thumbUrl
          : '';
      return {
        id: s.id,
        name: s.name,
        imageUrl: safeImage,
        thumbUrl: safeThumb,
        naturalWidth: s.naturalWidth ?? '',
        naturalHeight: s.naturalHeight ?? '',
        hideLegendPct: s.hideLegendPct ?? 0,
        isBuiltin: Boolean(s.isBuiltin),
        points: JSON.stringify(s.points),
      };
    }),
  );
}

export function serializeParticipationForAppsScript(record: Participation) {
  return {
    ID: record.id,
    'Data/Hora': formatDateTimePtBr(record.timestamp),
    Timestamp: record.timestamp,
    Unidade: record.factory,
    'Matrícula': record.registrationNumber,
    Tipo: record.outcomeType === 'dica' ? 'Dica' : 'Brinde',
    'Prize ID': record.prizeId,
    Resultado: record.prizeName,
    Dica: record.tipText ?? '',
    'Quiz Correto': typeof record.quizCorrect === 'boolean' ? record.quizCorrect : '',
    Rodada: typeof record.roundNumber === 'number' ? record.roundNumber : '',
    Cor: record.accentColor ?? '',
  };
}

export async function postToAppsScript(
  tipo: AppsScriptSyncType,
  dados: unknown,
): Promise<Record<string, unknown>> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), 30000) : null;

  try {
    console.log('[AppsScript POST] Enviando:', { tipo, dados });
    let response: Response;
    try {
      response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        redirect: 'follow',
        credentials: 'omit',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({ tipo, dados }),
        signal: controller?.signal,
      });
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'AbortError'
          ? `Tempo limite excedido ao enviar "${tipo}" para o Apps Script.`
          : err instanceof Error
            ? `Erro no fetch ao enviar "${tipo}": ${err.message}`
            : `Falha de rede ao enviar "${tipo}" para o Apps Script.`;
      console.log('[AppsScript POST] Falha no fetch:', tipo, err);
      throw new Error(msg);
    }

    const text = await response.text();
    console.log('[AppsScript POST] Resposta bruta:', tipo, response.status, text);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ao enviar "${tipo}": ${text || 'sem corpo'}`);
    }

    if (!text) {
      return { status: 'ok' };
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch (parseErr) {
      console.log('[AppsScript POST] Resposta não é JSON válido:', tipo, parseErr, text);
      throw new Error(`Resposta inválida do Apps Script ao enviar "${tipo}": ${text.slice(0, 180)}`);
    }

    console.log('[AppsScript POST] JSON parseado:', tipo, json);

    const statusLower = typeof json.status === 'string' ? json.status.trim().toLowerCase() : '';
    if (json.ok === false || statusLower === 'erro' || statusLower === 'error') {
      const errMsg = String(
        json.mensagem ?? json.message ?? json.error ?? `Erro retornado pelo Apps Script em "${tipo}".`,
      );
      throw new Error(errMsg);
    }

    return json;
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

export async function fetchFromAppsScript(
  fallbackRoulette: RouletteData,
  fallbackScenes: Scene[],
): Promise<AppsScriptLoadResult> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), 15000) : null;

  try {
    let res: Response;
    try {
      res = await fetch(APPS_SCRIPT_URL, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'follow',
        signal: controller?.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Tempo limite excedido ao consultar o Google Apps Script.');
      }
      throw new Error(
        'Não foi possível acessar a URL do Google Apps Script (CORS ou permissão). Verifique se a implantação está como "Quem pode acessar: Qualquer pessoa".',
      );
    }

    if (!res.ok) {
      throw new Error(`Erro HTTP ${res.status} ao consultar o Google Apps Script.`);
    }

    const rawText = await res.text();
    if (!rawText || rawText.trim().startsWith('<')) {
      throw new Error(
        'O Google Apps Script retornou uma página HTML/login em vez de JSON. Verifique a permissão "Qualquer pessoa" na implantação.',
      );
    }

    const rawBody = JSON.parse(rawText) as Record<string, unknown>;
    const envelopeCandidate = tryParseJson(rawBody?.dados ?? rawBody?.data);
    const root =
      envelopeCandidate && typeof envelopeCandidate === 'object' && !Array.isArray(envelopeCandidate)
        ? (envelopeCandidate as Record<string, unknown>)
        : rawBody;

    const rawParticipacoes = tryParseJson(root.participacoes);
    const rawHistorico = tryParseJson(root.historico);
    const rawEstoque = root.estoque ?? root.settings ?? root.stocks;
    const rawQuiz = root.quiz ?? root.quizQuestions;
    const rawCenarios = root.cenarios ?? root.scenes;

    let hasRemoteData = false;

    let participations = fallbackRoulette.participations;
    const combinedRawParts: unknown[] = [];
    if (Array.isArray(rawParticipacoes)) combinedRawParts.push(...rawParticipacoes);
    if (Array.isArray(rawHistorico)) combinedRawParts.push(...rawHistorico);

    if (Array.isArray(rawParticipacoes) || Array.isArray(rawHistorico)) {
      const seenIds = new Set<string>();
      const parsedParts: Participation[] = [];
      combinedRawParts.forEach((row, idx) => {
        const direct = parseParticipationEntry(row, idx);
        const parsed =
          direct ??
          (row && typeof row === 'object' && !Array.isArray(row)
            ? parseHeaderlessParticipationRow(row as Record<string, unknown>, idx)
            : null);
        if (parsed && !seenIds.has(parsed.id)) {
          seenIds.add(parsed.id);
          parsedParts.push(parsed);
        }
      });
      parsedParts.sort((a, b) => b.timestamp - a.timestamp);
      participations = parsedParts;
      if (parsedParts.length > 0) hasRemoteData = true;
    }

    const stockRes = parseSettingsAndStock(rawEstoque, fallbackRoulette.settings);
    if (stockRes.found) hasRemoteData = true;

    const parsedQuiz = parseQuizList(rawQuiz);
    if (parsedQuiz) hasRemoteData = true;

    const parsedScenes = parseSceneList(rawCenarios, fallbackScenes);
    if (parsedScenes) hasRemoteData = true;

    // Ensure default prize images remain resolved even when remote items omit imageUrl
    const resolvedItems = stockRes.settings.items.map((it) => {
      const resolved = resolveAssetUrl(it.imageUrl || DEFAULT_PRIZE_IMAGES[it.id]);
      return {
        ...it,
        imageUrl: resolved || undefined,
      };
    });

    return {
      rouletteData: {
        version: fallbackRoulette.version,
        settings: {
          ...stockRes.settings,
          items: resolvedItems,
        },
        participations,
        quizQuestions: parsedQuiz ?? fallbackRoulette.quizQuestions,
      },
      scenes: mergeNewBuiltinScenes(parsedScenes ?? fallbackScenes),
      hasRemoteData,
    };
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}
