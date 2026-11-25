import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type {
  ClassificationType,
  QuizQuestion,
  RegionPoint,
  RouletteData,
  RouletteSettings,
  Scene,
} from '../types/gincana.ts';
import {
  deleteUploadedFile,
  exportProjectBundle,
  importProjectBundle,
  optimizeAndUploadImage,
  uid,
} from '../utils/storage.ts';
import { CLASSIFICATION_META, ClassificationBadge } from './ClassificationBadge.tsx';
import { RouletteAdminPanel } from './RouletteAdminPanel.tsx';
import { SceneStageFrame } from './SceneStageFrame.tsx';

interface AdminViewProps {
  scenes: Scene[];
  rouletteData: RouletteData;
  syncingRemote: boolean;
  onReloadRemote: () => Promise<void>;
  onPushAllRemote: () => Promise<void>;
  onChangeScenes: (next: Scene[]) => Promise<void>;
  onResetDefaults: (preserveCustom: boolean) => Promise<void>;
  onSaveRouletteSettings: (settings: RouletteSettings, quizQuestions: QuizQuestion[]) => Promise<void>;
  onSaveRouletteStocks: (stocks: Record<string, Record<string, number>>) => Promise<void>;
  onClearRouletteHistory: () => Promise<void>;
  onResetRoulette: () => Promise<void>;
  onFinishAdmin: () => void;
  onShowToast: (msg: string, tone?: 'info' | 'success' | 'warn') => void;
}

type DragAction =
  | {
      kind: 'draw';
      pointerId: number;
      rect: DOMRect;
      startX: number;
      startY: number;
      curX: number;
      curY: number;
    }
  | {
      kind: 'move';
      pointerId: number;
      rect: DOMRect;
      regionIdx: number;
      offsetX: number;
      offsetY: number;
      orig: RegionPoint;
    }
  | {
      kind: 'resize';
      pointerId: number;
      rect: DOMRect;
      regionIdx: number;
      orig: RegionPoint;
    };

