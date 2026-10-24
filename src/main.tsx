import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { WindowChrome } from './components/WindowChrome';
import { TooltipProvider } from './components/ui/tooltip';
import './styles.css';
import './app/desktop-layout.css';
import './app/window-chrome.css';
import './app/appearance.css';

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: boolean}> {
  state = {error: false};
  static getDerivedStateFromError() {return {error: true};}
  render() {return this.state.error ? <main className="recovery-screen"><h1>Let’s get you back to your adventure.</h1><p>The workspace could not open. Your saved data has not been cleared.</p><button className="button button-primary" onClick={() => location.reload()}>Reload Rivet</button></main> : this.props.children;}
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><TooltipProvider delayDuration={350}><WindowChrome/><ErrorBoundary><BrowserRouter><App/></BrowserRouter></ErrorBoundary></TooltipProvider></React.StrictMode>);
