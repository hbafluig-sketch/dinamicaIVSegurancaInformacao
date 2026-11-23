import {
  Building2,
  Download,
  ImageOff,
  Lightbulb,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BADGE_COLORS, DEFAULT_PRIZE_IMAGES } from '../data/defaultRoulette.ts';
import type {
  OutcomeType,
  QuizQuestion,
  RouletteData,
  RouletteSettings,
  WheelItem,
} from '../types/gincana.ts';
import { optimizePrizeImage, uid } from '../utils/storage.ts';

interface RouletteAdminPanelProps {
  mode: 'wheel' | 'quiz' | 'history';
  rouletteData: RouletteData;
  onSaveSettings: (settings: RouletteSettings, quizQuestions: QuizQuestion[]) => Promise<void>;
  onSaveStocks: (stocks: Record<string, Record<string, number>>) => Promise<void>;
  onClearHistory: () => Promise<void>;
  onResetRoulette: () => Promise<void>;
  onShowToast: (msg: string, tone?: 'info' | 'success' | 'warn') => void;
}

export function RouletteAdminPanel({
  mode,
  rouletteData,
  onSaveSettings,
  onSaveStocks,
  onClearHistory,
  onResetRoulette,
  onShowToast,
}: RouletteAdminPanelProps) {
  const { settings, participations, quizQuestions } = rouletteData;

  const [newFactory, setNewFactory] = useState('');
  const [selectedFactory, setSelectedFactory] = useState<string>(
    settings.factories[0] || 'Unidade Matriz',
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [confirmResetRoulette, setConfirmResetRoulette] = useState(false);

  const [localStocks, setLocalStocks] = useState<Record<string, Record<string, number>>>(
    () => settings.stocks,
  );
  const [stockDrafts, setStockDrafts] = useState<Record<string, string>>({});
  const localStocksRef = useRef<Record<string, Record<string, number>>>(settings.stocks);
  const stockSaveTimerRef = useRef<number | null>(null);
  const stockSavingActiveRef = useRef(false);

  useEffect(() => {
    if (!stockSavingActiveRef.current) {
      localStocksRef.current = settings.stocks;
      setLocalStocks(settings.stocks);
    }
  }, [settings.stocks]);

  useEffect(() => {
    return () => {
      if (stockSaveTimerRef.current) window.clearTimeout(stockSaveTimerRef.current);
    };
  }, []);

  // Add/Edit Wheel Item form
  const [itemModal, setItemModal] = useState<{
    open: boolean;
    editingId: string | null;
    label: string;
    color: string;
    outcomeType: OutcomeType;
    weight: number;
  }>({
    open: false,
    editingId: null,
    label: '',
    color: '#0284c7',
    outcomeType: 'prize',
    weight: 1,
  });

  // Add/Edit Quiz Question form
  const [quizModal, setQuizModal] = useState<{
    open: boolean;
    editingId: string | null;
    question: string;
    opt0: string;
    opt1: string;
    opt2: string;
    correctIndex: number;
    explanation: string;
  }>({
    open: false,
    editingId: null,
    question: '',
    opt0: '',
    opt1: '',
    opt2: '',
    correctIndex: 0,
    explanation: '',
  });

  const activeFactory = settings.factories.includes(selectedFactory)
    ? selectedFactory
    : settings.factories[0] || 'Unidade Matriz';

  const handleAddFactory = async () => {
    const name = newFactory.trim();
    if (!name) return;
    if (settings.factories.includes(name)) {
      onShowToast('Esta unidade já existe.', 'warn');
      return;
    }
    const nextStocks = structuredClone(settings.stocks);
    nextStocks[name] = {};
    for (const it of settings.items) {
      nextStocks[name][it.id] = it.outcomeType === 'dica' ? 999 : 15;
    }
    const nextSettings: RouletteSettings = {
      ...settings,
      factories: [...settings.factories, name],
      stocks: nextStocks,
    };
    await onSaveSettings(nextSettings, quizQuestions);
    setSelectedFactory(name);
    setNewFactory('');
    onShowToast(`Unidade "${name}" adicionada.`, 'success');
  };

  const handleRemoveFactory = async (name: string) => {
    if (settings.factories.length <= 1) {
      onShowToast('Mantenha pelo menos uma unidade cadastrada.', 'warn');
      return;
    }
    const nextFactories = settings.factories.filter((f) => f !== name);
    const nextStocks = structuredClone(settings.stocks);
    delete nextStocks[name];
    await onSaveSettings(
      { ...settings, factories: nextFactories, stocks: nextStocks },
      quizQuestions,
    );
    onShowToast(`Unidade "${name}" removida.`, 'info');
  };

  const queueStockSave = (nextStocks: Record<string, Record<string, number>>) => {
    localStocksRef.current = nextStocks;
    setLocalStocks(nextStocks);
    stockSavingActiveRef.current = true;
    if (stockSaveTimerRef.current) window.clearTimeout(stockSaveTimerRef.current);
    stockSaveTimerRef.current = window.setTimeout(async () => {
      try {
        await onSaveStocks(localStocksRef.current);
      } catch {
        // toast already handled by parent
      } finally {
        stockSavingActiveRef.current = false;
      }
    }, 220);
  };

  const handleUpdateStock = (itemId: string, qty: number, clearDraft = true) => {
    const cleanQty = Math.max(0, Math.floor(Number.isFinite(qty) ? qty : 0));
    const nextStocks = structuredClone(localStocksRef.current);
    if (!nextStocks[activeFactory]) nextStocks[activeFactory] = {};
    nextStocks[activeFactory][itemId] = cleanQty;
    if (clearDraft) {
      const draftKey = `${activeFactory}::${itemId}`;
      setStockDrafts((prev) => {
        if (!(draftKey in prev)) return prev;
        const copy = { ...prev };
        delete copy[draftKey];
        return copy;
      });
    }
    queueStockSave(nextStocks);
  };

  const handleStockInputChange = (itemId: string, raw: string) => {
    const draftKey = `${activeFactory}::${itemId}`;
    setStockDrafts((prev) => ({ ...prev, [draftKey]: raw }));
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      handleUpdateStock(itemId, parseInt(trimmed, 10), false);
    }
  };

  const handleStockInputBlur = (itemId: string) => {
    const draftKey = `${activeFactory}::${itemId}`;
    const raw = stockDrafts[draftKey];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    const parsed = trimmed === '' ? 0 : Math.max(0, parseInt(trimmed, 10) || 0);
    handleUpdateStock(itemId, parsed, true);
  };

  const handleUpdateItemInline = async (itemId: string, patch: Partial<WheelItem>) => {
    const nextItems = settings.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
    await onSaveSettings({ ...settings, items: nextItems }, quizQuestions);
  };

  const handleUploadPrizeImage = async (itemId: string, file?: File) => {
    if (!file) return;
    try {
      const imageUrl = await optimizePrizeImage(file, itemId);
      await handleUpdateItemInline(itemId, { imageUrl });
      onShowToast('Imagem do brinde atualizada.', 'success');
    } catch {
      onShowToast('Erro ao carregar imagem do brinde.', 'warn');
    }
  };

  const handleSaveWheelItem = async () => {
    const label = itemModal.label.trim();
    if (!label) {
      onShowToast('Informe o nome do item da roleta.', 'warn');
      return;
    }
    const nextItems = [...settings.items];
    const nextStocks = structuredClone(settings.stocks);

    if (itemModal.editingId) {
      const idx = nextItems.findIndex((i) => i.id === itemModal.editingId);
      if (idx >= 0) {
        nextItems[idx] = {
          ...nextItems[idx],
          label,
          color: itemModal.color,
          outcomeType: itemModal.outcomeType,
          weight: Math.max(1, itemModal.weight),
        };
      }
    } else {
      const newItem: WheelItem = {
        id: uid('item'),
        label,
        color: itemModal.color,
        textColor: '#ffffff',
        outcomeType: itemModal.outcomeType,
        weight: Math.max(1, itemModal.weight),
      };
      nextItems.push(newItem);
      for (const f of settings.factories) {
        if (!nextStocks[f]) nextStocks[f] = {};
        nextStocks[f][newItem.id] = newItem.outcomeType === 'dica' ? 15 : 10;
      }
    }

    await onSaveSettings({ ...settings, items: nextItems, stocks: nextStocks }, quizQuestions);
    setItemModal((m) => ({ ...m, open: false }));
    onShowToast('Item da roleta salvo.', 'success');
  };

  const handleDeleteWheelItem = async (id: string) => {
    if (settings.items.length <= 2) {
      onShowToast('A roleta precisa de pelo menos 2 fatias.', 'warn');
      return;
    }
    const nextItems = settings.items.filter((i) => i.id !== id);
    await onSaveSettings({ ...settings, items: nextItems }, quizQuestions);
    onShowToast('Item removido da roleta.', 'info');
  };

  const handleSaveQuizQuestion = async () => {
    const q = quizModal.question.trim();
    const o0 = quizModal.opt0.trim();
    const o1 = quizModal.opt1.trim();
    const o2 = quizModal.opt2.trim();
    const exp = quizModal.explanation.trim();
    if (!q || !o0 || !o1 || !o2 || !exp) {
      onShowToast('Preencha a pergunta, as 3 alternativas e a explicação.', 'warn');
      return;
    }

    const nextQuestions = [...quizQuestions];
    const payload: QuizQuestion = {
      id: quizModal.editingId || uid('quiz'),
      question: q,
      options: [o0, o1, o2],
      correctIndex: quizModal.correctIndex,
      explanation: exp,
    };

    if (quizModal.editingId) {
      const idx = nextQuestions.findIndex((x) => x.id === quizModal.editingId);
      if (idx >= 0) nextQuestions[idx] = payload;
    } else {
      nextQuestions.push(payload);
    }

    await onSaveSettings(settings, nextQuestions);
    setQuizModal((m) => ({ ...m, open: false }));
    onShowToast('Pergunta do quiz salva.', 'success');
  };

  const handleDeleteQuiz = async (id: string) => {
    const nextQuestions = quizQuestions.filter((q) => q.id !== id);
    await onSaveSettings(settings, nextQuestions);
    onShowToast('Pergunta removida.', 'info');
  };

  const chartData = useMemo(() => {
    return settings.factories.map((f) => {
      const rows = participations.filter((p) => p.factory === f);
      return {
        factory: f,
        Brindes: rows.filter((r) => r.outcomeType === 'prize').length,
        Dicas: rows.filter((r) => r.outcomeType === 'dica').length,
      };
    });
  }, [participations, settings.factories]);

  const filteredParticipations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return participations;
    return participations.filter(
      (p) =>
        p.factory.toLowerCase().includes(term) ||
        p.registrationNumber.toLowerCase().includes(term) ||
        p.prizeName.toLowerCase().includes(term),
    );
  }, [participations, searchTerm]);

  const exportCsv = () => {
    const header = ['Data/Hora', 'Unidade', 'Matricula', 'Tipo', 'Resultado', 'Rodada'];
    const lines = participations.map((p) => [
      new Date(p.timestamp).toLocaleString('pt-BR'),
      p.factory,
      p.registrationNumber,
      p.outcomeType === 'prize' ? 'Brinde' : 'Dica',
      p.prizeName,
      p.roundNumber ? String(p.roundNumber) : '-',
    ]);
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'participacoes-roleta-ciberseguranca.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  };

  if (mode === 'wheel') {
    return (
      <div className="space-y-6">
        {/* General Roulette Policies */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Regras da Roleta e Unidades
              </h2>
              <p className="text-sm text-slate-600">
                Configure as unidades participantes, controle de estoque por fábrica e regras do quiz.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmResetRoulette(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restaurar padrão da roleta</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={settings.quizEnabled}
                onChange={(e) =>
                  void onSaveSettings({ ...settings, quizEnabled: e.target.checked }, quizQuestions)
                }
                className="mt-0.5 accent-sky-700"
              />
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Exigir Quiz de Cibersegurança antes de girar
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  O participante responde 1 pergunta educativa antes de liberar o botão da roleta.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={settings.allowDuplicateRegistration}
                onChange={(e) =>
                  void onSaveSettings(
                    { ...settings, allowDuplicateRegistration: e.target.checked },
                    quizQuestions,
                  )
                }
                className="mt-0.5 accent-sky-700"
              />
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Permitir que a mesma matrícula gire mais de uma vez
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Desmarque para limitar a 1 giro por matrícula em cada unidade.
                </div>
              </div>
            </label>
          </div>

          {/* Factories */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Unidades / Fábricas</h3>
            <div className="flex flex-wrap gap-2">
              {settings.factories.map((f) => (
                <div
                  key={f}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800"
                >
                  <span>{f}</span>
                  <button
                    type="button"
                    onClick={() => void handleRemoveFactory(f)}
                    className="text-slate-400 hover:text-rose-700 cursor-pointer"
                    aria-label={`Remover ${f}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 max-w-md">
              <input
                type="text"
                value={newFactory}
                onChange={(e) => setNewFactory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddFactory();
                }}
                placeholder="Nova unidade (ex.: Filial Sul)"
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
              <button
                type="button"
                onClick={() => void handleAddFactory()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar</span>
              </button>
            </div>
          </div>
        </section>

        {/* Wheel Slices, Product Photos & Stock by Factory */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Estoque, Brindes & Cores da Roleta
              </h2>
              <p className="text-sm text-slate-600">
                As chances na roleta seguem a quantidade em estoque (oculto na tela dos participantes). Itens com estoque 0 continuam visíveis na roleta, mas nunca são sorteados.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                setItemModal({
                  open: true,
                  editingId: null,
                  label: '',
                  color: BADGE_COLORS[0].hex,
                  outcomeType: 'prize',
                  weight: 1,
                })
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo item</span>
            </button>
          </div>

          {/* Factory selector tabs with remaining counts */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0 mr-1">
              Fábricas:
            </span>
            {settings.factories.map((f) => {
              const isSelected = activeFactory === f;
              const prizeCount = settings.items
                .filter((it) => it.outcomeType === 'prize')
                .reduce((sum, it) => sum + Math.max(0, Number(localStocks[f]?.[it.id] ?? 0)), 0);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setSelectedFactory(f)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                  }`}
                >
                  <Building2 className="w-3 h-3" />
                  <span>{f}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono tabular-nums ${
                      isSelected ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {prizeCount} un.
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-3">
            {settings.items.map((item) => {
              const stockVal = Math.max(0, Number(localStocks[activeFactory]?.[item.id] ?? 0));
              const draftKey = `${activeFactory}::${item.id}`;
              const inputDisplay = draftKey in stockDrafts ? stockDrafts[draftKey] : String(stockVal);
              const isTip = item.outcomeType === 'dica';
              const defaultImg = DEFAULT_PRIZE_IMAGES[item.id];
              const isCustomImg = Boolean(
                defaultImg && item.imageUrl && item.imageUrl !== defaultImg,
              );

              return (
                <div
                  key={item.id}
                  className="p-4 bg-slate-50/80 border border-slate-200 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    {isTip ? (
                      <div className="w-16 h-16 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                        <Lightbulb className="w-6 h-6 text-amber-600" />
                      </div>
                    ) : item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.label}
                        className="w-16 h-16 rounded-xl object-contain p-1 border border-slate-200 bg-white shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                        <ImageOff className="w-5 h-5 text-slate-400" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                          {isTip ? 'Opção Educativa (Sem Estoque Físico)' : 'Brinde'}
                        </span>
                      </div>

                      <input
                        type="text"
                        value={item.label}
                        onChange={(e) =>
                          void handleUpdateItemInline(item.id, { label: e.target.value })
                        }
                        placeholder="Nome do item"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:border-slate-800"
                      />

                      <div className="flex flex-wrap items-center gap-3 pt-0.5">
                        {!isTip && (
                          <div className="flex items-center gap-2">
                            <label className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-[11px] font-semibold text-slate-700 cursor-pointer transition-colors">
                              <Upload className="w-3 h-3 text-slate-500" />
                              <span>Alterar Imagem</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  void handleUploadPrizeImage(item.id, e.target.files?.[0]);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                            {isCustomImg && defaultImg && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleUpdateItemInline(item.id, { imageUrl: defaultImg })
                                }
                                className="text-[11px] text-slate-500 hover:text-slate-900 underline cursor-pointer"
                              >
                                Restaurar padrão
                              </button>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-1.5" title="Cor da fatia na roleta">
                          {BADGE_COLORS.map((c) => {
                            const selected = item.color.toLowerCase() === c.hex.toLowerCase();
                            return (
                              <button
                                key={c.hex}
                                type="button"
                                aria-label={`Cor ${c.label}`}
                                title={c.label}
                                onClick={() =>
                                  void handleUpdateItemInline(item.id, { color: c.hex })
                                }
                                className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                                  selected
                                    ? 'border-slate-900 scale-115 ring-2 ring-slate-900/20'
                                    : 'border-white hover:scale-110'
                                }`}
                                style={{ backgroundColor: c.hex }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between md:justify-end gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-200">
                    <span className="text-xs font-semibold text-slate-600">
                      {isTip
                        ? `Peso / Chances (${activeFactory}):`
                        : `Estoque (${activeFactory}):`}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleUpdateStock(item.id, stockVal - 1)}
                        className="p-1.5 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-700 cursor-pointer"
                        aria-label="Diminuir"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        min={0}
                        value={inputDisplay}
                        onChange={(e) => handleStockInputChange(item.id, e.target.value)}
                        onBlur={() => handleStockInputBlur(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleStockInputBlur(item.id);
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-16 text-center font-mono font-bold text-xs px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 tabular-nums focus:outline-none focus:border-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => handleUpdateStock(item.id, stockVal + 1)}
                        className="p-1.5 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-700 cursor-pointer"
                        aria-label="Aumentar"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteWheelItem(item.id)}
                        className="ml-1 p-1.5 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 text-rose-700 cursor-pointer"
                        aria-label={`Excluir ${item.label}`}
                        title="Excluir fatia"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Wheel Item Modal */}
        {itemModal.open && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-xl space-y-4">
              <h3 className="font-display text-lg font-bold text-slate-900">
                {itemModal.editingId ? 'Editar fatia da roleta' : 'Nova fatia da roleta'}
              </h3>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Nome exibido</label>
                <input
                  type="text"
                  value={itemModal.label}
                  onChange={(e) => setItemModal((m) => ({ ...m, label: e.target.value }))}
                  placeholder="Ex.: Mochila Executiva"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">Tipo</label>
                  <select
                    value={itemModal.outcomeType}
                    onChange={(e) =>
                      setItemModal((m) => ({ ...m, outcomeType: e.target.value as OutcomeType }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="prize">Brinde</option>
                    <option value="dica">Dica de Segurança</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">Peso (chance)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={itemModal.weight}
                    onChange={(e) =>
                      setItemModal((m) => ({ ...m, weight: Math.max(1, Number(e.target.value)) }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Cor da fatia</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={itemModal.color}
                    onChange={(e) => setItemModal((m) => ({ ...m, color: e.target.value }))}
                    className="w-12 h-9 rounded border border-slate-300 cursor-pointer"
                  />
                  <span className="font-mono text-xs text-slate-600">{itemModal.color}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setItemModal((m) => ({ ...m, open: false }))}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveWheelItem()}
                  className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold cursor-pointer"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Reset Roulette */}
        {confirmResetRoulette && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 max-w-sm w-full p-6 shadow-xl space-y-4">
              <h3 className="font-display text-lg font-bold text-slate-900">
                Restaurar roleta padrão?
              </h3>
              <p className="text-sm text-slate-600">
                As fatias, estoques e perguntas padrão serão restaurados. O histórico de participações será preservado.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmResetRoulette(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmResetRoulette(false);
                    void onResetRoulette();
                  }}
                  className="px-4 py-2 rounded-lg bg-sky-700 text-white text-sm font-semibold cursor-pointer"
                >
                  Restaurar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === 'quiz') {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Banco de Perguntas — Quiz de Cibersegurança
            </h2>
            <p className="text-sm text-slate-600">
              Perguntas sorteadas automaticamente antes do giro da roleta quando o modo Quiz estiver ativo.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setQuizModal({
                open: true,
                editingId: null,
                question: '',
                opt0: '',
                opt1: '',
                opt2: '',
                correctIndex: 0,
                explanation: '',
              })
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nova pergunta</span>
          </button>
        </div>

        <div className="space-y-3">
          {quizQuestions.map((q, idx) => (
            <div
              key={q.id}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold text-sm text-slate-900">
                  {idx + 1}. {q.question}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setQuizModal({
                        open: true,
                        editingId: q.id,
                        question: q.question,
                        opt0: q.options[0] || '',
                        opt1: q.options[1] || '',
                        opt2: q.options[2] || '',
                        correctIndex: q.correctIndex,
                        explanation: q.explanation,
                      })
                    }
                    className="px-2.5 py-1 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteQuiz(q.id)}
                    className="px-2.5 py-1 rounded border border-rose-200 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer"
                  >
                    Excluir
                  </button>
                </div>
              </div>
              <ul className="space-y-1 text-xs text-slate-600 pl-1">
                {q.options.map((opt, oi) => (
                  <li
                    key={oi}
                    className={oi === q.correctIndex ? 'font-bold text-emerald-800' : ''}
                  >
                    {String.fromCharCode(65 + oi)}) {opt}{' '}
                    {oi === q.correctIndex ? '(Correta)' : ''}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500">{q.explanation}</p>
            </div>
          ))}
        </div>

        {quizModal.open && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto">
              <h3 className="font-display text-lg font-bold text-slate-900">
                {quizModal.editingId ? 'Editar pergunta' : 'Nova pergunta do quiz'}
              </h3>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">Pergunta</label>
                <textarea
                  rows={2}
                  value={quizModal.question}
                  onChange={(e) => setQuizModal((m) => ({ ...m, question: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              {(['opt0', 'opt1', 'opt2'] as const).map((field, idx) => (
                <div key={field} className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    Alternativa {String.fromCharCode(65 + idx)}
                  </label>
                  <input
                    type="text"
                    value={quizModal[field]}
                    onChange={(e) => setQuizModal((m) => ({ ...m, [field]: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              ))}

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">Resposta correta</label>
                <select
                  value={quizModal.correctIndex}
                  onChange={(e) =>
                    setQuizModal((m) => ({ ...m, correctIndex: Number(e.target.value) }))
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value={0}>Alternativa A</option>
                  <option value={1}>Alternativa B</option>
                  <option value={2}>Alternativa C</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">Explicação</label>
                <textarea
                  rows={2}
                  value={quizModal.explanation}
                  onChange={(e) => setQuizModal((m) => ({ ...m, explanation: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setQuizModal((m) => ({ ...m, open: false }))}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveQuizQuestion()}
                  className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold cursor-pointer"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  // mode === 'history'
  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Participações por Unidade
            </h2>
            <p className="text-sm text-slate-600 tabular-nums">
              Total registrado: <strong>{participations.length}</strong> giro(s)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={participations.length === 0}
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar CSV</span>
            </button>
            <button
              type="button"
              disabled={participations.length === 0}
              onClick={() => setConfirmClearHistory(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-800 disabled:opacity-40 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpar histórico</span>
            </button>
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="factory" tick={{ fontSize: 12, fill: '#475569' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#475569' }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Brindes" fill="#0284c7" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Dicas" fill="#059669" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-base font-bold text-slate-900">
            Registro detalhado de giros
          </h3>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar por matrícula, unidade ou prêmio..."
            className="w-full sm:w-72 px-3 py-2 rounded-lg border border-slate-300 text-xs"
          />
        </div>

        {filteredParticipations.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">
            Nenhuma participação registrada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2.5 pr-3 font-semibold">Data/Hora</th>
                  <th className="py-2.5 px-3 font-semibold">Unidade</th>
                  <th className="py-2.5 px-3 font-semibold">Matrícula</th>
                  <th className="py-2.5 px-3 font-semibold">Tipo</th>
                  <th className="py-2.5 pl-3 font-semibold">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredParticipations.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 pr-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {new Date(p.timestamp).toLocaleString('pt-BR')}
                    </td>
                    <td className="py-2.5 px-3 text-xs font-medium text-slate-900">{p.factory}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-slate-700 tabular-nums">
                      {p.registrationNumber}
                    </td>
                    <td className="py-2.5 px-3 text-xs">
                      <span
                        className={`font-semibold ${
                          p.outcomeType === 'prize' ? 'text-sky-700' : 'text-emerald-700'
                        }`}
                      >
                        {p.outcomeType === 'prize' ? 'Brinde' : 'Dica'}
                      </span>
                    </td>
                    <td className="py-2.5 pl-3 text-xs font-semibold text-slate-900">
                      {p.prizeName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmClearHistory && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Limpar histórico de giros?
            </h3>
            <p className="text-sm text-slate-600">
              Todos os registros de participações da roleta serão apagados permanentemente.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClearHistory(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmClearHistory(false);
                  void onClearHistory();
                }}
                className="px-4 py-2 rounded-lg bg-rose-700 text-white text-sm font-semibold cursor-pointer"
              >
                Limpar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
