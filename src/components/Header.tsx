import React from 'react';

export type AppTab = 'dash' | 'reg' | 'lista' | 'ing' | 'cfg';

interface HeaderProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  canInstall: boolean;
  onInstall: () => void;
  userEmail: string;
  onSignOut: () => void;
  // Reg context
  fecha: string;
  onFechaChange: (v: string) => void;
  nombre: string;
  onNombreChange: (v: string) => void;
  turno: string;
  onTurnoChange: (v: string) => void;
  // Ing context
  iFecha: string;
  onIFechaChange: (v: string) => void;
  iNombre: string;
  onINombreChange: (v: string) => void;
  iTurno: string;
  onITurnoChange: (v: string) => void;
  nombres: string[];
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  canInstall,
  onInstall,
  userEmail,
  onSignOut,
  fecha,
  onFechaChange,
  nombre,
  onNombreChange,
  turno,
  onTurnoChange,
  iFecha,
  onIFechaChange,
  iNombre,
  onINombreChange,
  iTurno,
  onITurnoChange,
  nombres,
}) => {
  const shortUser = userEmail ? userEmail.split('@')[0] : '';

  return (
    <header className="top">
      <div className="wrap bar">
        <div className="brand">
          <h1>Control de Entregas</h1>
          {canInstall && (
            <button className="btn-s" id="btnInstalar" type="button" onClick={onInstall}>
              Instalar app
            </button>
          )}
        </div>

        <nav className="tabs" id="tabs" aria-label="Secciones">
          <button
            className={`tab ${activeTab === 'dash' ? 'active' : ''}`}
            type="button"
            onClick={() => onTabChange('dash')}
          >
            Tablero
          </button>
          <button
            className={`tab ${activeTab === 'reg' ? 'active' : ''}`}
            type="button"
            onClick={() => onTabChange('reg')}
          >
            Registrar
          </button>
          <button
            className={`tab ${activeTab === 'lista' ? 'active' : ''}`}
            type="button"
            onClick={() => onTabChange('lista')}
          >
            Registros
          </button>
          <button
            className={`tab ${activeTab === 'ing' ? 'active' : ''}`}
            type="button"
            onClick={() => onTabChange('ing')}
          >
            Ingresos
          </button>
          <button
            className={`tab ${activeTab === 'cfg' ? 'active' : ''}`}
            type="button"
            onClick={() => onTabChange('cfg')}
          >
            Config
          </button>
        </nav>

        <div className="user-bar">
          {shortUser && (
            <span className="user-id" title={userEmail}>
              {shortUser}
            </span>
          )}
          <button
            type="button"
            className="btn-s"
            style={{ minHeight: '34px', padding: '4px 10px', fontSize: '0.8rem' }}
            onClick={onSignOut}
          >
            Salir
          </button>
        </div>

        {(activeTab === 'reg' || activeTab === 'ing') && (
          <div className="ctx" id="ctx">
            {activeTab === 'reg' && (
              <div className="ctxg" id="ctxReg">
                <div className="cf">
                  <label htmlFor="fecha">Fecha de registro</label>
                  <input
                    type="date"
                    id="fecha"
                    value={fecha}
                    onChange={(e) => onFechaChange(e.target.value)}
                  />
                </div>
                <div className="cf">
                  <label htmlFor="nombre">Habilitador</label>
                  <select
                    id="nombre"
                    value={nombre}
                    onChange={(e) => onNombreChange(e.target.value)}
                  >
                    <option value="">
                      {nombres.length ? 'Selecciona…' : '(agrega habilitadores en Config)'}
                    </option>
                    {nombres.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cf">
                  <label>Turno</label>
                  <div className="chips seg" id="turnoChips">
                    <button
                      className={`chip ${turno === 'Día' ? 'active' : ''}`}
                      type="button"
                      onClick={() => onTurnoChange('Día')}
                    >
                      Día
                    </button>
                    <button
                      className={`chip ${turno === 'Noche' ? 'active' : ''}`}
                      type="button"
                      onClick={() => onTurnoChange('Noche')}
                    >
                      Noche
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'ing' && (
              <div className="ctxg" id="ctxIng">
                <div className="cf">
                  <label htmlFor="iFecha">Fecha de ingreso</label>
                  <input
                    type="date"
                    id="iFecha"
                    value={iFecha}
                    onChange={(e) => onIFechaChange(e.target.value)}
                  />
                </div>
                <div className="cf">
                  <label htmlFor="iNombre">Habilitador</label>
                  <select
                    id="iNombre"
                    value={iNombre}
                    onChange={(e) => onINombreChange(e.target.value)}
                  >
                    <option value="">
                      {nombres.length ? 'Selecciona…' : '(agrega habilitadores en Config)'}
                    </option>
                    {nombres.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cf">
                  <label>Turno</label>
                  <div className="chips seg" id="iTurno">
                    <button
                      className={`chip ${iTurno === 'Día' ? 'active' : ''}`}
                      type="button"
                      onClick={() => onITurnoChange('Día')}
                    >
                      Día
                    </button>
                    <button
                      className={`chip ${iTurno === 'Noche' ? 'active' : ''}`}
                      type="button"
                      onClick={() => onITurnoChange('Noche')}
                    >
                      Noche
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
