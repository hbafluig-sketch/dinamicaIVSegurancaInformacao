import { createDefaultRouletteData } from '../data/defaultRoulette.ts';
import type {
  Participation,
  QuizQuestion,
  RegionPoint,
  RouletteData,
  RouletteSettings,
  Scene,
  WheelItem,
} from '../types/gincana.ts';

const SHEET_CONFIG_KEY = 'gincanaSI_googleSheet_config_v1';
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export const SHEET_TABS = {
  PARTICIPATIONS: 'Participacoes',
  STOCKS: 'Estoques',
  CONFIG: 'Configuracoes',
  SCENES: 'Cenarios',
} as const;

export interface GoogleSheetConfig {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  autoSyncEnabled: boolean;
  lastSyncedAt?: string;
}

export class GoogleSheetsAuthError extends Error {
  constructor(message = 'Sessão do Google expirada. Faça login novamente.') {
    super(message);
    this.name = 'GoogleSheetsAuthError';
  }
}

export function loadSavedSheetConfig(): GoogleSheetConfig | null {
  try {
    const raw = localStorage.getItem(SHEET_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GoogleSheetConfig>;
    if (!parsed.spreadsheetId) return null;
    return {
      spreadsheetId: String(parsed.spreadsheetId),
      spreadsheetTitle: String(parsed.spreadsheetTitle || 'Planilha Google Sheets'),
      spreadsheetUrl:
        String(
          parsed.spreadsheetUrl ||
            `https://docs.google.com/spreadsheets/d/${parsed.spreadsheetId}/edit`,
        ),
      autoSyncEnabled: Boolean(parsed.autoSyncEnabled),
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function saveSheetConfig(config: GoogleSheetConfig | null): void {
  try {
    if (!config) {
      localStorage.removeItem(SHEET_CONFIG_KEY);
      return;
    }
    localStorage.setItem(SHEET_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  return trimmed.replace(/[^a-zA-Z0-9-_]/g, '');
}

async function sheetsFetch<T>(
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401) {
    throw new GoogleSheetsAuthError();
  }

  if (!res.ok) {
    let detail = `Erro ${res.status} na API do Google Sheets.`;
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      if (errBody?.error?.message) {
        detail = errBody.error.message;
      }
    } catch {
      // ignore
    }
    if (
      res.status === 403 &&
      /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(detail)
    ) {
      throw new GoogleSheetsAuthError(
        'Permissão do Google Sheets ausente na sessão atual. Clique em "Sign in with Google" e marque a permissão de acesso ao Google Sheets.',
      );
    }
    throw new Error(detail);
  }

  return (await res.json()) as T;
}

interface SpreadsheetMetadata {
  spreadsheetId: string;
  spreadsheetUrl: string;
  properties?: { title?: string };
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
}

export async function inspectSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
): Promise<{
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  tabTitles: string[];
}> {
  const meta = await sheetsFetch<SpreadsheetMetadata>(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`,
    accessToken,
  );
  return {
    spreadsheetId: meta.spreadsheetId,
    spreadsheetTitle: meta.properties?.title || 'Planilha Gincana',
    spreadsheetUrl:
      meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${meta.spreadsheetId}/edit`,
    tabTitles: (meta.sheets || [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t)),
  };
}

export async function ensureSpreadsheetTabs(
  accessToken: string,
  spreadsheetId: string,
): Promise<{
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  tabTitles: string[];
}> {
  const info = await inspectSpreadsheet(accessToken, spreadsheetId);
  const existing = new Set(info.tabTitles);
  const requiredTabs = Object.values(SHEET_TABS);
  const missing = requiredTabs.filter((tab) => !existing.has(tab));

  if (missing.length > 0) {
    await sheetsFetch(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: missing.map((title) => ({
            addSheet: { properties: { title } },
          })),
        }),
      },
    );
  }

  return {
    ...info,
    tabTitles: Array.from(new Set([...info.tabTitles, ...requiredTabs])),
  };
}

