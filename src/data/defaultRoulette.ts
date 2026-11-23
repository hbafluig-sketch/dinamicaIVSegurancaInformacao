import type { QuizQuestion, RouletteData, RouletteSettings, WheelItem } from '../types/gincana.ts';

export const DEFAULT_FACTORIES: string[] = [
  'Fábrica 1',
  'Fábrica 2',
  'Fábrica 4',
  'Casa Branca',
  'Extrema',
];

export const DEFAULT_PRIZE_IMAGES: Record<string, string> = {
  camiseta: '/assets/aistudio/camiseta_ae6cf0be.png',
  garrafa_termica: '/assets/aistudio/Garrafa_ea73a656.png',
  fone_power_bank: '/assets/aistudio/fone_c3cb11ac.png',
  carregador_usb: '/assets/aistudio/cabo_f200b078.png',
  descanso_copo: '/assets/aistudio/descanso_de_copo_a55ba344.png',
};

export const BADGE_COLORS: Array<{ id: string; label: string; hex: string }> = [
  { id: 'red', label: 'Vermelho', hex: '#dc2626' },
  { id: 'emerald', label: 'Verde', hex: '#059669' },
  { id: 'blue', label: 'Azul', hex: '#2563eb' },
  { id: 'violet', label: 'Roxo', hex: '#7c3aed' },
  { id: 'pink', label: 'Magenta', hex: '#db2777' },
  { id: 'amber', label: 'Âmbar', hex: '#d97706' },
  { id: 'cyan', label: 'Turquesa', hex: '#0891b2' },
  { id: 'orange', label: 'Laranja', hex: '#ea580c' },
];

export const DEFAULT_WHEEL_ITEMS: WheelItem[] = [
  {
    id: 'camiseta',
    label: 'Camiseta',
    color: '#dc2626',
    textColor: '#ffffff',
    outcomeType: 'prize',
    imageUrl: DEFAULT_PRIZE_IMAGES.camiseta,
    weight: 1,
  },
  {
    id: 'garrafa_termica',
    label: 'Garrafa Térmica',
    color: '#059669',
    textColor: '#ffffff',
    outcomeType: 'prize',
    imageUrl: DEFAULT_PRIZE_IMAGES.garrafa_termica,
    weight: 1,
  },
  {
    id: 'fone_power_bank',
    label: 'Fone de Ouvido Power Bank',
    color: '#7c3aed',
    textColor: '#ffffff',
    outcomeType: 'prize',
    imageUrl: DEFAULT_PRIZE_IMAGES.fone_power_bank,
    weight: 1,
  },
  {
    id: 'carregador_usb',
    label: 'Carregador USB Multiuso',
    color: '#2563eb',
    textColor: '#ffffff',
    outcomeType: 'prize',
    imageUrl: DEFAULT_PRIZE_IMAGES.carregador_usb,
    weight: 1,
  },
  {
    id: 'descanso_copo',
    label: 'Descanso de Copo',
    color: '#db2777',
    textColor: '#ffffff',
    outcomeType: 'prize',
    imageUrl: DEFAULT_PRIZE_IMAGES.descanso_copo,
    weight: 1,
  },
  {
    id: 'dica',
    label: 'Dica',
    color: '#d97706',
    textColor: '#ffffff',
    outcomeType: 'dica',
    weight: 1,
  },
];

export const DEFAULT_STOCK_BY_ITEM: Record<string, number> = {
  camiseta: 15,
  garrafa_termica: 12,
  fone_power_bank: 6,
  carregador_usb: 10,
  descanso_copo: 25,
  dica: 15,
};

export function buildDefaultStocks(
  factories: string[],
  items: WheelItem[],
): Record<string, Record<string, number>> {
  const stocks: Record<string, Record<string, number>> = {};
  for (const factory of factories) {
    stocks[factory] = {};
    for (const item of items) {
      stocks[factory][item.id] =
        DEFAULT_STOCK_BY_ITEM[item.id] ?? (item.outcomeType === 'dica' ? 15 : 10);
    }
  }
  return stocks;
}

export const CYBER_TIPS: string[] = [
  'Não use a mesma senha em tudo. Cada conta importante precisa de uma senha própria.',
  'Desconfie de mensagens com pressa pedindo dinheiro, PIX ou seus dados pessoais.',
  'Nunca clique em links estranhos recebidos por WhatsApp, SMS ou e-mail desconhecido.',
  'Ative a confirmação em duas etapas no celular e no e-mail para proteger sua conta.',
  'Vai sair da mesa? Bloqueie a tela do computador antes de levantar.',
  'Nunca passe seu código de verificação por telefone ou mensagem para ninguém.',
  'Não conecte pen drives encontrados ou de pessoas desconhecidas no computador do trabalho.',
  'Evite acessar banco ou fazer compras usando Wi-Fi público sem senha.',
  'Senhas fáceis como 123456, nome ou data de nascimento são descobertas em segundos.',
  'Se um e-mail do trabalho parecer estranho, confirme com o colega antes de responder ou clicar.',
  'Não anote senhas em papéis colados no monitor ou embaixo do teclado.',
  'Mantenha seu celular e computador sempre atualizados para evitar falhas de segurança.',
  'Não compartilhe sua senha do trabalho com ninguém, nem mesmo com colegas próximos.',
  'Cuidado com promoções boas demais para ser verdade na internet: quase sempre é golpe.',
  'Antes de baixar um aplicativo, veja se ele está na loja oficial do seu celular.',
  'Não deixe documentos da empresa ou dados de clientes espalhados em cima da mesa.',
  'Se um conhecido pedir dinheiro pelo WhatsApp, ligue para confirmar se é realmente ele.',
  'Confira sempre o endereço do site antes de digitar seu login e senha.',
  'Recebeu um boleto inesperado? Confirme os dados de quem vai receber antes de pagar.',
  'Em caso de dúvida sobre algo suspeito no computador ou celular, avise a equipe de TI.',
];

