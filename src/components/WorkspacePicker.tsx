import { chooseWorkspace, lastWorkspaceId, WORKSPACES } from '../workspaces';

/** Pantalla inicial: elegir oposición. No usa la base de datos (se abre después, la de la elegida). */
export default function WorkspacePicker() {
  const last = lastWorkspaceId();
  return (
    <div className="picker">
      <header className="picker-head">
        <div className="brand">Oposi<span>Test</span></div>
        <h1>¿Qué oposición quieres preparar?</h1>
        <p className="sub">Cada oposición tiene su propio temario, banco de preguntas, resultados y estadísticas.</p>
      </header>
      <div className="picker-grid">
        {WORKSPACES.map((w) => (
          <button key={w.id} className="picker-card" style={{ '--accent': w.accent } as React.CSSProperties}
            onClick={() => chooseWorkspace(w.id)}>
            <span className="picker-org">{w.organismo}</span>
            <span className="picker-name">{w.nombre}</span>
            <span className="picker-go">{w.id === last ? 'Continuar →' : 'Entrar →'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