export async function createGincanaSpreadsheet(
  accessToken: string,
  rouletteData: RouletteData,
  scenes: Scene[],
  title = 'Gincana Segurança da Informação — Dados',
): Promise<GoogleSheetConfig> {
  const created = await sheetsFetch<SpreadsheetMetadata>(SHEETS_API_BASE, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: SHEET_TABS.PARTICIPATIONS } },
        { properties: { title: SHEET_TABS.STOCKS } },
        { properties: { title: SHEET_TABS.CONFIG } },
        { properties: { title: SHEET_TABS.SCENES } },
      ],
    }),
  });

  const config: GoogleSheetConfig = {
    spreadsheetId: created.spreadsheetId,
    spreadsheetTitle: created.properties?.title || title,
    spreadsheetUrl:
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
    autoSyncEnabled: true,
    lastSyncedAt: new Date().toISOString(),
  };

  await syncAllToGoogleSheet(accessToken, config.spreadsheetId, rouletteData, scenes);
  saveSheetConfig(config);
  return config;
}

const PARTICIPATION_HEADER = [
  'ID',
  'Data/Hora',
  'Timestamp',
  'Unidade',
  'Matrícula',
  'Tipo',
  'Prize ID',
  'Resultado',
  'Dica',
  'Quiz Correto',
  'Rodada',
  'Cor',
];

function participationToRow(p: Participation): string[] {
  return [
    p.id,
    new Date(p.timestamp).toLocaleString('pt-BR'),
    String(p.timestamp),
    p.factory,
    p.registrationNumber,
    p.outcomeType === 'dica' ? 'Dica' : 'Brinde',
    p.prizeId,
    p.prizeName,
    p.tipText || '',
    typeof p.quizCorrect === 'boolean' ? (p.quizCorrect ? 'SIM' : 'NAO') : '',
    typeof p.roundNumber === 'number' ? String(p.roundNumber) : '',
    p.accentColor || '',
  ];
}

function rowToParticipation(row: string[]): Participation | null {
  const id = String(row[0] || '').trim();
  const factory = String(row[3] || '').trim();
  const registrationNumber = String(row[4] || '').trim();
  const prizeName = String(row[7] || '').trim();
  if (!id || !factory || !registrationNumber || !prizeName) return null;

  const tsNum = Number(row[2]);
  const timestamp = Number.isFinite(tsNum) && tsNum > 0 ? tsNum : Date.now();
  const tipoRaw = String(row[5] || '').toLowerCase();
  const outcomeType: 'prize' | 'dica' = tipoRaw.includes('dica') ? 'dica' : 'prize';

  const result: Participation = {
    id,
    timestamp,
    factory,
    registrationNumber,
    outcomeType,
    prizeId: String(row[6] || '').trim(),
    prizeName,
  };
  if (row[8]) result.tipText = String(row[8]);
  if (row[9] === 'SIM') result.quizCorrect = true;
  else if (row[9] === 'NAO') result.quizCorrect = false;
  const roundNum = Number(row[10]);
  if (Number.isFinite(roundNum) && roundNum >= 1) result.roundNumber = Math.floor(roundNum);
  if (row[11]) result.accentColor = String(row[11]);
  return result;
}

function buildStockRows(
  stocks: Record<string, Record<string, number>>,
  items: WheelItem[],
  factories: string[],
): string[][] {
  const labelById = new Map(items.map((it) => [it.id, it.label]));
  const rows: string[][] = [['Unidade', 'Item ID', 'Item', 'Estoque']];

  const allFactories = Array.from(new Set([...factories, ...Object.keys(stocks || {})]));
  for (const factory of allFactories) {
    const factoryMap = stocks[factory] || {};
    const allItemIds = Array.from(
      new Set([...items.map((it) => it.id), ...Object.keys(factoryMap)]),
    );
    for (const itemId of allItemIds) {
      const qty = Math.max(0, Math.floor(Number(factoryMap[itemId] ?? 0)));
      rows.push([factory, itemId, labelById.get(itemId) || itemId, String(qty)]);
    }
  }
  return rows;
}

function fitSheetCell(value: string, max = 45000): string {
  return value.length <= max ? value : value.slice(0, max);
}

