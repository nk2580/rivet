import { getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, getRedirectResult, GoogleAuthProvider, setPersistence, signInWithCredential, signInWithPopup, signInWithRedirect, signOut, type Auth, type User } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore';
import { z } from 'zod';
import { OWNER_EMAIL } from '@/domain/schema';

const configSchema = z.object({mode: z.enum(['connected', 'emulator']), configured: z.boolean(), firebase: z.object({apiKey: z.string(), authDomain: z.string(), projectId: z.string(), appId: z.string()}), authEmulatorUrl: z.string().optional(), firestoreEmulatorHost: z.string().optional(), firestoreEmulatorPort: z.number().int().optional()});
export type RuntimeConfig = z.infer<typeof configSchema>;
export type FirebaseServices = {auth: Auth; firestore: Firestore; config: RuntimeConfig};
export const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const cacheKey = 'rivet:public-runtime-config:v2';
let servicesPromise: Promise<FirebaseServices | null> | undefined;

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch(`${apiBase}/api/config`, {signal: AbortSignal.timeout(12000), cache: 'no-store'});
    if (!response.ok) throw new Error('Configuration service is unavailable.');
    const config = configSchema.parse(await response.json());
    if (config.configured) localStorage.setItem(cacheKey, JSON.stringify(config));
    return config;
  } catch (error) {
    const bundled = import.meta.env.VITE_FIREBASE_WEB_CONFIG;
    if (bundled) return configSchema.parse({mode: 'connected', configured: true, firebase: JSON.parse(bundled)});
    const cached = localStorage.getItem(cacheKey);
    if (cached) return configSchema.parse(JSON.parse(cached));
    throw error;
  }
}
export function initializeServices(config: RuntimeConfig): Promise<FirebaseServices | null> {
  servicesPromise ??= (async () => {
    if (!config.configured) return null;
    const application = getApps()[0] ?? initializeApp(config.firebase);
    const auth = getAuth(application);
    if (config.mode === 'emulator') {
      if (!config.firebase.projectId.startsWith('demo-') || !config.authEmulatorUrl) throw new Error('Invalid development emulator configuration.');
      // Rivet displays its own persistent, accessible emulator banner on both auth and workspace screens.
      connectAuthEmulator(auth, config.authEmulatorUrl, {disableWarnings: true});
    }
    await setPersistence(auth, browserLocalPersistence);
    const firestore = initializeFirestore(application, {localCache: memoryLocalCache()});
    if (config.mode === 'emulator') connectFirestoreEmulator(firestore, config.firestoreEmulatorHost || 'localhost', config.firestoreEmulatorPort || 8081);
    // A redirect may fail independently of an already persisted session.
    void getRedirectResult(auth).catch(() => {});
    return {auth, firestore, config};
  })();
  return servicesPromise;
}
export function isOwner(user: User | null): user is User {
  return !!user && user.email === OWNER_EMAIL && user.emailVerified && user.providerData.some(provider => provider.providerId === 'google.com');
}
export async function loginWithGoogle(services: FirebaseServices) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({login_hint: OWNER_EMAIL, prompt: 'select_account'});
  try { await signInWithPopup(services.auth, provider); }
  catch (error) {
    const code = (error as {code?: string}).code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(services.auth, provider);
    else throw error;
  }
}
/** Clearly labelled developer-only identity; never available in connected mode. */
export async function loginToEmulator(services: FirebaseServices) {
  if (services.config.mode !== 'emulator' || !services.config.firebase.projectId.startsWith('demo-')) throw new Error('Emulator login is disabled.');
  const payload = {sub: 'rivet-local-owner', email: OWNER_EMAIL, email_verified: true, name: 'Local test owner', picture: '', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: services.config.firebase.projectId, iss: 'https://accounts.google.com'};
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  await signInWithCredential(services.auth, GoogleAuthProvider.credential(`${encode({alg: 'none', typ: 'JWT'})}.${encode(payload)}.`));
}
export const logout = (services: FirebaseServices) => signOut(services.auth);
export function friendlyError(error: unknown): string {
  if(error instanceof z.ZodError)return error.issues.slice(0,3).map(issue=>issue.message).join(' ');
  const code = (error as {code?: string})?.code;
  const messages: Record<string, string> = {
    'auth/popup-closed-by-user': 'Google sign-in was closed. You can try again.',
    'auth/unauthorized-domain': 'This address has not been authorised for Google login. Add it to the Firebase project’s authorised domains.',
    'auth/network-request-failed': 'Google login could not be reached. Check your connection.',
    'permission-denied': 'Cloud access was denied. Your saved local work is retained.',
    'resource-exhausted': 'The cloud quota has been reached. Local work remains available.',
    'unavailable': 'Cloud sync is unavailable. Changes remain on this device.',
  };
  return (code && messages[code]) || (error instanceof Error ? error.message : 'Something went wrong. Your saved work has been retained.');
}
