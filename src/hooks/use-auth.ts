import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { friendlyError, initializeServices, isOwner, loadRuntimeConfig, logout, type FirebaseServices, type RuntimeConfig } from '@/integrations/firebase';

export type AuthState = {loading: boolean; config: RuntimeConfig | null; services: FirebaseServices | null; user: User | null; error: string};
export function useAuth() {
  const [state, setState] = useState<AuthState>({loading: true, config: null, services: null, user: null, error: ''});
  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    void (async () => {
      try {
        const config = await loadRuntimeConfig();
        const services = await initializeServices(config);
        if (cancelled) return;
        if (!services) {setState({loading: false, config, services: null, user: null, error: ''}); return;}
        unsubscribe = onAuthStateChanged(services.auth, user => {
          if (cancelled) return;
          if (user && !isOwner(user)) {
            setState({loading: false, config, services, user: null, error: 'This private workspace is available only to its verified Google owner.'});
            void logout(services); return;
          }
          setState(previous => ({loading: false, config, services, user, error: user ? '' : previous.error}));
        }, error => {if (!cancelled) setState({loading: false, config, services, user: null, error: friendlyError(error)});});
      } catch (error) {
        if (!cancelled) setState({loading: false, config: null, services: null, user: null, error: friendlyError(error)});
      }
    })();
    return () => {cancelled = true; unsubscribe();};
  }, []);
  return state;
}