export function AdminView({
  scenes,
  rouletteData,
  syncingRemote,
  onReloadRemote,
  onPushAllRemote,
  onChangeScenes,
  onResetDefaults,
  onSaveRouletteSettings,
  onSaveRouletteStocks,
  onClearRouletteHistory,
  onResetRoulette,
  onFinishAdmin,
  onShowToast,
}: AdminViewProps) {
  const [adminTab, setAdminTab] = useState<'scenes' | 'wheel' | 'quiz' | 'history'>('scenes');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedRegionIdx, setSelectedRegionIdx] = useState<number | null>(null);
  const [uploadState, setUploadState] = useState<{ active: boolean; pct: number; text: string }>({
    active: false,
    pct: 0,
    text: '',
  });
  const [drag, setDrag] = useState<DragAction | null>(null);

  // Rename state
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // Region Modal state
  const [regionModal, setRegionModal] = useState<{
    open: boolean;
    editingIdx: number | null;
    box: { x: number; y: number; w: number; h: number };
    type: ClassificationType;
    desc: string;
    explain: string;
  }>({
    open: false,
    editingIdx: null,
    box: { x: 10, y: 10, w: 15, h: 15 },
    type: 'publica',
    desc: '',
    explain: '',
  });

  // Confirmation modals
  const [confirmDeleteScene, setConfirmDeleteScene] = useState(false);
  const [confirmDeleteRegionIdx, setConfirmDeleteRegionIdx] = useState<number | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const safeIdx = Math.max(0, Math.min(currentIdx, Math.max(0, scenes.length - 1)));
  const currentScene = scenes[safeIdx];

  const getRelPoint = (clientX: number, clientY: number, rect: DOMRect) => ({
    x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
    y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
  });

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploadState({ active: true, pct: 0, text: `Preparando ${list.length} imagem(ns)...` });

    const nextScenes = [...scenes];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      try {
        const id = uid('scene');
        setUploadState({
          active: true,
          pct: Math.round(((i + 0.3) / list.length) * 100),
          text: `Otimizando e salvando ${i + 1} de ${list.length}: ${file.name}`,
        });
        const uploaded = await optimizeAndUploadImage(file, id);
        nextScenes.push({
          id,
          name: file.name.replace(/\.[^.]+$/, ''),
          imageUrl: uploaded.imageUrl,
          thumbUrl: uploaded.thumbUrl,
          naturalWidth: uploaded.naturalWidth,
          naturalHeight: uploaded.naturalHeight,
          hideLegendPct: 0,
          isBuiltin: false,
          points: [],
        });
      } catch (err) {
        console.error(err);
        onShowToast(`Não foi possível processar ${file.name}.`, 'warn');
      }
    }

    await onChangeScenes(nextScenes);
    setCurrentIdx(Math.max(0, nextScenes.length - 1));
    setUploadState({
      active: false,
      pct: 100,
      text: `${list.length} imagem(ns) otimizada(s) e salva(s) no servidor.`,
    });
    onShowToast(`${list.length} imagem(ns) adicionada(s) com sucesso.`, 'success');
  };

  const handlePointerDownStage = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !stageRef.current || !currentScene) return;
    if ((e.target as HTMLElement).closest('[data-region-box]')) return;
    e.preventDefault();
    const rect = stageRef.current.getBoundingClientRect();
    const pt = getRelPoint(e.clientX, e.clientY, rect);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelectedRegionIdx(null);
    setDrag({
      kind: 'draw',
      pointerId: e.pointerId,
      rect,
      startX: pt.x,
      startY: pt.y,
      curX: pt.x,
      curY: pt.y,
    });
  };

  const handlePointerMoveStage = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId || !currentScene) return;
    e.preventDefault();
    const pt = getRelPoint(e.clientX, e.clientY, drag.rect);

    if (drag.kind === 'draw') {
      setDrag({ ...drag, curX: pt.x, curY: pt.y });
      return;
    }

    if (drag.kind === 'move') {
      const newX = Math.max(0, Math.min(100 - drag.orig.w, pt.x - drag.offsetX));
      const newY = Math.max(0, Math.min(100 - drag.orig.h, pt.y - drag.offsetY));
      const updated = scenes.map((s, si) =>
        si !== safeIdx
          ? s
          : {
              ...s,
              points: s.points.map((p, pi) =>
                pi === drag.regionIdx
                  ? { ...p, x: Number(newX.toFixed(2)), y: Number(newY.toFixed(2)) }
                  : p,
              ),
            },
      );
      void onChangeScenes(updated);
      return;
    }

    if (drag.kind === 'resize') {
      const newW = Math.max(3, Math.min(100 - drag.orig.x, pt.x - drag.orig.x));
      const newH = Math.max(3, Math.min(100 - drag.orig.y, pt.y - drag.orig.y));
      const updated = scenes.map((s, si) =>
        si !== safeIdx
          ? s
          : {
              ...s,
              points: s.points.map((p, pi) =>
                pi === drag.regionIdx
                  ? { ...p, w: Number(newW.toFixed(2)), h: Number(newH.toFixed(2)) }
                  : p,
              ),
            },
      );
      void onChangeScenes(updated);
    }
  };

  const handlePointerUpStage = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.kind === 'draw') {
      const w = Math.abs(drag.curX - drag.startX);
      const h = Math.abs(drag.curY - drag.startY);
      const pxW = (w * drag.rect.width) / 100;
      const pxH = (h * drag.rect.height) / 100;
      setDrag(null);
      if (pxW < 12 || pxH < 12) {
        onShowToast('Clique e arraste para desenhar uma região maior.', 'info');
        return;
      }
      setRegionModal({
        open: true,
        editingIdx: null,
        box: {
          x: Number(Math.min(drag.startX, drag.curX).toFixed(2)),
          y: Number(Math.min(drag.startY, drag.curY).toFixed(2)),
          w: Number(w.toFixed(2)),
          h: Number(h.toFixed(2)),
        },
        type: 'publica',
        desc: '',
        explain: '',
      });
      return;
    }
    setDrag(null);
    onShowToast('Posição da região atualizada.', 'success');
  };

  const openEditRegion = (idx: number) => {
    if (!currentScene) return;
    const p = currentScene.points[idx];
    if (!p) return;
    setRegionModal({
      open: true,
      editingIdx: idx,
      box: { x: p.x, y: p.y, w: p.w, h: p.h },
      type: p.type,
      desc: p.desc,
      explain: p.explain,
    });
  };

  const saveRegionModal = async () => {
    if (!currentScene) return;
    const desc = regionModal.desc.trim();
    const explain = regionModal.explain.trim();
    if (!desc || !explain) {
      onShowToast('Preencha o nome do elemento e o explicativo.', 'warn');
      return;
    }

    const updatedScenes = scenes.map((sc, si) => {
      if (si !== safeIdx) return sc;
      const nextPoints = [...sc.points];
      if (regionModal.editingIdx === null) {
        nextPoints.push({
          id: uid('pt'),
          ...regionModal.box,
          type: regionModal.type,
          desc,
          explain,
        });
      } else {
        const existing = nextPoints[regionModal.editingIdx];
        nextPoints[regionModal.editingIdx] = {
          ...existing,
          type: regionModal.type,
          desc,
          explain,
        };
      }
      return { ...sc, points: nextPoints };
    });

    await onChangeScenes(updatedScenes);
    setRegionModal((m) => ({ ...m, open: false }));
    onShowToast(
      regionModal.editingIdx === null ? 'Região cadastrada.' : 'Região atualizada.',
      'success',
    );
  };

  const handleDeleteRegion = async (idx: number) => {
    if (!currentScene) return;
    const updatedScenes = scenes.map((sc, si) =>
      si !== safeIdx ? sc : { ...sc, points: sc.points.filter((_, pi) => pi !== idx) },
    );
    await onChangeScenes(updatedScenes);
    setConfirmDeleteRegionIdx(null);
    setSelectedRegionIdx(null);
    onShowToast('Região excluída.', 'info');
  };

  const handleDeleteScene = async () => {
    if (!currentScene) return;
    const removed = currentScene;
    const nextScenes = scenes.filter((_, i) => i !== safeIdx);
    if (!removed.isBuiltin && removed.imageUrl.startsWith('/uploads/')) {
      await deleteUploadedFile(removed.id);
    }
    await onChangeScenes(nextScenes);
    setConfirmDeleteScene(false);
    setCurrentIdx(Math.max(0, safeIdx - 1));
    onShowToast('Imagem excluída do projeto.', 'info');
  };

  const handleSaveRename = async () => {
    if (!currentScene) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    const updated = scenes.map((sc, i) => (i === safeIdx ? { ...sc, name: trimmed } : sc));
    await onChangeScenes(updated);
    setRenaming(false);
    onShowToast('Nome da imagem atualizado.', 'success');
  };

  const handleLegendCropChange = async (pct: number) => {
    if (!currentScene) return;
    const clamped = Math.max(0, Math.min(55, pct));
    const updated = scenes.map((sc, i) =>
      i === safeIdx ? { ...sc, hideLegendPct: clamped } : sc,
    );
    await onChangeScenes(updated);
  };

  const handleExport = async () => {
    if (scenes.length === 0) {
      onShowToast('Adicione imagens antes de exportar.', 'warn');
      return;
    }
    onShowToast('Preparando arquivo de exportação...', 'info');
    try {
      const blob = await exportProjectBundle(scenes);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gincana-seguranca-projeto.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      onShowToast('Projeto exportado com sucesso.', 'success');
    } catch (err) {
      console.error(err);
      onShowToast('Falha ao exportar projeto.', 'warn');
    }
  };

  const handleImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const text = await files[0].text();
      setUploadState({ active: true, pct: 10, text: 'Importando projeto...' });
      const imported = await importProjectBundle(text, (cur, tot, name) => {
        setUploadState({
          active: true,
          pct: Math.round((cur / tot) * 100),
          text: `Importando ${cur} de ${tot}: ${name}`,
        });
      });
      await onChangeScenes(imported);
      setCurrentIdx(0);
      setUploadState({ active: false, pct: 100, text: 'Projeto importado com sucesso.' });
      onShowToast(`Projeto importado com ${imported.length} imagem(ns).`, 'success');
    } catch (err) {
      console.error(err);
      setUploadState({ active: false, pct: 0, text: '' });
      onShowToast('Arquivo de projeto inválido.', 'warn');
    }
  };

  const drawPreview =
    drag?.kind === 'draw'
      ? {
          left: Math.min(drag.startX, drag.curX),
          top: Math.min(drag.startY, drag.curY),
          width: Math.abs(drag.curX - drag.startX),
          height: Math.abs(drag.curY - drag.startY),
        }
      : null;

  return (
    <div className="space-y-6">
      {/* Top Admin Header & Sub-navigation */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900">
              Área administrativa
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Gerencie cenários, regiões, estoque da roleta, perguntas do quiz e relatórios de participação.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
              {(
                [
                  { id: 'scenes', label: 'Cenários e Regiões' },
                  { id: 'wheel', label: 'Roleta e Estoque' },
                  { id: 'quiz', label: 'Quiz' },
                  { id: 'history', label: 'Histórico e Gráficos' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setAdminTab(tab.id)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    adminTab === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={syncingRemote}
              onClick={() => void onReloadRemote()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              title="Recarregar dados diretamente do Google Apps Script"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingRemote ? 'animate-spin' : ''}`} />
              <span>{syncingRemote ? 'Sincronizando...' : 'Atualizar da planilha'}</span>
            </button>

            <button
              type="button"
              disabled={syncingRemote}
              onClick={() => void onPushAllRemote()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-sky-300 bg-sky-50 hover:bg-sky-100 text-xs font-semibold text-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              title="Enviar estoque, quiz e cenários atuais para a planilha"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Enviar p/ planilha</span>
            </button>
          </div>
        </div>

        {adminTab === 'scenes' && (
          <>
            <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                As alterações são sincronizadas automaticamente com o Google Apps Script (planilha) com backup local.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0">
                  <Plus className="w-4 h-4" />
                  <span>Adicionar imagens</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    hidden
                    onChange={(e) => {
                      void handleFilesSelected(e.target.files);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>

                <button
                  type="button"
                  onClick={handleExport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exportar JSON</span>
                </button>

                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Importar JSON</span>
                  <input
                    type="file"
                    accept="application/json"
                    hidden
                    onChange={(e) => {
                      void handleImport(e.target.files);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar padrão (5 cenas)</span>
                </button>
              </div>
            </div>

            {(uploadState.active || uploadState.text) && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="text-xs font-medium text-slate-700">{uploadState.text}</div>
                {uploadState.active && (
                  <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-sky-600 transition-all duration-150"
                      style={{ width: `${uploadState.pct}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {adminTab !== 'scenes' ? (
        <RouletteAdminPanel
          mode={adminTab}
          rouletteData={rouletteData}
          onSaveSettings={onSaveRouletteSettings}
          onSaveStocks={onSaveRouletteStocks}
          onClearHistory={onClearRouletteHistory}
          onResetRoulette={onResetRoulette}
          onShowToast={onShowToast}
        />
      ) : currentScene ? (
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
          {/* Scene Selector Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-bold text-slate-900 tabular-nums">
                Imagens do projeto ({scenes.length})
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safeIdx === 0}
                onClick={() => {
                  setCurrentIdx(safeIdx - 1);
                  setSelectedRegionIdx(null);
                  setRenaming(false);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Anterior</span>
              </button>
              <button
                type="button"
                disabled={safeIdx === scenes.length - 1}
                onClick={() => {
                  setCurrentIdx(safeIdx + 1);
                  setSelectedRegionIdx(null);
                  setRenaming(false);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <span>Próxima</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onFinishAdmin}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Finalizar cadastro</span>
              </button>
            </div>
          </div>

          {/* Thumbnails */}
          <div className="flex gap-3 overflow-x-auto pb-2">
            {scenes.map((sc, idx) => {
              const active = idx === safeIdx;
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => {
                    setCurrentIdx(idx);
                    setSelectedRegionIdx(null);
                    setRenaming(false);
                  }}
                  className={`flex-none w-36 rounded-xl border p-2 text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-sky-600 bg-sky-50'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <div className="h-20 w-full rounded-lg overflow-hidden bg-slate-200">
                    <img
                      src={sc.thumbUrl || sc.imageUrl}
                      alt={sc.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover object-top"
                    />
                  </div>
                  <div className="mt-1.5 text-xs font-bold text-slate-900 truncate tabular-nums">
                    {idx + 1}. {sc.name}
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    {sc.points.length} região(ões)
                  </div>
                </button>
              );
            })}
          </div>

          {/* Editor Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_360px] gap-6 items-start">
            <div className="space-y-3">
              <div className="w-full h-[68dvh] max-h-[calc(100dvh-140px)] min-h-[340px]">
                <SceneStageFrame
                  imageUrl={currentScene.imageUrl}
                  alt={currentScene.name}
                  naturalWidth={currentScene.naturalWidth}
                  naturalHeight={currentScene.naturalHeight}
                  applyCrop={false}
                  fillStage={true}
                  uniformAspect={0.72}
                  innerRef={stageRef}
                  onPointerDown={handlePointerDownStage}
                  onPointerMove={handlePointerMoveStage}
                  onPointerUp={handlePointerUpStage}
                  className="cursor-crosshair touch-none"
                >
                {currentScene.points.map((p, idx) => {
                  const meta = CLASSIFICATION_META[p.type];
                  const selected = selectedRegionIdx === idx;
                  return (
                    <div
                      key={p.id}
                      data-region-box
                      onPointerDown={(e) => {
                        if (e.button !== 0 || !stageRef.current) return;
                        e.stopPropagation();
                        e.preventDefault();
                        const rect = stageRef.current.getBoundingClientRect();
                        const pt = getRelPoint(e.clientX, e.clientY, rect);
                        setSelectedRegionIdx(idx);
                        stageRef.current.setPointerCapture?.(e.pointerId);
                        setDrag({
                          kind: 'move',
                          pointerId: e.pointerId,
                          rect,
                          regionIdx: idx,
                          offsetX: pt.x - p.x,
                          offsetY: pt.y - p.y,
                          orig: { ...p },
                        });
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        openEditRegion(idx);
                      }}
                      style={{
                        left: `${p.x}%`,
                        top: `${p.y}%`,
                        width: `${p.w}%`,
                        height: `${p.h}%`,
                      }}
                      className={`absolute rounded-lg border-2 flex items-center justify-center font-display font-bold text-white text-xs shadow-sm cursor-move ${meta.regionBg} ${
                        selected ? 'border-slate-950 ring-2 ring-white z-10' : 'border-white'
                      }`}
                    >
                      <span className="drop-shadow pointer-events-none tabular-nums">{idx + 1}</span>

                      {/* Resize handle */}
                      <button
                        type="button"
                        aria-label={`Redimensionar região ${idx + 1}`}
                        onPointerDown={(e) => {
                          if (!stageRef.current) return;
                          e.stopPropagation();
                          e.preventDefault();
                          const rect = stageRef.current.getBoundingClientRect();
                          setSelectedRegionIdx(idx);
                          stageRef.current.setPointerCapture?.(e.pointerId);
                          setDrag({
                            kind: 'resize',
                            pointerId: e.pointerId,
                            rect,
                            regionIdx: idx,
                            orig: { ...p },
                          });
                        }}
                        className="absolute -right-1.5 -bottom-1.5 w-4 h-4 rounded-full bg-white border-2 border-slate-900 cursor-nwse-resize shadow"
                      />
                    </div>
                  );
                })}

                {drawPreview && (
                  <div
                    style={{
                      left: `${drawPreview.left}%`,
                      top: `${drawPreview.top}%`,
                      width: `${drawPreview.width}%`,
                      height: `${drawPreview.height}%`,
                    }}
                    className="absolute border-2 border-dashed border-white bg-sky-600/40 rounded-lg pointer-events-none"
                  />
                )}

                {/* Visual guide line showing where bottom legend gets hidden in Game View */}
                {(currentScene.hideLegendPct ?? 0) > 0 && (
                  <div
                    style={{ top: `${100 - (currentScene.hideLegendPct ?? 0)}%` }}
                    className="absolute inset-x-0 bottom-0 bg-slate-950/55 border-t-2 border-dashed border-amber-400 pointer-events-none flex items-start justify-center pt-2"
                  >
                    <span className="px-2 py-0.5 rounded bg-slate-900/90 text-amber-300 text-[11px] font-semibold">
                      Área oculta no jogo (gabarito)
                    </span>
                  </div>
                )}
                </SceneStageFrame>
              </div>

              <p className="text-xs text-slate-500">
                Clique e arraste no fundo para criar uma nova região. Arraste uma região existente para mover, use o ponto no canto inferior direito para redimensionar, ou dê duplo clique para editar o texto.
              </p>
            </div>

            {/* Right Sidebar Inspector */}
            <aside className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
              <div className="space-y-2 pb-4 border-b border-slate-200">
                {renaming ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveRename();
                        if (e.key === 'Escape') setRenaming(false);
                      }}
                      className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 bg-white"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveRename()}
                      className="px-3 py-1.5 rounded-lg bg-sky-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      Salvar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display font-bold text-sm text-slate-900 truncate">
                      {currentScene.name}
                    </h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setRenameValue(currentScene.name);
                          setRenaming(true);
                        }}
                        className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 cursor-pointer"
                        title="Renomear imagem"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteScene(true)}
                        className="p-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 cursor-pointer"
                        title="Excluir imagem"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-2 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="legend-crop" className="font-medium text-slate-700">
                      Ocultar rodapé no jogo
                    </label>
                    <span className="font-mono text-slate-600 tabular-nums">
                      {currentScene.hideLegendPct ?? 0}%
                    </span>
                  </div>
                  <input
                    id="legend-crop"
                    type="range"
                    min={0}
                    max={45}
                    step={1}
                    value={currentScene.hideLegendPct ?? 0}
                    onChange={(e) => void handleLegendCropChange(Number(e.target.value))}
                    className="w-full accent-sky-700 cursor-pointer"
                  />
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-700 tabular-nums">
                    Regiões cadastradas ({currentScene.points.length})
                  </h4>
                </div>

                {currentScene.points.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    Nenhuma região cadastrada ainda. Desenhe um retângulo na imagem ao lado.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                    {currentScene.points.map((p, idx) => (
                      <div
                        key={p.id}
                        onClick={() => setSelectedRegionIdx(idx)}
                        className={`rounded-lg border p-3 bg-white space-y-1.5 transition-colors cursor-pointer ${
                          selectedRegionIdx === idx ? 'border-sky-500 ring-1 ring-sky-200' : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-bold text-slate-500 tabular-nums">
                              {idx + 1}.
                            </span>
                            <ClassificationBadge type={p.type} compact />
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditRegion(idx);
                              }}
                              className="px-2 py-1 rounded border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteRegionIdx(idx);
                              }}
                              className="px-2 py-1 rounded border border-rose-200 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer"
                            >
                              Excluir
                            </button>
                          </div>
                        </div>
                        <div className="text-xs font-semibold text-slate-900">{p.desc}</div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">{p.explain}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </section>
      ) : (
        <section className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-4">
          <h2 className="font-display text-lg font-bold text-slate-900">
            Nenhuma imagem no projeto
          </h2>
          <p className="text-sm text-slate-600">
            Adicione imagens do seu computador ou restaure os 5 cenários padrão embutidos no aplicativo.
          </p>
          <button
            type="button"
            onClick={() => void onResetDefaults(false)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-700 text-white text-sm font-semibold cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Restaurar 5 cenários padrão</span>
          </button>
        </section>
      )}

      {/* Create / Edit Region Modal */}
      {regionModal.open && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 shadow-xl space-y-4">
            <h3 className="font-display text-lg font-bold text-slate-900">
              {regionModal.editingIdx === null ? 'Cadastrar região' : 'Editar região'}
            </h3>

            <div className="space-y-1.5">
              <label htmlFor="region-type" className="block text-xs font-bold text-slate-700">
                Classificação
              </label>
              <select
                id="region-type"
                value={regionModal.type}
                onChange={(e) =>
                  setRegionModal((m) => ({ ...m, type: e.target.value as ClassificationType }))
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="publica">Informação pública (Verde)</option>
                <option value="interna">Informação interna (Amarela)</option>
                <option value="confidencial">Informação confidencial (Vermelha)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="region-desc" className="block text-xs font-bold text-slate-700">
                Nome do elemento
              </label>
              <input
                id="region-desc"
                type="text"
                value={regionModal.desc}
                onChange={(e) => setRegionModal((m) => ({ ...m, desc: e.target.value }))}
                placeholder="Ex.: Caderno com senha da rede"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="region-explain" className="block text-xs font-bold text-slate-700">
                Explicativo para o resultado final
              </label>
              <textarea
                id="region-explain"
                rows={3}
                value={regionModal.explain}
                onChange={(e) => setRegionModal((m) => ({ ...m, explain: e.target.value }))}
                placeholder="Explique por que a informação pertence a esta classificação."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRegionModal((m) => ({ ...m, open: false }))}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void saveRegionModal()}
                className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold cursor-pointer"
              >
                Salvar região
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Region Confirm Modal */}
      {confirmDeleteRegionIdx !== null && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="font-display text-lg font-bold text-slate-900">Excluir região?</h3>
            <p className="text-sm text-slate-600">
              Esta região será removida da imagem atual imediatamente.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteRegionIdx(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteRegion(confirmDeleteRegionIdx)}
                className="px-4 py-2 rounded-lg bg-rose-700 text-white text-sm font-semibold cursor-pointer"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Scene Confirm Modal */}
      {confirmDeleteScene && currentScene && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="font-display text-lg font-bold text-slate-900">Excluir imagem?</h3>
            <p className="text-sm text-slate-600">
              A imagem <strong>{currentScene.name}</strong> e todas as suas regiões serão removidas do projeto ativo.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteScene(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteScene()}
                className="px-4 py-2 rounded-lg bg-rose-700 text-white text-sm font-semibold cursor-pointer"
              >
                Excluir imagem
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Default Scenes Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Restaurar cenários padrão
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              As 5 imagens originais e suas regiões pré-cadastradas estão embutidas no código. Como deseja restaurá-las?
            </p>
            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowResetModal(false);
                  void onResetDefaults(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold cursor-pointer"
              >
                Restaurar 5 padrões e manter minhas imagens extras
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResetModal(false);
                  setCurrentIdx(0);
                  void onResetDefaults(false);
                }}
                className="px-4 py-2.5 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 text-sm font-semibold cursor-pointer"
              >
                Resetar projeto completo para os 5 padrões
              </button>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
