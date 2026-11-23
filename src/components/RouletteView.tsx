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

function pickSmartWeightedSlice(slices: PlacedSlice[], recentPrizeIds: string[]): number {
  const active = slices
    .map((slice, idx) => ({ slice, idx }))
    .filter(({ slice }) => slice.weight > 0);
  if (active.length === 0) return -1;
  if (active.length === 1) return active[0].idx;

  const totalWeight = active.reduce((sum, entry) => sum + entry.slice.weight, 0);
  const last0 = recentPrizeIds[0];
  const last1 = recentPrizeIds[1];
  const last2 = recentPrizeIds[2];
  const windowSize = Math.min(recentPrizeIds.length, 10);
  const recentWindow = recentPrizeIds.slice(0, windowSize);
  const counts: Record<string, number> = {};
  for (const id of recentWindow) {
    counts[id] = (counts[id] || 0) + 1;
  }

  const adjusted = active.map(({ slice, idx }) => {
    const share = slice.weight / totalWeight;
    const balance = windowSize * share - (counts[slice.item.id] || 0);
    const balanceFactor = balance >= 0 ? 1 + balance * 0.85 : 1 / (1 + Math.abs(balance) * 1.6);
    let repeatPenalty = 1;
    if (slice.item.id === last0) {
      repeatPenalty = (active.length >= 3 && share < 0.7) || last1 === slice.item.id ? 0 : 0.08;
    } else if (slice.item.id === last1 && active.length >= 3) {
      repeatPenalty = 0.35;
    } else if (slice.item.id === last2 && active.length >= 4) {
      repeatPenalty = 0.65;
    }
    return {
      idx,
      effectiveWeight: Math.max(0, slice.weight * balanceFactor * repeatPenalty),
    };
  });

  const adjustedTotal = adjusted.reduce((sum, entry) => sum + entry.effectiveWeight, 0);
  if (adjustedTotal <= 0) {
    let r = Math.random() * totalWeight;
    for (const { slice, idx } of active) {
      r -= slice.weight;
      if (r <= 0) return idx;
    }
    return active[0].idx;
  }

  let r = Math.random() * adjustedTotal;
  for (const entry of adjusted) {
    r -= entry.effectiveWeight;
    if (r <= 0) return entry.idx;
  }
  return adjusted[0].idx;
}

