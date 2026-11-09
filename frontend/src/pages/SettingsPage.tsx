import React, { useEffect, useState } from 'react';
import {
  Brain,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  LogOut,
  Activity,
  RefreshCw,
} from 'lucide-react';
import {
  ApiUsageSummary,
  AuthStatus,
  deleteMemoryApi,
  fetchMemory,
  getGoogleLoginUrl,
  MemoryItem,
  saveMemoryApi,
} from '../services/api';

interface SettingsPageProps {
  authStatus: AuthStatus | null;
  onLogout: (email?: string) => void;
  apiUsage: ApiUsageSummary | null;
  onRefreshUsage: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  authStatus,
  onLogout,
  apiUsage,
  onRefreshUsage,
}) => {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [keyInput, setKeyInput] = useState('');
  const [valueInput, setValueInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const accounts = authStatus?.accounts || (authStatus?.email ? [authStatus.email] : []);

  useEffect(() => {
    loadMemories();
  }, []);

  const loadMemories = async () => {
    setLoading(true);
    try {
      const items = await fetchMemory();
      setMemories(items);
    } catch (err: any) {
      setError(err?.message || 'Error al cargar la memoria.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim() || !valueInput.trim()) return;
    setError(null);
    setSuccessMsg(null);
    try {
      await saveMemoryApi(keyInput.trim(), valueInput.trim());
      setKeyInput('');
      setValueInput('');
      setSuccessMsg('Recuerdo guardado en SQLite.');
      loadMemories();
    } catch (err: any) {
      setError(err?.message || 'Error al guardar en memoria.');
    }
  };

  const handleDeleteMemory = async (key: string) => {
    setError(null);
    setSuccessMsg(null);
    try {
      await deleteMemoryApi(key);
      setMemories((prev) => prev.filter((m) => m.key !== key));
      setSuccessMsg(`Recuerdo "${key}" eliminado.`);
    } catch (err: any) {
      setError(err?.message || 'No se pudo eliminar el recuerdo.');
    }
  };

  return (
    <div className="panel-container">
      <header className="panel-header">
        <div>
          <h2>Cuotas de API, Cuentas y Memoria de Ivan</h2>
          <p className="panel-subtitle">
            Monitorea tu consumo gratuito diario ($0.00), administra varias cuentas de Gmail y edita
            la memoria SQLite
          </p>
        </div>
        <button className="btn-secondary btn-sm" onClick={onRefreshUsage}>
          <RefreshCw size={14} />
          <span>Actualizar cuotas</span>
        </button>
      </header>

      {error && (
        <div className="alert-banner error">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="alert-banner success">
          <CheckCircle2 size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="settings-grid">
        {/* MONITOR DE CUOTA GRATUITA PARA NO PAGAR */}
        <div className="card-section">
          <h3>
            <Activity size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            Consumo de API Hoy ({apiUsage?.date || 'Hoy'}) — Plan Gratuito ($0.00)
          </h3>
          <p className="muted-text">
            Límites seguros diarios del Free Tier de Google para que nunca te cobren en Gemini,
            Gmail ni Calendar.
          </p>

          {apiUsage ? (
            <div className="usage-cards-grid">
              {(['gemini', 'gmail', 'calendar'] as const).map((svcKey) => {
                const s = apiUsage.services[svcKey];
                return (
                  <div key={svcKey} className="usage-detail-card">
                    <div className="usage-card-top">
                      <strong>{s.label}</strong>
                      <span className="usage-pct-badge">{s.percentUsed}% usado</span>
                    </div>
                    <div className="usage-numbers">
                      <div>
                        <span>Usado hoy:</span> <strong>{s.usedRequests} peticiones</strong>
                      </div>
                      <div>
                        <span>Te quedan gratis hoy:</span>{' '}
                        <strong className="remaining-highlight">
                          {s.remainingRequests} peticiones
                        </strong>
                      </div>
                      {s.limitTokens > 0 && (
                        <div>
                          <span>Tokens Gemini hoy:</span>{' '}
                          <strong>
                            {s.usedTokens.toLocaleString()} / {s.limitTokens.toLocaleString()} (quedan{' '}
                            {s.remainingTokens.toLocaleString()})
                          </strong>
                        </div>
                      )}
                    </div>
                    <div className="quota-progress-bar lg">
                      <div
                        className="quota-progress-fill"
                        style={{ width: `${Math.max(2, s.percentUsed)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted-text">Cargando estadísticas de uso...</p>
          )}
        </div>

        {/* MULTI-CUENTA GOOGLE OAUTH */}
        <div className="card-section">
          <h3>Cuentas de Correo Conectadas ({accounts.length})</h3>
          <p className="muted-text">
            Puedes añadir varios correos de Gmail para que Edith los consulte, traduzca, envíe o
            limpie al mismo tiempo. Recuerda añadir cada correo como <em>Test User</em> en Google
            Cloud Console.
          </p>

          {accounts.length > 0 && (
            <div className="memory-list" style={{ marginBottom: 14 }}>
              {accounts.map((acc) => (
                <div key={acc} className="memory-item">
                  <div>
                    <span className="memory-key">CUENTA CONECTADA</span>
                    <p className="memory-value">{acc}</p>
                  </div>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => onLogout(acc)}
                    title="Desconectar esta cuenta"
                  >
                    <LogOut size={14} />
                    <span>Quitar</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="form-actions">
            <button
              className="btn-orange"
              onClick={() => {
                window.location.href = getGoogleLoginUrl();
              }}
            >
              <ExternalLink size={15} />
              <span>Añadir otra cuenta de Google (Gmail / Calendar)</span>
            </button>
          </div>
        </div>

        {/* MEMORIA SQLITE */}
        <div className="card-section">
          <h3>
            <Brain size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            Agregar dato a la memoria de Edith
          </h3>
          <p className="muted-text">
            También puedes decirle directamente en el chat: <em>"Recuerda que..."</em>
          </p>
          <form className="form-stack" onSubmit={handleSaveMemory}>
            <div className="form-row">
              <div className="form-group">
                <label>Clave (ej. nombre_usuario, cafe_favorito)</label>
                <input
                  type="text"
                  placeholder="preferencia_horario"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Valor a recordar</label>
                <input
                  type="text"
                  placeholder="Reuniones después de las 10:00 AM"
                  value={valueInput}
                  onChange={(e) => setValueInput(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary btn-sm">
                <Plus size={15} />
                <span>Guardar en memoria</span>
              </button>
            </div>
          </form>
        </div>

        <div className="card-section">
          <h3>Memoria actual en SQLite ({memories.length})</h3>
          {loading ? (
            <p className="muted-text">Cargando memoria...</p>
          ) : memories.length === 0 ? (
            <p className="muted-text">No hay recuerdos guardados todavía.</p>
          ) : (
            <div className="memory-list">
              {memories.map((item) => (
                <div key={item.key} className="memory-item">
                  <div>
                    <span className="memory-key">{item.key}</span>
                    <p className="memory-value">{item.value}</p>
                    <span className="memory-date">
                      Actualizado: {new Date(item.updated_at).toLocaleString('es-MX')}
                    </span>
                  </div>
                  <button
                    className="btn-danger-ghost btn-sm"
                    onClick={() => handleDeleteMemory(item.key)}
                    title="Eliminar recuerdo"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
