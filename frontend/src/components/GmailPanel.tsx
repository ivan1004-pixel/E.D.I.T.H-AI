import React, { useEffect, useState } from 'react';
import {
  Mail,
  RefreshCw,
  Send,
  ArrowLeft,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  Languages,
  AtSign,
  UserPlus,
  X,
} from 'lucide-react';
import {
  AuthStatus,
  deleteGmailMessage,
  deleteSavedContactApi,
  EmailDetail,
  EmailSummary,
  fetchGmailDetail,
  fetchGmailInbox,
  fetchSavedContacts,
  getGoogleLoginUrl,
  saveContactApi,
  SavedContact,
  sendGmailMessage,
  translateEmailApi,
} from '../services/api';

interface GmailPanelProps {
  authStatus?: AuthStatus | null;
  onActivityChange?: () => void;
}

export const GmailPanel: React.FC<GmailPanelProps> = ({ authStatus, onActivityChange }) => {
  const accounts = authStatus?.accounts || (authStatus?.email ? [authStatus.email] : []);

  const [connected, setConnected] = useState<boolean>(true);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [savedContacts, setSavedContacts] = useState<SavedContact[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estado de traducción de correo
  const [targetLang, setTargetLang] = useState<string>('Español');
  const [translating, setTranslating] = useState<boolean>(false);
  const [translatedBody, setTranslatedBody] = useState<string | null>(null);

  // Estado para redactar nuevo correo
  const [isComposing, setIsComposing] = useState<boolean>(false);
  const [fromAccount, setFromAccount] = useState<string>(accounts[0] || '');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  // Estado para guardar contacto rápido
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactName, setNewContactName] = useState('');

  useEffect(() => {
    loadInbox(selectedAccount);
    loadContacts();
  }, [selectedAccount]);

  useEffect(() => {
    if (accounts.length > 0 && !fromAccount) {
      setFromAccount(accounts[0]);
    }
  }, [accounts.join(',')]);

  const loadContacts = async () => {
    try {
      const list = await fetchSavedContacts();
      setSavedContacts(list);
    } catch {
      // Ignorar error silencioso
    }
  };

  const loadInbox = async (accountFilter = selectedAccount) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchGmailInbox(10, accountFilter);
      setConnected(res.connected);
      setEmails(res.emails);
      if (onActivityChange) onActivityChange();
    } catch (err: any) {
      setError(err?.message || 'Error al cargar los correos de Gmail.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEmail = async (emailItem: EmailSummary) => {
    setLoading(true);
    setError(null);
    setTranslatedBody(null);
    try {
      const detail = await fetchGmailDetail(emailItem.id, emailItem.accountEmail);
      setSelectedEmail(detail);
      if (onActivityChange) onActivityChange();
    } catch (err: any) {
      setError(err?.message || 'Error al leer el correo.');
    } finally {
      setLoading(false);
    }
  };

  const handleTranslateCurrentEmail = async () => {
    if (!selectedEmail) return;
    setTranslating(true);
    setError(null);
    try {
      const translated = await translateEmailApi({
        id: selectedEmail.id,
        account: selectedEmail.accountEmail,
        targetLanguage: targetLang,
      });
      setTranslatedBody(translated);
      if (onActivityChange) onActivityChange();
    } catch (err: any) {
      setError(err?.message || 'No se pudo traducir el correo.');
    } finally {
      setTranslating(false);
    }
  };

  const handleDeleteEmail = async (emailItem: EmailSummary, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setError(null);
    setSuccessMsg(null);
    try {
      await deleteGmailMessage(emailItem.id, emailItem.accountEmail);
      setSuccessMsg('Correo enviado a la papelera.');
      setEmails((prev) => prev.filter((em) => em.id !== emailItem.id));
      if (selectedEmail?.id === emailItem.id) {
        setSelectedEmail(null);
      }
      if (onActivityChange) onActivityChange();
    } catch (err: any) {
      setError(err?.message || 'No se pudo eliminar el correo.');
    }
  };

  const handleSaveQuickContact = async () => {
    if (!newContactEmail.trim()) return;
    setError(null);
    try {
      await saveContactApi(newContactEmail.trim(), newContactName.trim() || undefined);
      setNewContactEmail('');
      setNewContactName('');
      await loadContacts();
      setSuccessMsg('Correo guardado en tu agenda de contactos rápidos.');
    } catch (err: any) {
      setError(err?.message || 'Error al guardar el correo.');
    }
  };

  const handleRemoveSavedContact = async (email: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteSavedContactApi(email);
      setSavedContacts((prev) => prev.filter((c) => c.email !== email));
    } catch {
      // Ignorar error
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim() || !subject.trim() || !body.trim()) return;
    setSending(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await sendGmailMessage({
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
        account: fromAccount || accounts[0] || undefined,
      });
      setSuccessMsg('Correo enviado y destinatario guardado automáticamente.');
      setTo('');
      setSubject('');
      setBody('');
      setIsComposing(false);
      loadInbox();
      loadContacts();
    } catch (err: any) {
      setError(err?.message || 'No se pudo enviar el correo.');
    } finally {
      setSending(false);
    }
  };

  if (!connected) {
    return (
      <div className="panel-container">
        <div className="connect-card">
          <div className="connect-icon">
            <Mail size={36} />
          </div>
          <h2>Conecta tus cuentas de Gmail</h2>
          <p>
            Puedes conectar una o varias cuentas de correo para que Edith las controle, traduzca,
            envíe o limpie al mismo tiempo.
          </p>
          <button
            className="btn-orange"
            onClick={() => {
              window.location.href = getGoogleLoginUrl();
            }}
          >
            <ExternalLink size={16} />
            <span>Conectar cuenta de Gmail</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-container">
      <header className="panel-header">
        <div>
          <h2>Bandeja de Entrada Multi-Cuenta (Gmail)</h2>
          <p className="panel-subtitle">
            Controla todas tus cuentas conectadas, traduce correos con Gemini o envía mensajes
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn-secondary btn-sm"
            onClick={() => {
              window.location.href = getGoogleLoginUrl();
            }}
          >
            <Plus size={15} />
            <span>Añadir otra cuenta</span>
          </button>
          <button
            className="btn-primary btn-sm"
            onClick={() => {
              setSelectedEmail(null);
              setIsComposing(true);
              setSuccessMsg(null);
            }}
          >
            <Send size={14} />
            <span>Redactar correo</span>
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => loadInbox(selectedAccount)}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            <span>Actualizar</span>
          </button>
        </div>
      </header>

      {accounts.length > 0 && (
        <div className="filter-bar">
          <div className="filter-field">
            <label>Filtrar por cuenta:</label>
            <select
              className="account-select"
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
            >
              <option value="all">Todas las cuentas ({accounts.length})</option>
              {accounts.map((acc) => (
                <option key={acc} value={acc}>
                  {acc}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

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

      {isComposing ? (
        <div className="card-section">
          <div className="section-top-bar">
            <button className="btn-ghost btn-sm" onClick={() => setIsComposing(false)}>
              <ArrowLeft size={16} />
              <span>Volver al inbox</span>
            </button>
            <h3>Nuevo Correo</h3>
          </div>

          <form className="form-stack" onSubmit={handleSendEmail}>
            <div className="form-group">
              <label>Enviar desde tu cuenta de correo</label>
              <select
                className="account-select"
                value={fromAccount}
                onChange={(e) => setFromAccount(e.target.value)}
                required
              >
                {accounts.map((acc) => (
                  <option key={acc} value={acc}>
                    {acc}
                  </option>
                ))}
              </select>
            </div>

            {savedContacts.length > 0 && (
              <div className="form-group">
                <label>Correos guardados (haz clic en uno para no volver a escribirlo)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {savedContacts.map((c) => (
                    <button
                      key={c.email}
                      type="button"
                      className="btn-secondary btn-xs"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        background: to === c.email ? 'var(--accent-soft)' : '#fff',
                        borderColor: to === c.email ? 'var(--accent)' : 'var(--border-color)',
                      }}
                      onClick={() => setTo(c.email)}
                      title={`Seleccionar ${c.email}`}
                    >
                      <AtSign size={12} />
                      <span>
                        {c.name && c.name !== c.email.split('@')[0]
                          ? `${c.name} (${c.email})`
                          : c.email}
                      </span>
                      <span
                        onClick={(e) => handleRemoveSavedContact(c.email, e)}
                        style={{ marginLeft: 3, opacity: 0.65, display: 'inline-flex' }}
                        title="Quitar de correos guardados"
                      >
                        <X size={11} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Para (destinatario — se guardará automáticamente al enviar)</label>
              <input
                type="email"
                list="saved-contacts-datalist"
                placeholder="Selecciona arriba o escribe ejemplo@correo.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
              />
              <datalist id="saved-contacts-datalist">
                {savedContacts.map((c) => (
                  <option key={c.email} value={c.email}>
                    {c.name}
                  </option>
                ))}
              </datalist>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '8px 10px',
                borderRadius: '10px',
                background: 'rgba(0,0,0,0.025)',
              }}
            >
              <UserPlus size={14} />
              <input
                type="text"
                placeholder="Alias (ej. Trabajo, Juan)"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                style={{ flex: '1 1 130px', padding: '6px 9px', fontSize: '0.82rem' }}
              />
              <input
                type="email"
                placeholder="Guardar otro correo frecuente..."
                value={newContactEmail}
                onChange={(e) => setNewContactEmail(e.target.value)}
                style={{ flex: '2 1 180px', padding: '6px 9px', fontSize: '0.82rem' }}
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleSaveQuickContact}
              >
                <Plus size={13} />
                <span>Guardar correo</span>
              </button>
            </div>

            <div className="form-group">
              <label>Asunto</label>
              <input
                type="text"
                placeholder="Asunto del mensaje"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Mensaje</label>
              <textarea
                rows={7}
                placeholder="Escribe tu mensaje aquí..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setIsComposing(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={sending}>
                <Send size={15} />
                <span>{sending ? 'Enviando...' : 'Enviar correo'}</span>
              </button>
            </div>
          </form>
        </div>
      ) : selectedEmail ? (
        <div className="card-section">
          <div className="email-detail-toolbar">
            <button className="btn-ghost btn-sm" onClick={() => setSelectedEmail(null)}>
              <ArrowLeft size={16} />
              <span>Volver a la lista</span>
            </button>

            <div className="translate-controls">
              <select
                className="account-select"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
              >
                <option value="Español">Traducir a Español</option>
                <option value="Inglés">Traducir a Inglés</option>
                <option value="Francés">Traducir a Francés</option>
                <option value="Alemán">Traducir a Alemán</option>
                <option value="Portugués">Traducir a Portugués</option>
              </select>
              <button
                type="button"
                className="btn-orange btn-sm"
                onClick={handleTranslateCurrentEmail}
                disabled={translating}
              >
                <Languages size={14} />
                <span>{translating ? 'Traduciendo...' : 'Traducir correo'}</span>
              </button>
              <button
                type="button"
                className="btn-danger-ghost btn-sm"
                onClick={() => handleDeleteEmail(selectedEmail)}
              >
                <Trash2 size={14} />
                <span>Eliminar</span>
              </button>
            </div>
          </div>

          <div className="email-detail">
            <h3 className="email-detail-subject">{selectedEmail.subject}</h3>
            <div className="email-detail-meta">
              {selectedEmail.accountEmail && (
                <div>
                  <strong>Cuenta:</strong>{' '}
                  <span className="account-pill">{selectedEmail.accountEmail}</span>
                </div>
              )}
              <div>
                <strong>De:</strong> {selectedEmail.from}
              </div>
              {selectedEmail.to && (
                <div>
                  <strong>Para:</strong> {selectedEmail.to}
                </div>
              )}
              <div>
                <strong>Fecha:</strong> {selectedEmail.date}
              </div>
            </div>

            {translatedBody && (
              <div className="translated-box">
                <div className="translated-box-header">
                  <Languages size={15} />
                  <strong>Traducción ({targetLang}):</strong>
                </div>
                <div className="email-detail-body">{translatedBody}</div>
              </div>
            )}

            <div className="email-detail-body">{selectedEmail.body}</div>
          </div>
        </div>
      ) : (
        <div className="list-container">
          {loading && emails.length === 0 ? (
            <div className="empty-state">Cargando tus correos de Gmail...</div>
          ) : emails.length === 0 ? (
            <div className="empty-state">No se encontraron correos en tu bandeja de entrada.</div>
          ) : (
            emails.map((email) => (
              <div
                key={`${email.accountEmail}-${email.id}`}
                className="email-item"
                onClick={() => handleOpenEmail(email)}
              >
                <div className="email-item-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="email-from">{email.from}</span>
                    {email.accountEmail && (
                      <span className="account-pill">{email.accountEmail}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="email-date">{email.date}</span>
                    <button
                      type="button"
                      className="btn-danger-ghost btn-xs"
                      onClick={(e) => handleDeleteEmail(email, e)}
                      title="Enviar a la papelera"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="email-subject">{email.subject}</div>
                <div className="email-snippet">{email.snippet}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
