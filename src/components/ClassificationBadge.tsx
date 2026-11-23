import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import type { ClassificationType } from '../types/gincana.ts';

export const CLASSIFICATION_META: Record<
  ClassificationType,
  {
    label: string;
    shortLabel: string;
    summary: string;
    examples: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
    regionBg: string;
    regionBorder: string;
    ringColor: string;
  }
> = {
  publica: {
    label: 'Informação pública',
    shortLabel: 'Pública',
    summary: 'Pode ser divulgada dentro e fora da empresa sem causar prejuízo.',
    examples: 'Campanhas, placas, valores e comunicações públicas.',
    bgClass: 'bg-emerald-50',
    textClass: 'text-emerald-800',
    borderClass: 'border-emerald-300',
    regionBg: 'bg-emerald-600/75',
    regionBorder: 'border-white ring-2 ring-emerald-700',
    ringColor: '#047857',
  },
  interna: {
    label: 'Informação interna',
    shortLabel: 'Interna',
    summary: 'Destinada ao uso dos colaboradores e não deve sair da empresa sem autorização.',
    examples: 'Postos de trabalho, áreas, procedimentos e ordens.',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-900',
    borderClass: 'border-amber-300',
    regionBg: 'bg-amber-500/75',
    regionBorder: 'border-white ring-2 ring-amber-600',
    ringColor: '#d97706',
  },
  confidencial: {
    label: 'Informação confidencial',
    shortLabel: 'Confidencial',
    summary: 'Restrita, sensível ou estratégica; exige acesso autorizado e proteção rigorosa.',
    examples: 'Senhas, sistemas, projetos, desenhos e dados de produção.',
    bgClass: 'bg-rose-50',
    textClass: 'text-rose-800',
    borderClass: 'border-rose-300',
    regionBg: 'bg-rose-600/75',
    regionBorder: 'border-white ring-2 ring-rose-700',
    ringColor: '#be123c',
  },
};

export function ClassificationIcon({
  type,
  className = 'w-4 h-4 shrink-0',
}: {
  type: ClassificationType;
  className?: string;
}) {
  if (type === 'publica') return <CheckCircle2 className={`${className} text-emerald-700`} />;
  if (type === 'interna') return <AlertTriangle className={`${className} text-amber-700`} />;
  return <ShieldAlert className={`${className} text-rose-700`} />;
}

export function ClassificationBadge({
  type,
  compact = false,
}: {
  type: ClassificationType;
  compact?: boolean;
}) {
  const meta = CLASSIFICATION_META[type];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold whitespace-nowrap shrink-0 ${meta.bgClass} ${meta.textClass} ${meta.borderClass}`}
    >
      <ClassificationIcon type={type} className="w-3.5 h-3.5 shrink-0" />
      <span>{compact ? meta.shortLabel : meta.label}</span>
    </span>
  );
}
