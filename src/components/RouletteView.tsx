import confetti from 'canvas-confetti';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Award,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Gift,
  HelpCircle,
  ImageOff,
  Lightbulb,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FACTORIES, pickNonRepeatingTip } from '../data/defaultRoulette.ts';
import type {
  Participation,
  QuizQuestion,
  RouletteData,
  WheelItem,
} from '../types/gincana.ts';
import { playTone } from '../utils/sound.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

const ACTIVE_FACTORY_KEY = 'cyber_roleta_active_factory_v5';

interface WeightedSlice {
  item: WheelItem;
  weight: number;
}

interface PlacedSlice extends WeightedSlice {
  startAngle: number;
  endAngle: number;
  arcSize: number;
}

interface RouletteViewProps {
  rouletteData: RouletteData;
  roundMode: boolean;
  roundNumber?: number;
  remainingRegions?: number;
  pendingReset?: boolean;
  muted: boolean;
  needsGoogleAuth?: boolean;
  isGoogleSigningIn?: boolean;
  onGoogleSignIn?: () => Promise<void>;
  onSpinComplete: (
    payload: Omit<Participation, 'id' | 'timestamp'>,
  ) => Promise<{ ok: boolean; error?: string; record?: Participation }>;
  onFinishRoundNextPlayer?: () => void;
  onBackToGame?: () => void;
  onShowToast: (msg: string, tone?: 'info' | 'success' | 'warn') => void;
}

function wrapWheelText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = text.trim().split(/\s+/);
  if (words.length <= 1) return [text];
  let bestSplit = 1;
  let minMaxWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' ');
    const l2 = words.slice(i).join(' ');
    const worst = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width);
    if (worst < minMaxWidth) {
      minMaxWidth = worst;
      bestSplit = i;
    }
  }
  return [words.slice(0, bestSplit).join(' '), words.slice(bestSplit).join(' ')];
}

function fitWheelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  arcSize: number,
  innerRadius: number,
): { lines: string[]; fontSize: number; lineHeight: number } {
  const chordSpace = 2 * (innerRadius + 28) * Math.sin(Math.min(arcSize, Math.PI * 0.85) / 2);
  for (let size = 16; size >= 9; --size) {
    ctx.font = `700 ${size}px Outfit, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth && size + 6 <= chordSpace) {
      return { lines: [text], fontSize: size, lineHeight: size * 1.15 };
    }
    const lines = wrapWheelText(ctx, text, maxWidth);
    const fitsWidth = lines.every((line) => ctx.measureText(line).width <= maxWidth);
    const totalH = lines.length * (size * 1.15);
    if (fitsWidth && totalH <= chordSpace * 1.15) {
      return { lines, fontSize: size, lineHeight: size * 1.15 };
    }
  }
  ctx.font = '700 9px Outfit, sans-serif';
  return { lines: wrapWheelText(ctx, text, maxWidth), fontSize: 9, lineHeight: 10.5 };
}

function pickWeightedFromCandidates(
  candidates: Array<{ slice: PlacedSlice; idx: number }>,
): number {
  const totalWeight = candidates.reduce((sum, entry) => sum + entry.slice.weight, 0);
  if (totalWeight <= 0) return candidates[0].idx;
  let r = Math.random() * totalWeight;
  for (const { slice, idx } of candidates) {
    r -= slice.weight;
    if (r <= 0) return idx;
  }
  return candidates[candidates.length - 1].idx;
}

function isDicaItem(item: WheelItem): boolean {
  return item.outcomeType === 'dica' || item.id === 'dica';
}

function isDescansoItem(item: WheelItem): boolean {
  return item.id === 'descanso_copo' || item.label.toLowerCase().includes('descanso');
}

function pickSmartWeightedSlice(
  slices: PlacedSlice[],
  recentPrizeIds: string[],
  nextSpinNumber: number,
): number {
  const active = slices
    .map((slice, idx) => ({ slice, idx }))
    .filter(({ slice }) => slice.weight > 0);
  if (active.length === 0) return -1;
  if (active.length === 1) return active[0].idx;

  const dicaCandidates = active.filter(({ slice }) => isDicaItem(slice.item));
  const descansoCandidates = active.filter(({ slice }) => isDescansoItem(slice.item));
  const otherPrizeCandidates = active.filter(
    ({ slice }) => !isDicaItem(slice.item) && !isDescansoItem(slice.item),
  );

  // Every 7th spin: vary among the other prizes (excluding Dica and Descanso de Copo)
  if (nextSpinNumber % 7 === 0 && otherPrizeCandidates.length > 0) {
    const otherIds = new Set(otherPrizeCandidates.map((c) => c.slice.item.id));
    const lastOtherId = recentPrizeIds.find((id) => otherIds.has(id));
    const variedCandidates =
      otherPrizeCandidates.length >= 2 && lastOtherId
        ? otherPrizeCandidates.filter((c) => c.slice.item.id !== lastOtherId)
        : otherPrizeCandidates;
    return pickWeightedFromCandidates(variedCandidates);
  }

  // Every 3rd spin: Descanso de Copo
  if (nextSpinNumber % 3 === 0 && descansoCandidates.length > 0) {
    return pickWeightedFromCandidates(descansoCandidates);
  }

  // Default (every 1 spin): Dica
  if (dicaCandidates.length > 0) {
    return pickWeightedFromCandidates(dicaCandidates);
  }

  // Fallback if scheduled category ran out of stock: weighted by stock, max 4 consecutive repeats
  const lastId = recentPrizeIds[0];
  let consecutiveCount = 0;
  if (lastId) {
    for (const id of recentPrizeIds) {
      if (id === lastId) {
        consecutiveCount++;
      } else {
        break;
      }
    }
  }

  const eligible =
    consecutiveCount >= 4 && active.some(({ slice }) => slice.item.id !== lastId)
      ? active.filter(({ slice }) => slice.item.id !== lastId)
      : active;

  return pickWeightedFromCandidates(eligible);
}

function PrizeThumb({ imageUrl, name }: { imageUrl?: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!imageUrl || broken) {
    return (
      <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
        <ImageOff className="w-4 h-4 text-slate-400" />
      </div>
    );
  }
  return (
    <img
      src={imageUrl}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="w-10 h-10 rounded-lg object-contain p-1 border border-slate-200 bg-white shrink-0"
    />
  );
}

export function RouletteView({
  rouletteData,
  roundMode,
  roundNumber = 1,
  remainingRegions = 0,
  pendingReset = false,
  muted,
  needsGoogleAuth = false,
  isGoogleSigningIn = false,
  onGoogleSignIn,
  onSpinComplete,
  onFinishRoundNextPlayer,
  onBackToGame,
  onShowToast,
}: RouletteViewProps) {
  const { settings, participations, quizQuestions } = rouletteData;
  const factories =
    settings.factories.length > 0 ? settings.factories : DEFAULT_FACTORIES;

  const [factory, setFactory] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_FACTORY_KEY);
      if (saved && factories.includes(saved)) return saved;
    } catch {
      // ignore
    }
    return factories[0];
  });

  const [step, setStep] = useState<'REGISTRATION' | 'ROULETTE' | 'RESULT'>('REGISTRATION');
  const [registration, setRegistration] = useState('');
  const [regError, setRegError] = useState('');

  // Optional Quiz state
  const [quizIndex, setQuizIndex] = useState<number>(() =>
    quizQuestions.length > 0 ? Math.floor(Math.random() * quizQuestions.length) : 0,
  );
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // Wheel & spin state
  const [spinning, setSpinning] = useState(false);
  const [spinFinished, setSpinFinished] = useState(false);
  const [pointerTilt, setPointerTilt] = useState(0);
  const [resultRecord, setResultRecord] = useState<Participation | null>(null);
  const [resultItem, setResultItem] = useState<WheelItem | null>(null);
  const [resultImgBroken, setResultImgBroken] = useState(false);
  const [showMobilePrizes, setShowMobilePrizes] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const animRef = useRef<number | null>(null);
  const lastTickRef = useRef(-1);

  useEffect(() => {
    if (!factories.includes(factory)) {
      setFactory(factories[0]);
    }
  }, [factories, factory]);

  const handleSelectFactory = (nextFactory: string) => {
    playTone('click', muted);
    setFactory(nextFactory);
    try {
      localStorage.setItem(ACTIVE_FACTORY_KEY, nextFactory);
    } catch {
      // ignore
    }
  };

  const currentQuestion: QuizQuestion | null =
    settings.quizEnabled && quizQuestions.length > 0
      ? quizQuestions[quizIndex % quizQuestions.length]
      : null;

  const factoryStock = settings.stocks[factory] || {};

  // Weighted slices: keep all configured items visible on the wheel; probability is directly proportional to stockQty
  const weightedItems: WeightedSlice[] = useMemo(
    () =>
      settings.items.map((item) => {
        const stockQty = Math.max(0, Number(factoryStock[item.id] ?? 0));
        return { item, weight: stockQty };
      }),
    [factoryStock, settings.items],
  );

  const placedSlices: PlacedSlice[] = useMemo(() => {
    if (weightedItems.length === 0) return [];
    const arcSize = (2 * Math.PI) / weightedItems.length;
    return weightedItems.map((entry, idx) => ({
      ...entry,
      startAngle: idx * arcSize,
      endAngle: (idx + 1) * arcSize,
      arcSize,
    }));
  }, [weightedItems]);

  const factoryParticipations = useMemo(
    () =>
      participations
        .filter((p) => p.factory === factory)
        .slice()
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)),
    [factory, participations],
  );

  const nextSpinNumber = factoryParticipations.length + 1;

  const recentPrizeIds = useMemo(
    () =>
      factoryParticipations
        .filter((p) => Boolean(p.prizeId))
        .map((p) => p.prizeId),
    [factoryParticipations],
  );

  const fireResultConfetti = useCallback((isTip: boolean) => {
    const colors = isTip
      ? ['#f59e0b', '#fbbf24', '#fef08a', '#ffffff']
      : ['#dc2626', '#10b981', '#3b82f6', '#fef08a', '#ffffff'];
    void confetti({
      particleCount: 80,
      spread: 80,
      origin: { x: 0.5, y: 0.55 },
      colors,
      disableForReducedMotion: true,
    });
    setTimeout(() => {
      void confetti({
        particleCount: 45,
        angle: 60,
        spread: 60,
        origin: { x: 0.1, y: 0.75 },
        colors,
        disableForReducedMotion: true,
      });
    }, 150);
    setTimeout(() => {
      void confetti({
        particleCount: 45,
        angle: 120,
        spread: 60,
        origin: { x: 0.9, y: 0.75 },
        colors,
        disableForReducedMotion: true,
      });
    }, 300);
  }, []);

  const drawWheel = useCallback(
    (angle: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== 560 * dpr || canvas.height !== 560 * dpr) {
        canvas.width = 560 * dpr;
        canvas.height = 560 * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, 560, 560);

      if (placedSlices.length === 0) {
        ctx.restore();
        return;
      }

      // Outer white/dark ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(280, 280, 269, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();
      ctx.restore();

      // Slices + Outfit text
      placedSlices.forEach((slice) => {
        const start = angle + slice.startAngle;
        const end = angle + slice.endAngle;
        const mid = start + slice.arcSize / 2;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(280, 280);
        ctx.arc(280, 280, 260, start, end);
        ctx.closePath();
        ctx.fillStyle = slice.item.color;
        ctx.fill();

        if (placedSlices.length > 1) {
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.stroke();
        }

        if (slice.arcSize >= 0.14) {
          const { lines, fontSize, lineHeight } = fitWheelText(
            ctx,
            slice.item.label,
            192,
            slice.arcSize,
            50,
          );
          const flip = Math.cos(mid) < 0;
          ctx.save();
          ctx.translate(280, 280);
          ctx.rotate(flip ? mid + Math.PI : mid);
          ctx.fillStyle = '#ffffff';
          ctx.font = `700 ${fontSize}px Outfit, sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
          ctx.shadowBlur = 4;
          ctx.textAlign = 'center';
          const radialPos = flip ? -146 : 146;
          const startY = -((lines.length - 1) * lineHeight) / 2;
          lines.forEach((line, i) => {
            ctx.fillText(line, radialPos, startY + i * lineHeight);
          });
          ctx.restore();
        }
        ctx.restore();
      });

      // 20 white rim dots
      for (let i = 0; i < 20; i++) {
        const a = angle + (i * 2 * Math.PI) / 20;
        const dx = 280 + Math.cos(a) * 264.5;
        const dy = 280 + Math.sin(a) * 264.5;
        ctx.save();
        ctx.beginPath();
        ctx.arc(dx, dy, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
        ctx.shadowBlur = 3;
        ctx.fill();
        ctx.restore();
      }

      // Center GIRAR hub
      ctx.save();
      ctx.beginPath();
      ctx.arc(280, 280, 34, 0, 2 * Math.PI);
      const grad = ctx.createRadialGradient(280, 280, 4, 280, 280, 34);
      grad.addColorStop(0, '#334155');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GIRAR', 280, 280);
      ctx.restore();

      ctx.restore();
    },
    [placedSlices],
  );

  useEffect(() => {
    if (step === 'ROULETTE') {
      drawWheel(angleRef.current);
    }
  }, [drawWheel, step]);

  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const handleSubmitRegistration = (e: React.FormEvent) => {
    e.preventDefault();
    const reg = registration.trim();
    if (!reg) {
      playTone('miss', muted);
      setRegError('Por favor, informe o seu registro.');
      return;
    }

    if (!settings.allowDuplicateRegistration) {
      const normalized = reg.toLowerCase();
      const duplicate = participations.find(
        (p) => p.registrationNumber?.trim().toLowerCase() === normalized,
      );
      if (duplicate) {
        playTone('miss', muted);
        setRegError(
          `Este registro já participou do sorteio (${duplicate.factory}). Não é permitido registrar o mesmo código duas vezes.`,
        );
        return;
      }
    }

    if (settings.quizEnabled && currentQuestion && !quizSubmitted) {
      playTone('miss', muted);
      setRegError('Responda ao quiz de cibersegurança antes de prosseguir para a roleta.');
      return;
    }

    playTone('click', muted);
    setRegError('');
    setSpinFinished(false);
    setResultRecord(null);
    setResultItem(null);
    setResultImgBroken(false);
    setStep('ROULETTE');
  };

  const handleSpin = () => {
    if (spinning || spinFinished || placedSlices.length === 0) return;
    playTone('click', muted);
    setSpinning(true);
    setSpinFinished(true);

    const chosenIdx = pickSmartWeightedSlice(placedSlices, recentPrizeIds, nextSpinNumber);
    if (chosenIdx === -1) {
      setSpinning(false);
      setSpinFinished(false);
      return;
    }

    const chosen = placedSlices[chosenIdx];
    const margin = chosen.arcSize * 0.2;
    const targetSliceAngle =
      chosen.startAngle + margin + Math.random() * Math.max(0.01, chosen.arcSize - margin * 2);
    const pointerAngle = -Math.PI / 2;
    const startAngle = angleRef.current;
    const extraTurns = 6 + Math.floor(Math.random() * 3);
    let delta =
      (((pointerAngle - targetSliceAngle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) -
      (((startAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    if (delta <= 0) delta += 2 * Math.PI;
    const endAngle = startAngle + extraTurns * 2 * Math.PI + delta;

    const startTime = performance.now();
    const duration = 5000;

    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      const currentAngle = startAngle + (endAngle - startAngle) * eased;
      angleRef.current = currentAngle;
      drawWheel(currentAngle);

      const rel = (((pointerAngle - currentAngle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const tickIdx = Math.floor(rel / ((2 * Math.PI) / 20));
      if (tickIdx !== lastTickRef.current) {
        lastTickRef.current = tickIdx;
        playTone('tick', muted);
        setPointerTilt(Math.random() > 0.5 ? 8 : -8);
        setTimeout(() => setPointerTilt(0), 65);
      }

      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      setSpinning(false);
      const isTip = chosen.item.outcomeType === 'dica' || chosen.item.id === 'dica';
      fireResultConfetti(isTip);
      playTone('prize', muted);

      setTimeout(() => {
        void finalizeSpinOutcome(chosen.item, isTip);
      }, 850);
    };

    animRef.current = requestAnimationFrame(animate);
  };

  const finalizeSpinOutcome = async (item: WheelItem, isTip: boolean) => {
    try {
      const tipText = isTip ? pickNonRepeatingTip() : undefined;
      const res = await onSpinComplete({
        factory,
        registrationNumber: registration.trim(),
        accentColor: item.color,
        outcomeType: isTip ? 'dica' : 'prize',
        prizeId: item.id,
        prizeName: item.label,
        tipText,
        quizCorrect: currentQuestion ? selectedOption === currentQuestion.correctIndex : undefined,
        roundNumber: roundMode ? roundNumber : undefined,
      });

      if (!res.ok || !res.record) {
        const msg = res.error || 'Erro ao registrar participação.';
        onShowToast(msg, 'warn');
        setSpinFinished(false);
        setStep('REGISTRATION');
        setRegError(msg);
        return;
      }

      setResultItem(item);
      setResultRecord(res.record);
      setStep('RESULT');
    } catch (err) {
      console.error(err);
      const msg = 'Não foi possível registrar sua participação. Tente novamente.';
      onShowToast(msg, 'warn');
      setSpinFinished(false);
      setStep('REGISTRATION');
      setRegError(msg);
    }
  };

  const handleResetToRegistration = () => {
    playTone('click', muted);
    setRegistration('');
    setRegError('');
    setSelectedOption(null);
    setQuizSubmitted(false);
    setResultItem(null);
    setResultRecord(null);
    setSpinFinished(false);
    setResultImgBroken(false);
    if (quizQuestions.length > 0) {
      setQuizIndex((prev) => (prev + 1) % quizQuestions.length);
    }
    setStep('REGISTRATION');
  };

  const totalWeight = weightedItems.reduce((sum, entry) => sum + entry.weight, 0);

  return (
    <div className="flex-1 w-full min-h-0 flex flex-col items-center justify-center gap-2 sm:gap-3 overflow-hidden">
      {needsGoogleAuth && onGoogleSignIn && step === 'REGISTRATION' && (
        <section className="w-full max-w-5xl shrink-0 rounded-xl border border-amber-200 bg-amber-50/90 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-amber-950">
            Conecte sua conta Google para salvar os próximos giros automaticamente no Google Sheets.
          </p>
          <GoogleSignInButton
            onClick={() => void onGoogleSignIn()}
            disabled={isGoogleSigningIn}
            label={isGoogleSigningIn ? 'Conectando...' : 'Sign in with Google'}
          />
        </section>
      )}

      {roundMode && (
        <section className="w-full max-w-5xl shrink-0 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Rodada {roundNumber} concluída · 3 acertos</span>
            </div>
            <span className="hidden sm:inline text-slate-300" aria-hidden="true">·</span>
            <p className="text-xs text-slate-700 truncate">
              {pendingReset
                ? `Restam ${remainingRegions} região(ões). Próxima pessoa inicia um novo ciclo.`
                : `Restam ${remainingRegions} regiões no mapa para a próxima rodada.`}
            </p>
          </div>
          {onBackToGame && step === 'REGISTRATION' && (
            <button
              type="button"
              onClick={onBackToGame}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              Voltar ao cenário
            </button>
          )}
        </section>
      )}

      {/* STEP 1: REGISTRATION */}
      {step === 'REGISTRATION' && (
        <div className="w-full max-w-lg mx-auto flex-1 min-h-0 flex items-center justify-center overflow-y-auto py-1">
          <div className="w-full bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 shadow-sm">
            <div className="text-center mb-5">
              <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-slate-100 text-slate-800 mb-3">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mb-1">
                Identificação
              </h1>
              <p className="text-xs sm:text-sm text-slate-500">
                Confirme a fábrica e digite o seu registro para girar a roleta
              </p>
            </div>

            <form onSubmit={handleSubmitRegistration} className="space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  <Building2 className="w-3.5 h-3.5 text-slate-500" />
                  <span>Fábrica / Unidade</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {factories.map((f) => {
                    const active = factory === f;
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => handleSelectFactory(f)}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer text-left ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                        }`}
                      >
                        <span className="truncate">{f}</span>
                        {active && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-input"
                  className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
                >
                  Registro
                </label>
                <input
                  id="reg-input"
                  type="text"
                  autoFocus
                  value={registration}
                  onChange={(e) => {
                    setRegistration(e.target.value);
                    if (regError) setRegError('');
                  }}
                  placeholder="Digite seu registro..."
                  className={`w-full px-4 py-3 bg-slate-50 border rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 transition-all font-mono text-base ${
                    regError
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-slate-300 focus:border-slate-900 focus:ring-slate-900'
                  }`}
                />
              </div>

              {/* Optional Cybersecurity Quick Quiz when enabled in Admin */}
              {settings.quizEnabled && currentQuestion && (
                <div className="pt-3 border-t border-slate-200 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-sky-800">
                    <HelpCircle className="w-4 h-4" />
                    <span>Quiz rápido de cibersegurança</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 leading-snug">
                    {currentQuestion.question}
                  </p>
                  <div className="space-y-1.5">
                    {currentQuestion.options.map((opt, idx) => {
                      const chosen = selectedOption === idx;
                      const isCorrect = idx === currentQuestion.correctIndex;
                      let cls = 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800';
                      if (quizSubmitted) {
                        if (isCorrect) {
                          cls = 'border-emerald-400 bg-emerald-50 text-emerald-900 font-semibold';
                        } else if (chosen) {
                          cls = 'border-rose-300 bg-rose-50 text-rose-900';
                        }
                      } else if (chosen) {
                        cls = 'border-sky-500 bg-sky-50 text-sky-900 font-semibold';
                      }

                      return (
                        <button
                          key={idx}
                          type="button"
                          disabled={quizSubmitted}
                          onClick={() => setSelectedOption(idx)}
                          className={`w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors cursor-pointer flex items-start gap-2 ${cls}`}
                        >
                          <span className="font-mono font-bold shrink-0">
                            {String.fromCharCode(65 + idx)}.
                          </span>
                          <span>{opt}</span>
                        </button>
                      );
                    })}
                  </div>

                  {!quizSubmitted ? (
                    <button
                      type="button"
                      disabled={selectedOption === null}
                      onClick={() => {
                        setQuizSubmitted(true);
                        setRegError('');
                        playTone(
                          selectedOption === currentQuestion.correctIndex ? 'hit' : 'miss',
                          muted,
                        );
                      }}
                      className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
                    >
                      Confirmar resposta
                    </button>
                  ) : (
                    <div
                      className={`rounded-xl border p-2.5 text-xs space-y-1 ${
                        selectedOption === currentQuestion.correctIndex
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-amber-50 border-amber-200 text-amber-900'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold">
                        {selectedOption === currentQuestion.correctIndex ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                            <span>Resposta correta!</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4 text-amber-700" />
                            <span>Atenção à dica!</span>
                          </>
                        )}
                      </div>
                      <p className="leading-relaxed">{currentQuestion.explanation}</p>
                    </div>
                  )}
                </div>
              )}

              {regError && (
                <div className="flex items-start gap-2 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium leading-relaxed">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{regError}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-medium rounded-xl transition-colors cursor-pointer text-sm whitespace-nowrap shrink-0 shadow-sm"
              >
                <span>Ir para a Roleta</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* STEP 2: ROULETTE WHEEL */}
      {step === 'ROULETTE' && (
        <div className="w-full max-w-5xl mx-auto flex-1 min-h-0 flex flex-col items-center justify-center gap-2 overflow-hidden relative">
          <div className="w-full shrink-0 flex items-center justify-between pb-2 border-b border-slate-200">
            <button
              type="button"
              disabled={spinning}
              onClick={() => {
                playTone('click', muted);
                setStep('REGISTRATION');
              }}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar</span>
            </button>

            <div className="flex items-center gap-3 text-xs text-slate-500">
              <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{factory}</span>
              </div>
              <span aria-hidden="true">·</span>
              <div>
                <span>Registro: </span>
                <strong className="text-slate-900 font-mono font-medium">{registration}</strong>
              </div>
              <button
                type="button"
                onClick={() => setShowMobilePrizes((v) => !v)}
                className="lg:hidden inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold cursor-pointer"
              >
                <Gift className="w-3.5 h-3.5 text-emerald-600" />
                <span>Prêmios</span>
              </button>
            </div>
          </div>

          <div className="text-center shrink-0">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Roleta de Prêmios
            </h1>
            <p className="text-xs text-slate-500 max-w-lg mx-auto">
              Gire a roleta para concorrer aos brindes disponíveis ou receber uma dica de segurança da informação.
            </p>
          </div>

          <div className="w-full flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_310px] gap-4 lg:gap-6 items-center justify-items-center overflow-hidden">
            <div className="w-full h-full min-h-0 flex flex-col items-center justify-center">
              {placedSlices.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 bg-white border border-rose-200 rounded-2xl text-center max-w-md mx-auto shadow-sm">
                  <AlertCircle className="w-10 h-10 text-rose-500 mb-3" />
                  <h3 className="text-base font-bold text-slate-900 mb-1">
                    Nenhum Item Disponível na Roleta
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Todos os brindes e o peso da opção Dica estão zerados nesta fábrica. Ajuste o estoque no painel Administrador.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center w-full mx-auto">
                  <div className="relative mb-[-12px] z-20 flex justify-center">
                    <div
                      className="transition-transform duration-75 ease-out"
                      style={{ transform: `rotate(${pointerTilt}deg)` }}
                    >
                      <div className="w-0 h-0 border-l-[14px] border-l-transparent border-r-[14px] border-r-transparent border-t-[26px] border-t-amber-500 drop-shadow-md filter" />
                    </div>
                  </div>

                  <div className="relative p-2 bg-white rounded-full border border-slate-200 shadow-xl">
                    <div className="relative">
                      <canvas
                        ref={canvasRef}
                        className="w-[min(70vw,44dvh)] h-[min(70vw,44dvh)] sm:w-[min(56vw,48dvh)] sm:h-[min(56vw,48dvh)] lg:w-[min(42vw,52dvh,450px)] lg:h-[min(42vw,52dvh,450px)] rounded-full select-none block"
                      />
                      <button
                        type="button"
                        onClick={handleSpin}
                        disabled={spinning || spinFinished || totalWeight <= 0}
                        aria-label="Girar roleta!"
                        title="Girar roleta!"
                        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[13%] h-[13%] rounded-full bg-transparent transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${
                          spinning || spinFinished || totalWeight <= 0
                            ? 'cursor-not-allowed'
                            : 'cursor-pointer hover:scale-105 hover:ring-4 hover:ring-amber-400/50 active:scale-95'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="mt-3 sm:mt-4 flex flex-col items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleSpin}
                      disabled={spinning || spinFinished || totalWeight <= 0}
                      className={`flex items-center justify-center gap-2 px-8 py-2.5 sm:py-3 rounded-xl font-semibold text-sm transition-all transform active:scale-95 shadow-sm whitespace-nowrap shrink-0 cursor-pointer ${
                        spinning || spinFinished || totalWeight <= 0
                          ? 'bg-slate-200 text-slate-500 cursor-not-allowed opacity-80'
                          : 'bg-slate-900 hover:bg-slate-800 text-white'
                      }`}
                    >
                      {spinning ? (
                        <>
                          <Sparkles className="w-4 h-4 animate-spin" />
                          <span>Girando a Roleta...</span>
                        </>
                      ) : spinFinished ? (
                        <span>Sorteio Concluído!</span>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-current" />
                          <span>Girar Roleta!</span>
                        </>
                      )}
                    </button>

                    <p className="text-xs text-slate-400 text-center">
                      {totalWeight <= 0
                        ? 'Todos os itens estão com estoque zerado nesta fábrica. Ajuste no painel Administrador.'
                        : spinning
                          ? 'Aguarde o sorteio...'
                          : spinFinished
                            ? 'Carregando resultado...'
                            : 'Clique para girar a roleta'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="hidden lg:flex w-full max-h-full flex-col bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2.5 overflow-y-auto">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                  <Gift className="w-4 h-4 text-emerald-600" />
                  <h2 className="text-xs font-bold text-slate-800 tracking-wider uppercase">
                    Prêmios da Roleta
                  </h2>
                </div>
              </div>

              {weightedItems.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">
                  Nenhum item configurado no momento.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {weightedItems.map(({ item }) => {
                    const isTip = item.outcomeType === 'dica' || item.id === 'dica';
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-2.5 p-2 rounded-xl border bg-slate-50/70 border-slate-200"
                      >
                        {isTip ? (
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border border-amber-200 bg-amber-50 text-amber-600">
                            <Lightbulb className="w-4 h-4" />
                          </div>
                        ) : (
                          <PrizeThumb imageUrl={item.imageUrl} name={item.label} />
                        )}
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {item.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {showMobilePrizes && (
            <div
              className="lg:hidden fixed inset-0 z-40 bg-slate-950/50 flex items-center justify-center p-4"
              onClick={() => setShowMobilePrizes(false)}
            >
              <div
                className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-4 shadow-xl space-y-3 max-h-[75dvh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Gift className="w-4 h-4 text-emerald-600" />
                    <h2 className="text-xs font-bold text-slate-800 tracking-wider uppercase">
                      Prêmios da Roleta
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMobilePrizes(false)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    Fechar
                  </button>
                </div>
                <div className="space-y-1.5">
                  {weightedItems.map(({ item }) => {
                    const isTip = item.outcomeType === 'dica' || item.id === 'dica';
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-2.5 p-2 rounded-xl border bg-slate-50/70 border-slate-200"
                      >
                        {isTip ? (
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border border-amber-200 bg-amber-50 text-amber-600">
                            <Lightbulb className="w-4 h-4" />
                          </div>
                        ) : (
                          <PrizeThumb imageUrl={item.imageUrl} name={item.label} />
                        )}
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {item.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: RESULT */}
      {step === 'RESULT' && resultRecord && (
        <div className="w-full max-w-lg mx-auto flex-1 min-h-0 flex items-center justify-center overflow-y-auto py-1">
          <div className="w-full bg-white border border-slate-200 rounded-3xl p-5 sm:p-7 shadow-sm text-center">
            {resultRecord.outcomeType === 'dica' ? (
              <>
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3 bg-amber-50 text-amber-600 border border-amber-200">
                  <Lightbulb className="w-6 h-6" />
                </div>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mb-1.5">
                  Dica de Segurança da Informação
                </h2>
                <p className="text-xs text-slate-500 mb-4">
                  Leia com atenção e leve essa proteção para o seu dia a dia
                </p>
                <div className="bg-amber-50/80 border-2 border-amber-300 rounded-2xl p-4 sm:p-5 mb-4 shadow-sm">
                  <p className="text-base sm:text-lg font-bold text-slate-900 leading-relaxed">
                    “{resultRecord.tipText}”
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl mb-2.5 bg-emerald-50 text-emerald-600 border border-emerald-100">
                  <Award className="w-5 h-5" />
                </div>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mb-3.5">
                  Parabéns! Você ganhou:
                </h2>
                <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 mb-4 flex flex-col items-center">
                  {resultItem?.imageUrl && !resultImgBroken ? (
                    <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm mb-3 p-2 flex items-center justify-center">
                      <img
                        src={resultItem.imageUrl}
                        alt={resultRecord.prizeName}
                        referrerPolicy="no-referrer"
                        onError={() => setResultImgBroken(true)}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-32 h-32 rounded-2xl border border-slate-200 bg-white flex items-center justify-center mb-3">
                      <ImageOff className="w-8 h-8 text-slate-300" />
                    </div>
                  )}
                  <div className="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug">
                    {resultRecord.prizeName}
                  </div>
                </div>
              </>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 mb-4 space-y-1.5 text-xs text-slate-600">
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Fábrica / Unidade:</span>
                </span>
                <span className="font-semibold text-slate-900">{resultRecord.factory}</span>
              </div>
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Registro:</span>
                </span>
                <span className="font-mono font-bold text-slate-900">
                  {resultRecord.registrationNumber}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Horário:</span>
                </span>
                <span className="text-slate-800 font-mono">
                  {new Date(resultRecord.timestamp).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>

            {resultRecord.outcomeType === 'prize' && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 mb-4">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Apresente ao responsável para retirar seu brinde</span>
              </div>
            )}

            <div className="space-y-2">
              {roundMode && onFinishRoundNextPlayer ? (
                <button
                  type="button"
                  onClick={() => {
                    playTone('click', muted);
                    onFinishRoundNextPlayer();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white font-semibold rounded-xl transition-colors cursor-pointer text-sm whitespace-nowrap shrink-0 shadow-sm"
                >
                  <span>Iniciar vez da próxima pessoa</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResetToRegistration}
                  className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-medium rounded-xl transition-colors cursor-pointer text-sm whitespace-nowrap shrink-0 shadow-sm"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Próximo Participante</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
