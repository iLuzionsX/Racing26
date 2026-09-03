import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class StartupErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application startup/render failure', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <pre id="startup-error" style={{ margin: 0, minHeight: '100vh', padding: 20, boxSizing: 'border-box', background: '#111827', color: '#fca5a5', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
          {`Application failed to start:\n${this.state.error.stack || this.state.error.message}`}
        </pre>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StartupErrorBoundary>
    <StrictMode>
      <App />
    </StrictMode>
  </StartupErrorBoundary>,
);
