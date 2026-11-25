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

export const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyNsufsDgHxVfyj-yDBoea5OONbw6-FfYCxRm8Aw46uWEqRZsGHHZzY8E9p0XVmIszo/exec';

export type AppsScriptSyncType = 'historico' | 'estoque' | 'quiz' | 'cenarios';

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

function parseSettingsAndStock(
  rawEstoque: unknown,
  fallbackSettings: RouletteSettings,
): { settings: RouletteSettings; found: boolean } {
  const parsed = tryParseJson(rawEstoque);
  if (!parsed) return { settings: fallbackSettings, found: false };

  const defaults = createDefaultRouletteData().settings;

  // Array of stock rows: [[unidade, itemId, itemLabel, qty], ...] or [{ unidade, itemId, estoque }]
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { settings: fallbackSettings, found: false };
    const stocks: Record<string, Record<string, number>> = {};
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
    return {
      found: true,
      settings: {
        ...fallbackSettings,
        factories: Array.from(new Set([...fallbackSettings.factories, ...foundFactories])),
        stocks: mergedStocks,
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

export async function postToAppsScript(
  tipo: AppsScriptSyncType,
  dados: unknown,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({ tipo, dados }),
    });
  } catch {
    throw new Error(
      `Falha de rede/CORS ao enviar "${tipo}" para o Apps Script. Confirme se a implantação está publicada com "Quem pode acessar: Qualquer pessoa".`,
    );
  }

  if (!res.ok) {
    throw new Error(`Falha HTTP ${res.status} ao enviar "${tipo}" para o Google Apps Script.`);
  }

  const text = await res.text();
  if (!text) return { ok: true };
  if (text.trim().startsWith('<')) {
    throw new Error(
      'O Apps Script retornou HTML/login em vez de JSON. Publique a implantação com "Quem pode acessar: Qualquer pessoa".',
    );
  }
  try {
    const json = JSON.parse(text) as { ok?: boolean; error?: string; status?: string };
    if (json && json.ok === false && json.error) {
      throw new Error(json.error);
    }
    return json;
  } catch (err) {
    if (err instanceof SyntaxError) {
      return { ok: true, raw: text };
    }
    throw err;
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

    const rawHistorico = tryParseJson(root.historico ?? root.participations);
    const rawEstoque = root.estoque ?? root.settings ?? root.stocks;
    const rawQuiz = root.quiz ?? root.quizQuestions;
    const rawCenarios = root.cenarios ?? root.scenes;

    let hasRemoteData = false;

    let participations = fallbackRoulette.participations;
    if (Array.isArray(rawHistorico)) {
      const parsedParts = rawHistorico
        .map((row, idx) => parseParticipationEntry(row, idx))
        .filter((p): p is Participation => Boolean(p))
        .sort((a, b) => b.timestamp - a.timestamp);
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
      scenes: parsedScenes ?? fallbackScenes,
      hasRemoteData,
    };
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}
