import { useTheme } from '@/hooks/use-theme';
import { WorkspaceScreen } from './WorkspaceScreen';
import { DesignSystem } from '@/components/DesignSystem';
export function App(){const theme=useTheme();if(!window.rivet)return <main className="recovery-screen"><h1>Rivet Desktop</h1><p>Open the Electron app to use your local SQLite workspace.</p></main>;return location.pathname==='/design-system'?<DesignSystem/>:<WorkspaceScreen theme={theme}/>;}
