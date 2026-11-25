import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Link2,
  LogOut,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useState } from 'react';
import type { GoogleSheetConfig } from '../utils/googleSheets.ts';
import { parseSpreadsheetId } from '../utils/googleSheets.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

interface GoogleSheetsPanelProps {
  googleUser: User | null;
  hasToken: boolean;
  isSigningIn: boolean;
  sheetConfig: GoogleSheetConfig | null;
  busyAction: string | null;
  participationsCount: number;
  scenesCount: number;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onCreateSpreadsheet: (title: string) => Promise<void>;
  onConnectSpreadsheet: (spreadsheetId: string) => Promise<void>;
  onToggleAutoSync: (enabled: boolean) => void;
  onPushAllToSheet: () => Promise<void>;
  onPullAllFromSheet: () => Promise<void>;
  onClearSheetParticipations: () => Promise<void>;
  onDisconnectSheet: () => void;
}

type ConfirmActionState =
  | null
  | {
      type: 'create' | 'push_all' | 'clear_participations' | 'enable_autosync';
      title: string;
      description: string;
      confirmLabel: string;
      tone: 'primary' | 'danger';
      payload?: string;
    };

export function GoogleSheetsPanel({
  googleUser,
  hasToken,
  isSigningIn,
  sheetConfig,
  busyAction,
  participationsCount,
  scenesCount,
  onSignIn,
  onSignOut,
  onCreateSpreadsheet,
  onConnectSpreadsheet,
  onToggleAutoSync,
  onPushAllToSheet,
  onPullAllFromSheet,
  onClearSheetParticipations,
  onDisconnectSheet,
}: GoogleSheetsPanelProps) {
  const [newTitle, setNewTitle] = useState('Gincana Segurança da Informação — Dados');
  const [sheetInput, setSheetInput] = useState('');
  const [confirmModal, setConfirmModal] = useState<ConfirmActionState>(null);

  const handleConfirmExecute = async () => {
    if (!confirmModal) return;
    const action = confirmModal;
    setConfirmModal(null);

    if (action.type === 'create') {
      await onCreateSpreadsheet(action.payload || 'Gincana Segurança da Informação — Dados');
    } else if (action.type === 'push_all') {
      await onPushAllToSheet();
    } else if (action.type === 'clear_participations') {
      await onClearSheetParticipations();
    } else if (action.type === 'enable_autosync') {
      onToggleAutoSync(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Connection Card */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                Persistência no Google Sheets
              </h2>
            </div>
            <p className="text-sm text-slate-600 max-w-2xl">
              Salve os giros da roleta, estoques por unidade, perguntas do quiz e cenários
              diretamente em uma planilha do seu Google Drive, evitando limites diários do banco
              anterior.
            </p>
          </div>

          {hasToken && googleUser ? (
            <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <div className="text-xs">
                <div className="font-semibold text-emerald-900">
                  {googleUser.displayName || 'Conta Google conectada'}
                </div>
                <div className="text-emerald-700">{googleUser.email}</div>
              </div>
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="ml-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <LogOut className="w-3 h-3" />
                <span>Sair</span>
              </button>
            </div>
          ) : (
            <GoogleSignInButton
              onClick={() => void onSignIn()}
              disabled={isSigningIn}
              label={isSigningIn ? 'Conectando...' : 'Sign in with Google'}
            />
          )}
        </div>

        {!hasToken && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 flex items-start gap-3 text-xs text-amber-950">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              {sheetConfig ? (
                <span>
                  A planilha <strong>{sheetConfig.spreadsheetTitle}</strong> está configurada, mas a
                  sessão do Google precisa ser autenticada novamente nesta guia. Clique em{' '}
                  <strong>Sign in with Google</strong> para reativar a gravação automática.
                </span>
              ) : (
                <span>
                  Faça login com sua conta Google acima para criar uma nova planilha ou conectar uma
                  planilha existente do Google Sheets.
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Spreadsheet Selection or Active Sheet Controls */}
      {hasToken && !sheetConfig && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">
              Criar nova planilha automaticamente
            </h3>
            <p className="text-xs text-slate-600">
              Cria uma planilha estruturada com as abas <strong>Participacoes</strong>,{' '}
              <strong>Estoques</strong>, <strong>Configuracoes</strong> e{' '}
              <strong>Cenarios</strong> e envia os dados atuais do aplicativo.
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Nome da nova planilha
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Gincana Segurança da Informação — Dados"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-sky-700"
              />
            </div>
            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() =>
                setConfirmModal({
                  type: 'create',
                  title: 'Criar e preencher nova planilha no Google Sheets?',
                  description: `Uma nova planilha chamada "${newTitle.trim() || 'Gincana Segurança da Informação — Dados'}" será criada na sua conta Google com ${participationsCount} participação(ões), estoques atuais e ${scenesCount} cenário(s).`,
                  confirmLabel: 'Criar planilha',
                  tone: 'primary',
                  payload: newTitle.trim() || 'Gincana Segurança da Informação — Dados',
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>
                {busyAction === 'create' ? 'Criando planilha...' : 'Criar Planilha no Google Sheets'}
              </span>
            </button>
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">
              Conectar uma planilha existente
            </h3>
            <p className="text-xs text-slate-600">
              Cole o link completo ou o ID de uma planilha sua do Google Sheets que você deseja usar
              como destino dos dados.
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Link ou ID da planilha
              </label>
              <input
                type="text"
                value={sheetInput}
                onChange={(e) => setSheetInput(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-sky-700"
              />
            </div>
            <button
              type="button"
              disabled={Boolean(busyAction) || !parseSpreadsheetId(sheetInput)}
              onClick={() => void onConnectSpreadsheet(parseSpreadsheetId(sheetInput))}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              <Link2 className="w-4 h-4" />
              <span>
                {busyAction === 'connect' ? 'Conectando...' : 'Conectar Planilha'}
              </span>
            </button>
          </section>
        </div>
      )}

      {sheetConfig && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                Planilha Vinculada
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                {sheetConfig.spreadsheetTitle}
              </h3>
              <div className="text-xs text-slate-500">
                ID: <span className="font-mono">{sheetConfig.spreadsheetId}</span>
                {sheetConfig.lastSyncedAt && (
                  <span>
                    {' '}
                    · Última sincronização:{' '}
                    {new Date(sheetConfig.lastSyncedAt).toLocaleString('pt-BR')}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={sheetConfig.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-900"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Abrir no Google Sheets</span>
              </a>
              <button
                type="button"
                onClick={onDisconnectSheet}
                className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Desvincular
              </button>
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={sheetConfig.autoSyncEnabled}
              disabled={!hasToken}
              onChange={(e) => {
                if (e.target.checked) {
                  setConfirmModal({
                    type: 'enable_autosync',
                    title: 'Ativar gravação automática no Google Sheets?',
                    description: `Ao ativar, cada giro da roleta adicionará uma linha na aba "Participacoes" e atualizará a aba "Estoques" (além de salvar alterações de estoque/configurações/cenários) na planilha "${sheetConfig.spreadsheetTitle}".`,
                    confirmLabel: 'Ativar gravação automática',
                    tone: 'primary',
                  });
                } else {
                  onToggleAutoSync(false);
                }
              }}
              className="mt-0.5 accent-emerald-700"
            />
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Gravar giros, estoques e alterações automaticamente nesta planilha
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Quando ativado e conectado com sua conta Google, os novos giros e ajustes são
                enviados diretamente para o Google Sheets sem depender da cota do banco anterior.
              </div>
            </div>
          </label>

          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-200">
            <button
              type="button"
              disabled={!hasToken || Boolean(busyAction)}
              onClick={() =>
                setConfirmModal({
                  type: 'push_all',
                  title: 'Sobrescrever dados na planilha do Google Sheets?',
                  description: `Isso irá substituir o conteúdo das abas "Participacoes" (${participationsCount} registro(s)), "Estoques", "Configuracoes" e "Cenarios" (${scenesCount} cena(s)) na planilha "${sheetConfig.spreadsheetTitle}" pelos dados atuais do aplicativo.`,
                  confirmLabel: 'Enviar e atualizar planilha',
                  tone: 'primary',
                })
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold disabled:opacity-45 cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>
                {busyAction === 'push' ? 'Enviando...' : 'Enviar tudo para a Planilha'}
              </span>
            </button>

            <button
              type="button"
              disabled={!hasToken || Boolean(busyAction)}
              onClick={() => void onPullAllFromSheet()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold disabled:opacity-45 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'pull' ? 'animate-spin' : ''}`} />
              <span>
                {busyAction === 'pull' ? 'Importando...' : 'Carregar da Planilha para o App'}
              </span>
            </button>

            <button
              type="button"
              disabled={!hasToken || Boolean(busyAction)}
              onClick={() =>
                setConfirmModal({
                  type: 'clear_participations',
                  title: 'Limpar todas as participações da planilha?',
                  description: `Esta ação apagará todas as linhas de giros da aba "Participacoes" na planilha "${sheetConfig.spreadsheetTitle}" (mantendo apenas o cabeçalho). Esta ação não pode ser desfeita.`,
                  confirmLabel: 'Limpar participações na planilha',
                  tone: 'danger',
                })
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold disabled:opacity-45 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpar Participações na Planilha</span>
            </button>
          </div>
        </section>
      )}

      {/* Explicit Confirmation Dialog for Mutating Operations */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="font-display text-lg font-bold text-slate-900">
              {confirmModal.title}
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">{confirmModal.description}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExecute()}
                className={`px-4 py-2 rounded-lg text-sm font-semibold text-white cursor-pointer ${
                  confirmModal.tone === 'danger'
                    ? 'bg-rose-700 hover:bg-rose-800'
                    : 'bg-emerald-700 hover:bg-emerald-800'
                }`}
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