function PrizeThumb({ imageUrl, name }: { imageUrl?: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!imageUrl || broken) {
    return (
      <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
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
      className="w-12 h-12 rounded-lg object-contain p-1 border border-slate-200 bg-white shrink-0"
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

  // Weighted slices: stock > 0 for prizes, or configured stock/weight for dicas
  const weightedItems: WeightedSlice[] = useMemo(
    () =>
      settings.items
        .map((item) => {
          const stockQty = Math.max(0, Number(factoryStock[item.id] ?? 0));
          const weight = stockQty > 0 ? stockQty * Math.max(1, Number(item.weight || 1)) : 0;
          return { item, weight };
        })
        .filter((entry) => entry.weight > 0),
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

  const recentPrizeIds = useMemo(
    () =>
      participations
        .filter((p) => p.factory === factory && Boolean(p.prizeId))
        .slice(0, 12)
        .map((p) => p.prizeId),
    [factory, participations],
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

    const chosenIdx = pickSmartWeightedSlice(placedSlices, recentPrizeIds);
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
    <div className="space-y-6">
      {roundMode && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="w-4 h-4" />
              <span>Rodada {roundNumber} concluída · 3 acertos alcançados</span>
            </div>
            <h2 className="font-display text-lg sm:text-xl font-extrabold text-slate-900">
              Roleta de Cibersegurança liberada
            </h2>
            <p className="text-xs sm:text-sm text-slate-700">
              {pendingReset
                ? `Restam ${remainingRegions} região(ões) no jogo. Após o giro, a próxima pessoa iniciará um novo ciclo.`
                : `Ainda restam ${remainingRegions} regiões no mapa para a próxima pessoa continuar.`}
            </p>
          </div>
          {onBackToGame && step === 'REGISTRATION' && (
            <button
              type="button"
              onClick={onBackToGame}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              Voltar ao cenário
            </button>
          )}
        </section>
      )}

      {/* STEP 1: REGISTRATION */}
      {step === 'REGISTRATION' && (
        <div className="w-full max-w-lg mx-auto py-4 sm:py-8">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-9 shadow-sm">
            <div className="text-center mb-7">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-slate-100 text-slate-800 mb-4">
                <ShieldCheck className="w-6 h-6 text-emerald-600" />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 mb-1.5">
                Identificação
              </h1>
              <p className="text-sm text-slate-500">
                Confirme a fábrica e digite o seu registro para girar a roleta
              </p>
            </div>

            <form onSubmit={handleSubmitRegistration} className="space-y-6">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2.5">
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
                        className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer text-left ${
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
                  className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2"
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
                  className={`w-full px-4 py-3.5 bg-slate-50 border rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 transition-all font-mono text-base ${
                    regError
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-slate-300 focus:border-slate-900 focus:ring-slate-900'
                  }`}
                />
              </div>

              {/* Optional Cybersecurity Quick Quiz when enabled in Admin */}
              {settings.quizEnabled && currentQuestion && (
                <div className="pt-4 border-t border-slate-200 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-sky-800">
                    <HelpCircle className="w-4 h-4" />
                    <span>Quiz rápido de cibersegurança</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 leading-snug">
                    {currentQuestion.question}
                  </p>
                  <div className="space-y-2">
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
                          className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs transition-colors cursor-pointer flex items-start gap-2 ${cls}`}
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
                      className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
                    >
                      Confirmar resposta
                    </button>
                  ) : (
                    <div
                      className={`rounded-xl border p-3 text-xs space-y-1 ${
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
                <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium leading-relaxed">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{regError}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-3.5 px-6 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-medium rounded-xl transition-colors cursor-pointer text-sm whitespace-nowrap shrink-0 shadow-sm"
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
        <div className="w-full max-w-6xl mx-auto py-2 sm:py-4">
          <div className="flex items-center justify-between mb-5 pb-3.5 border-b border-slate-200">
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

            <div className="flex items-center gap-4 text-xs text-slate-500">
              <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{factory}</span>
              </div>
              <span aria-hidden="true">·</span>
              <div>
                <span>Registro: </span>
                <strong className="text-slate-900 font-mono font-medium">{registration}</strong>
              </div>
            </div>
          </div>

          <div className="text-center mb-6">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1">
              Roleta de Prêmios
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto">
              Gire a roleta para concorrer aos brindes disponíveis ou receber uma dica de segurança da informação.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-8 flex justify-center">
              {placedSlices.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 bg-white border border-rose-200 rounded-2xl text-center max-w-md mx-auto shadow-sm">
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
                  <div className="relative mb-[-16px] z-20 flex justify-center">
                    <div
                      className="transition-transform duration-75 ease-out"
                      style={{ transform: `rotate(${pointerTilt}deg)` }}
                    >
                      <div className="w-0 h-0 border-l-[16px] border-l-transparent border-r-[16px] border-r-transparent border-t-[32px] border-t-amber-500 drop-shadow-md filter" />
                    </div>
                  </div>

                  <div className="relative p-2.5 bg-white rounded-full border border-slate-200 shadow-xl">
                    <div className="relative">
                      <canvas
                        ref={canvasRef}
                        className="w-[330px] h-[330px] sm:w-[440px] sm:h-[440px] lg:w-[500px] lg:h-[500px] rounded-full select-none block"
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

                  <div className="mt-6 flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSpin}
                      disabled={spinning || spinFinished || totalWeight <= 0}
                      className={`flex items-center justify-center gap-2.5 px-9 py-3.5 rounded-xl font-semibold text-sm transition-all transform active:scale-95 shadow-sm whitespace-nowrap shrink-0 cursor-pointer ${
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

                    <p className="text-xs text-slate-400">
                      {spinning
                        ? 'Aguarde o sorteio...'
                        : spinFinished
                          ? 'Carregando resultado...'
                          : 'Clique para girar a roleta'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Gift className="w-4 h-4 text-emerald-600" />
                  <h2 className="text-xs font-bold text-slate-800 tracking-wider uppercase">
                    Prêmios da Roleta
                  </h2>
                </div>
              </div>

              {weightedItems.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  Nenhum item configurado no momento.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {weightedItems.map(({ item }) => {
                    const isTip = item.outcomeType === 'dica' || item.id === 'dica';
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-2.5 rounded-xl border bg-slate-50/70 border-slate-200"
                      >
                        {isTip ? (
                          <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 border border-amber-200 bg-amber-50 text-amber-600">
                            <Lightbulb className="w-5 h-5" />
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
        </div>
      )}

      {/* STEP 3: RESULT */}
      {step === 'RESULT' && resultRecord && (
        <div className="w-full max-w-lg mx-auto py-4 sm:py-8">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-9 shadow-sm text-center">
            {resultRecord.outcomeType === 'dica' ? (
              <>
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 bg-amber-50 text-amber-600 border border-amber-200">
                  <Lightbulb className="w-7 h-7" />
                </div>
                <h2 className="font-display text-2xl font-bold text-slate-900 tracking-tight mb-2">
                  Dica de Segurança da Informação
                </h2>
                <p className="text-xs text-slate-500 mb-6">
                  Leia com atenção e leve essa proteção para o seu dia a dia
                </p>
                <div className="bg-amber-50/80 border-2 border-amber-300 rounded-2xl p-6 mb-6 shadow-sm">
                  <p className="text-lg sm:text-xl font-bold text-slate-900 leading-relaxed">
                    “{resultRecord.tipText}”
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3 bg-emerald-50 text-emerald-600 border border-emerald-100">
                  <Award className="w-6 h-6" />
                </div>
                <h2 className="font-display text-2xl font-bold text-slate-900 tracking-tight mb-5">
                  Parabéns! Você ganhou:
                </h2>
                <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 mb-6 flex flex-col items-center">
                  {resultItem?.imageUrl && !resultImgBroken ? (
                    <div className="w-48 h-48 sm:w-56 sm:h-56 rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm mb-4 p-2 flex items-center justify-center">
                      <img
                        src={resultItem.imageUrl}
                        alt={resultRecord.prizeName}
                        referrerPolicy="no-referrer"
                        onError={() => setResultImgBroken(true)}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-40 h-40 rounded-2xl border border-slate-200 bg-white flex items-center justify-center mb-4">
                      <ImageOff className="w-8 h-8 text-slate-300" />
                    </div>
                  )}
                  <div className="text-xl sm:text-2xl font-extrabold text-slate-900 leading-snug">
                    {resultRecord.prizeName}
                  </div>
                </div>
              </>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 space-y-2 text-xs text-slate-600">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Fábrica / Unidade:</span>
                </span>
                <span className="font-semibold text-slate-900">{resultRecord.factory}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
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
              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 mb-6">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Apresente ao responsável para retirar seu brinde</span>
              </div>
            )}

            <div className="space-y-2.5">
              {roundMode && onFinishRoundNextPlayer ? (
                <button
                  type="button"
                  onClick={() => {
                    playTone('click', muted);
                    onFinishRoundNextPlayer();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3.5 px-6 bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white font-semibold rounded-xl transition-colors cursor-pointer text-sm whitespace-nowrap shrink-0 shadow-sm"
                >
                  <span>Iniciar vez da próxima pessoa</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResetToRegistration}
                  className="w-full flex items-center justify-center gap-2 py-3.5 px-6 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-medium rounded-xl transition-colors cursor-pointer text-sm whitespace-nowrap shrink-0 shadow-sm"
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