const TIP_QUEUE_KEY = 'cyber_roleta_tip_queue_v6';

export function pickNonRepeatingTip(): string {
  try {
    const raw = localStorage.getItem(TIP_QUEUE_KEY);
    let queue: number[] = raw ? (JSON.parse(raw) as number[]) : [];
    if (!Array.isArray(queue) || queue.length === 0) {
      queue = CYBER_TIPS.map((_, idx) => idx);
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }
    const nextIdx = queue.shift() ?? 0;
    localStorage.setItem(TIP_QUEUE_KEY, JSON.stringify(queue));
    return CYBER_TIPS[nextIdx] || CYBER_TIPS[0];
  } catch {
    return CYBER_TIPS[Math.floor(Math.random() * CYBER_TIPS.length)];
  }
}

export const DEFAULT_QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q-1',
    question:
      'Você precisa sair da mesa por dois minutos para buscar um documento na impressora. Qual a atitude correta?',
    options: [
      'Deixar o computador aberto porque é rápido',
      'Bloquear a tela imediatamente (Win + L)',
      'Apenas desligar o monitor',
    ],
    correctIndex: 1,
    explanation:
      'Bloquear a sessão (Win + L) impede que qualquer pessoa acesse seu usuário e sistemas enquanto você estiver ausente.',
  },
  {
    id: 'q-2',
    question: 'Você encontra um pendrive sem identificação próximo à recepção. O que fazer?',
    options: [
      'Conectar no seu computador para descobrir de quem é',
      'Entregar para a equipe de TI/Segurança sem conectá-lo',
      'Guardar na gaveta para uso pessoal',
    ],
    correctIndex: 1,
    explanation:
      'Pendrives desconhecidos podem conter malware ou executar comandos maliciosos automaticamente ao serem conectados.',
  },
  {
    id: 'q-3',
    question:
      'Um e-mail supostamente do suporte pede sua senha com urgência para evitar bloqueio da conta. Como agir?',
    options: [
      'Responder com a senha para não perder o acesso',
      'Clicar no link e preencher o formulário rápido',
      'Não informar a senha e reportar como tentativa de phishing à TI',
    ],
    correctIndex: 2,
    explanation:
      'A equipe de TI nunca solicita sua senha por e-mail, telefone ou link externo. Trata-se de phishing.',
  },
  {
    id: 'q-4',
    question: 'Qual destas informações deve ser classificada como CONFIDENCIAL?',
    options: [
      'Cartaz institucional de valores da empresa',
      'Desenho técnico de produto e planejamento de lote',
      'Placa de sinalização de segurança do trabalho',
    ],
    correctIndex: 1,
    explanation:
      'Desenhos técnicos e planejamentos produtivos contêm propriedade intelectual e dados estratégicos restritos.',
  },
  {
    id: 'q-5',
    question:
      'Qual é a prática recomendada para proteger documentos impressos classificados como internos ou confidenciais?',
    options: [
      'Deixar sobre a mesa ao final do expediente',
      'Retirar imediatamente da impressora e guardar em local seguro (Mesa Limpa)',
      'Usar como rascunho em áreas comuns',
    ],
    correctIndex: 1,
    explanation:
      'A Política de Mesa Limpa evita vazamentos físicos acidentais de dados sensíveis e documentos impressos.',
  },
  {
    id: 'q-6',
    question: 'Por que a Autenticação Multifator (MFA) é tão importante?',
    options: [
      'Porque substitui a necessidade de ter uma boa senha',
      'Porque exige uma segunda verificação além da senha, bloqueando acessos indevidos',
      'Porque deixa o computador mais rápido',
    ],
    correctIndex: 1,
    explanation:
      'Mesmo que alguém descubra sua senha, o segundo fator impede o invasor de concluir o login.',
  },
];

export function createDefaultRouletteData(): RouletteData {
  const settings: RouletteSettings = {
    factories: [...DEFAULT_FACTORIES],
    items: structuredClone(DEFAULT_WHEEL_ITEMS),
    stocks: buildDefaultStocks(DEFAULT_FACTORIES, DEFAULT_WHEEL_ITEMS),
    quizEnabled: false,
    allowDuplicateRegistration: false,
    updatedAt: new Date().toISOString(),
  };

  return {
    version: 3,
    settings,
    participations: [],
    quizQuestions: structuredClone(DEFAULT_QUIZ_QUESTIONS),
  };
}
