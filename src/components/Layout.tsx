import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV } from '../routes';
import InstallApp from './InstallApp';
import { activeWorkspace, leaveWorkspace } from '../workspaces';

export default function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const ws = activeWorkspace();
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="app">
      <header className="topbar">
        <button onClick={() => setOpen(true)} aria-label="Abrir menú" aria-expanded={open} aria-controls="menu">☰</button>
        <strong title={ws.organismo}>{ws.nombre}</strong>
        <span style={{ width: 40 }} />
      </header>
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}
      <aside id="menu" className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">Oposi<span>Test</span></div>
        <div className="ws-box" style={{ borderColor: ws.accent }}>
          <small>{ws.organismo}</small>
          <strong>{ws.nombre}</strong>
          <button className="link" onClick={leaveWorkspace}>⇄ Cambiar oposición</button>
        </div>
        <nav className="nav" aria-label="Secciones">
          {NAV.map((n, i) => (
            <NavLink key={n.path} to={n.path} end={n.path === '/'}>
              <span className="num">{i + 1}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: '12px 16px' }}><InstallApp /></div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