function buildConfigRows(settings: RouletteSettings, quizQuestions: QuizQuestion[]): string[][] {
  const now = settings.updatedAt || new Date().toISOString();
  const rows: string[][] = [['Chave', 'Valor JSON', 'Atualizado em']];

  rows.push([
    'meta',
    JSON.stringify({
      factories: settings.factories,
      quizEnabled: settings.quizEnabled,
      allowDuplicateRegistration: settings.allowDuplicateRegistration,
      updatedAt: now,
    }),
    now,
  ]);

  for (const it of settings.items) {
    const safeItem: WheelItem = {
      ...it,
      imageUrl: it.imageUrl && it.imageUrl.length <= 40000 ? it.imageUrl : undefined,
    };
    rows.push([`item:${it.id}`, fitSheetCell(JSON.stringify(safeItem)), now]);
  }

  for (const q of quizQuestions) {
    rows.push([`quiz:${q.id}`, fitSheetCell(JSON.stringify(q)), now]);
  }

  return rows;
}

function buildSceneRows(scenes: Scene[]): string[][] {
  const rows: string[][] = [
    ['ID', 'Nome', 'Imagem URL', 'HideLegendPct', 'IsBuiltin', 'Pontos JSON'],
  ];

  for (const sc of scenes) {
    const safeUrl =
      sc.imageUrl && sc.imageUrl.length <= 45000
        ? sc.imageUrl
        : sc.thumbUrl && sc.thumbUrl.length <= 45000
          ? sc.thumbUrl
          : '';
    rows.push([
      sc.id,
      sc.name,
      safeUrl,
      String(sc.hideLegendPct ?? 0),
      sc.isBuiltin ? 'SIM' : 'NAO',
      fitSheetCell(JSON.stringify(sc.points || [])),
    ]);
  }

  return rows;
}

