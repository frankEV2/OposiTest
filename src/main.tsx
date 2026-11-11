import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import WorkspacePicker from './components/WorkspacePicker';
import { currentWorkspace } from './workspaces';
import './styles/global.css';

// La app (y la base de datos de la oposición) solo se carga una vez elegida la oposición.
const App = lazy(() => import('./App'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {currentWorkspace() ? (
      <HashRouter>
        <Suspense fallback={null}><App /></Suspense>
      </HashRouter>
    ) : <WorkspacePicker />}
  </StrictMode>,
);
