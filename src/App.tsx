import { lazy, Suspense, useEffect } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import UpdatePrompt from './components/UpdatePrompt';
import { useTheme } from './hooks/useTheme';
import Home from './pages/Home';
import { autoSync } from './sync/auto';

// Cada sección se descarga al visitarla por primera vez (el service worker las precachea igualmente).
const Settings = lazy(() => import('./pages/Settings'));
const Library = lazy(() => import('./pages/Library'));
const DocumentView = lazy(() => import('./pages/DocumentView'));
const Generate = lazy(() => import('./pages/Generate'));
const Bank = lazy(() => import('./pages/Bank'));
const ExamRun = lazy(() => import('./pages/ExamRun'));
const ExamResult = lazy(() => import('./pages/ExamResult'));
const Materials = lazy(() => import('./pages/Materials'));
const Mistakes = lazy(() => import('./pages/Mistakes'));
const Stats = lazy(() => import('./pages/Stats'));

function NotFound() {
  return (
    <>
      <h1>Página no encontrada</h1>
      <p><Link to="/">Volver al inicio</Link></p>
    </>
  );
}

export default function App() {
  useTheme();
  useEffect(() => {
    // Primero el temario integrado (solo importa lo que falte) y luego la sincronización.
    void import('./library/bundled').then((m) => m.loadBundled()).finally(() => void autoSync());
  }, []);
  return (
    <Layout>
      <Suspense fallback={<p className="muted" role="status">Cargando…</p>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/configuracion" element={<Settings />} />
          <Route path="/biblioteca" element={<Library />} />
          <Route path="/biblioteca/:id" element={<DocumentView />} />
          <Route path="/generar" element={<Generate />} />
          <Route path="/banco" element={<Bank />} />
          <Route path="/examen/:id" element={<ExamRun />} />
          <Route path="/examen/:id/resultado" element={<ExamResult />} />
          <Route path="/material" element={<Materials />} />
          <Route path="/errores" element={<Mistakes />} />
          <Route path="/estadisticas" element={<Stats />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <UpdatePrompt />
    </Layout>
  );
}