async function replaceSheetValues(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  rows: string[][],
): Promise<void> {
  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tabName}!A:Z`)}:clear`,
    accessToken,
    { method: 'POST', body: JSON.stringify({}) },
  );

  if (rows.length === 0) return;

  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tabName}!A1`)}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        range: `${tabName}!A1`,
        majorDimension: 'ROWS',
        values: rows,
      }),
    },
  );
}

export async function syncAllToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  rouletteData: RouletteData,
  scenes: Scene[],
): Promise<void> {
  await ensureSpreadsheetTabs(accessToken, spreadsheetId);

  const partRows = [
    PARTICIPATION_HEADER,
    ...rouletteData.participations.map(participationToRow),
  ];
  const stockRows = buildStockRows(
    rouletteData.settings.stocks,
    rouletteData.settings.items,
    rouletteData.settings.factories,
  );
  const configRows = buildConfigRows(rouletteData.settings, rouletteData.quizQuestions);
  const sceneRows = buildSceneRows(scenes);

  await Promise.all([
    replaceSheetValues(accessToken, spreadsheetId, SHEET_TABS.PARTICIPATIONS, partRows),
    replaceSheetValues(accessToken, spreadsheetId, SHEET_TABS.STOCKS, stockRows),
    replaceSheetValues(accessToken, spreadsheetId, SHEET_TABS.CONFIG, configRows),
    replaceSheetValues(accessToken, spreadsheetId, SHEET_TABS.SCENES, sceneRows),
  ]);
}

export async function appendParticipationToSheet(
  accessToken: string,
  spreadsheetId: string,
  participation: Participation,
  updatedStocks: Record<string, Record<string, number>>,
  items: WheelItem[],
  factories: string[],
): Promise<void> {
  await ensureSpreadsheetTabs(accessToken, spreadsheetId);

  // Check if header exists; if empty, write header first
  const headerCheck = await sheetsFetch<{ values?: string[][] }>(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${SHEET_TABS.PARTICIPATIONS}!A1:L1`)}`,
    accessToken,
  );
  if (!headerCheck.values || headerCheck.values.length === 0) {
    await sheetsFetch(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${SHEET_TABS.PARTICIPATIONS}!A1`)}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          range: `${SHEET_TABS.PARTICIPATIONS}!A1`,
          majorDimension: 'ROWS',
          values: [PARTICIPATION_HEADER],
        }),
      },
    );
  }

  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${SHEET_TABS.PARTICIPATIONS}!A:L`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        majorDimension: 'ROWS',
        values: [participationToRow(participation)],
      }),
    },
  );

  const stockRows = buildStockRows(updatedStocks, items, factories);
  await replaceSheetValues(accessToken, spreadsheetId, SHEET_TABS.STOCKS, stockRows);
}

export async function syncStocksToSheet(
  accessToken: string,
  spreadsheetId: string,
  stocks: Record<string, Record<string, number>>,
  items: WheelItem[],
  factories: string[],
): Promise<void> {
  await ensureSpreadsheetTabs(accessToken, spreadsheetId);
  const stockRows = buildStockRows(stocks, items, factories);
  await replaceSheetValues(accessToken, spreadsheetId, SHEET_TABS.STOCKS, stockRows);
}

export async function syncSettingsToSheet(
  accessToken: string,
  spreadsheetId: string,
  settings: RouletteSettings,
  quizQuestions: QuizQuestion[],
): Promise<void> {
  await ensureSpreadsheetTabs(accessToken, spreadsheetId);
  await Promise.all([
    replaceSheetValues(
      accessToken,
      spreadsheetId,
      SHEET_TABS.STOCKS,
      buildStockRows(settings.stocks, settings.items, settings.factories),
    ),
    replaceSheetValues(
      accessToken,
      spreadsheetId,
      SHEET_TABS.CONFIG,
      buildConfigRows(settings, quizQuestions),
    ),
  ]);
}

export async function syncScenesToSheet(
  accessToken: string,
  spreadsheetId: string,
  scenes: Scene[],
): Promise<void> {
  await ensureSpreadsheetTabs(accessToken, spreadsheetId);
  await replaceSheetValues(
    accessToken,
    spreadsheetId,
    SHEET_TABS.SCENES,
    buildSceneRows(scenes),
  );
}

export async function clearParticipationsInSheet(
  accessToken: string,
  spreadsheetId: string,
): Promise<void> {
  await ensureSpreadsheetTabs(accessToken, spreadsheetId);
  await replaceSheetValues(accessToken, spreadsheetId, SHEET_TABS.PARTICIPATIONS, [
    PARTICIPATION_HEADER,
  ]);
}

interface BatchGetResponse {
  valueRanges?: Array<{ range?: string; values?: string[][] }>;
}

export async function loadAllFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  fallbackRoulette: RouletteData,
  fallbackScenes: Scene[],
): Promise<{
  rouletteData: RouletteData;
  scenes: Scene[];
  hasSheetData: boolean;
}> {
  const info = await ensureSpreadsheetTabs(accessToken, spreadsheetId);
  const tabSet = new Set(info.tabTitles);

  const ranges = [
    tabSet.has(SHEET_TABS.PARTICIPATIONS) ? `${SHEET_TABS.PARTICIPATIONS}!A2:L` : null,
    tabSet.has(SHEET_TABS.STOCKS) ? `${SHEET_TABS.STOCKS}!A2:D` : null,
    tabSet.has(SHEET_TABS.CONFIG) ? `${SHEET_TABS.CONFIG}!A2:C` : null,
    tabSet.has(SHEET_TABS.SCENES) ? `${SHEET_TABS.SCENES}!A2:F` : null,
  ].filter((r): r is string => Boolean(r));

  if (ranges.length === 0) {
    return { rouletteData: fallbackRoulette, scenes: fallbackScenes, hasSheetData: false };
  }

  const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const data = await sheetsFetch<BatchGetResponse>(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`,
    accessToken,
  );

  const vrList = data.valueRanges || [];
  const partRows = vrList[0]?.values || [];
  const stockRows = vrList[1]?.values || [];
  const configRows = vrList[2]?.values || [];
  const sceneRows = vrList[3]?.values || [];

  const hasSheetData =
    partRows.length > 0 || stockRows.length > 0 || configRows.length > 0 || sceneRows.length > 0;

  if (!hasSheetData) {
    return { rouletteData: fallbackRoulette, scenes: fallbackScenes, hasSheetData: false };
  }

  const defaults = createDefaultRouletteData();
  const participations = partRows
    .map(rowToParticipation)
    .filter((p): p is Participation => Boolean(p))
    .sort((a, b) => b.timestamp - a.timestamp);

  let factories = [...fallbackRoulette.settings.factories];
  let quizEnabled = fallbackRoulette.settings.quizEnabled;
  let allowDuplicateRegistration = fallbackRoulette.settings.allowDuplicateRegistration;
  let updatedAt = fallbackRoulette.settings.updatedAt;
  const parsedItems: WheelItem[] = [];
  const parsedQuiz: QuizQuestion[] = [];

  for (const row of configRows) {
    const key = String(row[0] || '');
    const rawJson = String(row[1] || '');
    if (!key || !rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      if (key === 'meta') {
        if (Array.isArray(parsed.factories) && parsed.factories.length > 0) {
          factories = parsed.factories.map((f) => String(f));
        }
        if (typeof parsed.quizEnabled === 'boolean') quizEnabled = parsed.quizEnabled;
        if (typeof parsed.allowDuplicateRegistration === 'boolean') {
          allowDuplicateRegistration = parsed.allowDuplicateRegistration;
        }
        if (typeof parsed.updatedAt === 'string') updatedAt = parsed.updatedAt;
      } else if (key.startsWith('item:')) {
        const item = parsed as unknown as WheelItem;
        const defaultMatch = defaults.settings.items.find((d) => d.id === item.id);
        parsedItems.push({
          ...item,
          imageUrl: item.imageUrl || defaultMatch?.imageUrl,
        });
      } else if (key.startsWith('quiz:')) {
        parsedQuiz.push(parsed as unknown as QuizQuestion);
      }
    } catch {
      // skip malformed config row
    }
  }

  const stocks: Record<string, Record<string, number>> =
    stockRows.length > 0 ? {} : structuredClone(fallbackRoulette.settings.stocks);
  for (const row of stockRows) {
    const factory = String(row[0] || '').trim();
    const itemId = String(row[1] || '').trim();
    const qty = Math.max(0, Math.floor(Number(row[3] ?? 0) || 0));
    if (!factory || !itemId) continue;
    if (!stocks[factory]) stocks[factory] = {};
    stocks[factory][itemId] = qty;
  }

  const parsedScenes: Scene[] = [];
  for (const row of sceneRows) {
    const id = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const imageUrl = String(row[2] || '').trim();
    if (!id || !name) continue;
    const fallbackScene = fallbackScenes.find((s) => s.id === id);
    let points: RegionPoint[] = fallbackScene?.points || [];
    try {
      if (row[5]) points = JSON.parse(row[5]) as RegionPoint[];
    } catch {
      // ignore
    }
    parsedScenes.push({
      id,
      name,
      imageUrl: imageUrl || fallbackScene?.imageUrl || '',
      thumbUrl: fallbackScene?.thumbUrl || imageUrl || '',
      naturalWidth: fallbackScene?.naturalWidth,
      naturalHeight: fallbackScene?.naturalHeight,
      hideLegendPct: Number(row[3] ?? fallbackScene?.hideLegendPct ?? 0),
      isBuiltin: row[4] === 'SIM',
      points,
    });
  }

  const nextRoulette: RouletteData = {
    version: fallbackRoulette.version,
    settings: {
      factories,
      items: parsedItems.length > 0 ? parsedItems : fallbackRoulette.settings.items,
      stocks,
      quizEnabled,
      allowDuplicateRegistration,
      updatedAt: updatedAt || new Date().toISOString(),
    },
    participations: partRows.length > 0 ? participations : fallbackRoulette.participations,
    quizQuestions: parsedQuiz.length > 0 ? parsedQuiz : fallbackRoulette.quizQuestions,
  };

  return {
    rouletteData: nextRoulette,
    scenes: parsedScenes.length > 0 ? parsedScenes : fallbackScenes,
    hasSheetData: true,
  };
}
