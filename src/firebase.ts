import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const typedConfig = firebaseConfig as typeof firebaseConfig & { firestoreDatabaseId?: string };
const app = initializeApp(firebaseConfig);
export const db = typedConfig.firestoreDatabaseId
  ? getFirestore(app, typedConfig.firestoreDatabaseId)
  : getFirestore(app);
export const hasFirestoreDatabase = Boolean(typedConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const GOOGLE_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
] as const;

const googleProvider = new GoogleAuthProvider();
for (const scope of GOOGLE_SHEETS_SCOPES) {
  googleProvider.addScope(scope);
}
googleProvider.setCustomParameters({
  prompt: 'consent',
  include_granted_scopes: 'true',
});

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export function initGoogleAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthMissing?: (user: User | null) => void,
) {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user && cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken);
      return;
    }
    if (!isSigningIn) {
      cachedAccessToken = null;
      onAuthMissing?.(user);
    }
  });
}

async function verifySheetsScope(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) return true; // skip if tokeninfo unavailable; API call will validate
    const info = (await res.json()) as { scope?: string };
    const granted = (info.scope || '').split(/\s+/);
    return granted.includes('https://www.googleapis.com/auth/spreadsheets');
  } catch {
    return true;
  }
}

export async function googleSignIn(): Promise<{ user: User; accessToken: string }> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Não foi possível obter o token de acesso do Google Sheets.');
    }
    const hasScope = await verifySheetsScope(credential.accessToken);
    if (!hasScope) {
      cachedAccessToken = null;
      throw new Error(
        'A permissão do Google Sheets não foi marcada na janela do Google. Tente entrar novamente e marque a caixa de acesso às planilhas.',
      );
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearGoogleAccessToken(): void {
  cachedAccessToken = null;
}

export async function googleSignOut(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration (client is offline).');
    }
  }
}

if (hasFirestoreDatabase) {
  void testConnection();
}
