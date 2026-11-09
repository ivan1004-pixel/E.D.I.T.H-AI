import React, { useEffect, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  AuthStatus,
  CalendarEventItem,
  createCalendarEventApi,
  deleteCalendarEventApi,
  fetchCalendarEvents,
  getGoogleLoginUrl,
} from '../services/api';

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface CalendarPanelProps {
  authStatus?: AuthStatus | null;
  onActivityChange?: () => void;
}

export const CalendarPanel: React.FC<CalendarPanelProps> = ({ authStatus, onActivityChange }) => {
  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const accounts = authStatus?.accounts || [];

  const [connected, setConnected] = useState<boolean>(true);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>(formatDateInput(today));
  const [toDate, setToDate] = useState<string>(formatDateInput(nextWeek));
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estado para crear un nuevo evento
  const [showCreate, setShowCreate] = useState<boolean>(false);
  const [targetAccount, setTargetAccount] = useState<string>('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (accounts.length > 0 && !targetAccount) {
      setTargetAccount(accounts[0]);
    }
  }, [accounts.join(',')]);

  useEffect(() => {
    loadEvents();
  }, [fromDate, toDate, selectedAccount]);

  const loadEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCalendarEvents(fromDate, toDate, selectedAccount);
      setConnected(res.connected);
      setEvents(res.events);
      onActivityChange?.();
    } catch (err: any) {
      setError(err?.message || 'Error al consultar eventos de Google Calendar.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !start || !end) return;
    const chosenAccount = targetAccount || accounts[0];
    if (!chosenAccount) {
      setError('Selecciona primero la cuenta de correo donde deseas crear el evento.');
      return;
    }
    setCreating(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const startIso = new Date(start).toISOString();
      const endIso = new Date(end).toISOString();
      const created = await createCalendarEventApi({
        title: title.trim(),
        start: startIso,
        end: endIso,
        description: description.trim() || undefined,
        account: chosenAccount,
      });
      setSuccessMsg(`Evento creado en el calendario de ${created.accountEmail || chosenAccount}.`);
      setTitle('');
      setStart('');
      setEnd('');
      setDescription('');
      setShowCreate(false);
      loadEvents();
    } catch (err: any) {
      setError(err?.message || 'No se pudo crear el evento.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteEvent = async (id: string, accountEmail?: string) => {
    setError(null);
    setSuccessMsg(null);
    try {
      await deleteCalendarEventApi(id, accountEmail);
      setSuccessMsg('Evento eliminado correctamente.');
      setEvents((prev) => prev.filter((ev) => ev.id !== id));
      onActivityChange?.();
    } catch (err: any) {
      setError(err?.message || 'No se pudo eliminar el evento.');
    }
  };

  if (!connected) {
    return (
      <div className="panel-container">
        <div className="connect-card">
          <div className="connect-icon">
            <CalendarIcon size={36} />
          </div>
          <h2>Conecta tu Google Calendar</h2>
          <p>
            Conecta tu cuenta de Google para que Edith pueda consultar tus eventos reales, agendar
            reuniones o liberar espacio en tu calendario.
          </p>
          <button
            className="btn-primary"
            onClick={() => {
              window.location.href = getGoogleLoginUrl();
            }}
          >
            <ExternalLink size={16} />
            <span>Conectar Google Calendar</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-container">
      <header className="panel-header">
        <div>
          <h2>Agenda (Google Calendar)</h2>
          <p className="panel-subtitle">Consulta, crea o elimina eventos reales de tu calendario</p>
        </div>
        <div className="header-actions">
          <button
            className="btn-primary btn-sm"
            onClick={() => {
              setShowCreate((prev) => !prev);
              setSuccessMsg(null);
            }}
          >
            <Plus size={15} />
            <span>{showCreate ? 'Cerrar formulario' : 'Nuevo evento'}</span>
          </button>
          <button className="btn-secondary btn-sm" onClick={loadEvents} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            <span>Actualizar</span>
          </button>
        </div>
      </header>

      <div className="filter-bar">
        <div className="filter-field">
          <label>Cuenta de correo:</label>
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: '#fff',
              fontSize: '0.84rem',
            }}
          >
            <option value="all">Todas las cuentas ({accounts.length})</option>
            {accounts.map((acc) => (
              <option key={acc} value={acc}>
                {acc}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>Desde:</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label>Hasta:</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </div>

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

      {showCreate && (
        <div className="card-section">
          <h3>Agendar nuevo evento</h3>
          <form className="form-stack" onSubmit={handleCreateEvent}>
            <div className="form-group">
              <label>¿En qué cuenta de correo deseas agendarlo?</label>
              <select
                value={targetAccount}
                onChange={(e) => setTargetAccount(e.target.value)}
                required
                style={{
                  padding: '9px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  background: '#fff',
                  fontSize: '0.88rem',
                }}
              >
                {accounts.map((acc) => (
                  <option key={acc} value={acc}>
                    {acc}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Título del evento</label>
              <input
                type="text"
                placeholder="Ej. Reunión Prueba Edith"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Inicio</label>
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Fin</label>
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <label>Descripción (opcional)</label>
              <textarea
                rows={3}
                placeholder="Notas o detalles de la reunión..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={creating}>
                <Plus size={15} />
                <span>{creating ? 'Guardando...' : 'Crear evento'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="list-container">
        {loading && events.length === 0 ? (
          <div className="empty-state">Consultando tu Google Calendar...</div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            No tienes eventos programados entre {fromDate} y {toDate}.
          </div>
        ) : (
          events.map((ev) => (
            <div key={`${ev.accountEmail || 'cal'}-${ev.id}`} className="event-item">
              <div className="event-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h4 className="event-title">{ev.title}</h4>
                  {ev.accountEmail && (
                    <span className="email-account-tag">{ev.accountEmail}</span>
                  )}
                </div>
                <div className="event-time">
                  <Clock size={14} />
                  <span>
                    {new Date(ev.start).toLocaleString('es-MX', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}{' '}
                    —{' '}
                    {new Date(ev.end).toLocaleString('es-MX', {
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                {ev.description && <p className="event-desc">{ev.description}</p>}
              </div>
              <div className="event-actions">
                <button
                  className="btn-danger-ghost btn-sm"
                  onClick={() => handleDeleteEvent(ev.id, ev.accountEmail)}
                  title="Eliminar evento"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

