export type ClassificationType = 'publica' | 'interna' | 'confidencial';

export type ViewMode = 'start' | 'game' | 'roulette' | 'result' | 'admin';

export type OutcomeType = 'prize' | 'dica';

export interface RegionPoint {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: ClassificationType;
  desc: string;
  explain: string;
}

export interface Scene {
  id: string;
  name: string;
  imageUrl: string;
  thumbUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  hideLegendPct?: number;
  isBuiltin?: boolean;
  points: RegionPoint[];
}

export interface ProjectData {
  version: number;
  updatedAt: string;
  scenes: Scene[];
}

export interface GameState {
  sceneIndex: number;
  hits: number;
  misses: number;
  found: string[];
  roundHits: number;
  round: number;
  pendingReset: boolean;
}

export interface WheelItem {
  id: string;
  label: string;
  color: string;
  textColor: string;
  outcomeType: OutcomeType;
  imageUrl?: string;
  weight: number;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface RouletteSettings {
  factories: string[];
  items: WheelItem[];
  stocks: Record<string, Record<string, number>>;
  quizEnabled: boolean;
  allowDuplicateRegistration: boolean;
  updatedAt: string;
}

export interface Participation {
  id: string;
  timestamp: number;
  factory: string;
  registrationNumber: string;
  accentColor?: string;
  outcomeType: OutcomeType;
  prizeId: string;
  prizeName: string;
  tipText?: string;
  quizCorrect?: boolean;
  roundNumber?: number;
}

export interface RouletteData {
  version?: number;
  settings: RouletteSettings;
  participations: Participation[];
  quizQuestions: QuizQuestion[];
}
