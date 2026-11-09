import React from 'react';
import {
  MessageSquare,
  Mail,
  Calendar,
  CheckCircle2,
  AlertCircle,
  LogOut,
  Brain,
  ChevronUp,
  Plus,
  Trash2,
  Activity,
} from 'lucide-react';
import {
  ApiUsageSummary,
  AuthStatus,
  ConversationItem,
  getGoogleLoginUrl,
} from '../services/api';

export type ActiveTab = 'chat' | 'gmail' | 'calendar' | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  authStatus: AuthStatus | null;
  onLogout: (email?: string) => void;
  conversations: ConversationItem[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
  apiUsage: ApiUsageSummary | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  authStatus,
  onLogout,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  apiUsage,
}) => {
  const handleConnectGoogle = () => {
    window.location.href = getGoogleLoginUrl();
  };

  const accounts = authStatus?.accounts || (authStatus?.email ? [authStatus.email] : []);
  const geminiUsage = apiUsage?.services.gemini;
  const gmailUsage = apiUsage?.services.gmail;
  const calUsage = apiUsage?.services.calendar;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="parallel-globe" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <h1 className="brand-title">Edith AI</h1>
          <span className="brand-subtitle">Asistente Personal de Ivan</span>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-label">WEB TOOLS</div>
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === 'gmail' ? 'active' : ''}`}
            onClick={() => onSelectTab('gmail')}
          >
            <Mail size={15} />
            <span>Gmail Inbox ({accounts.length})</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'calendar' ? 'active' : ''}`}
            onClick={() => onSelectTab('calendar')}
          >
            <Calendar size={15} />
            <span>Calendar Events</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => onSelectTab('settings')}
          >
            <Brain size={15} />
            <span>Memoria y Cuotas API</span>
          </button>
        </nav>
      </div>

      <div className="sidebar-section chats-section">
        <div className="sidebar-section-row">
          <span className="sidebar-section-label" style={{ padding: 0 }}>
            CHATS DE IVAN
          </span>
          <button
            type="button"
            className="new-chat-mini-btn"
            onClick={onNewConversation}
            title="Crear nuevo chat"
          >
            <Plus size={13} />
            <span>Nuevo</span>
          </button>
        </div>

        <div className="conversations-list">
          {conversations.map((conv) => {
            const isSelected = activeTab === 'chat' && activeConversationId === conv.id;
            return (
              <div
                key={conv.id}
                className={`conv-item ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  onSelectTab('chat');
                  onSelectConversation(conv.id);
                }}
              >
                <MessageSquare size={14} className="conv-icon" />
                <span className="conv-title">{conv.title}</span>
                {conversations.length > 1 && conv.id !== 'default' && (
                  <button
                    type="button"
                    className="conv-delete-btn"
                    onClick={(e) => onDeleteConversation(conv.id, e)}
                    title="Eliminar conversación"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-footer">
        {geminiUsage && (
          <div
            className="quota-mini-card"
            onClick={() => onSelectTab('settings')}
            title="Haz clic para ver el detalle completo de tus cuotas gratuitas"
          >
            <div className="quota-mini-top">
              <span className="quota-mini-title">
                <Activity size={12} /> Cuota Gratis Hoy
              </span>
              <span className="quota-mini-badge">$0.00</span>
            </div>
            <div className="quota-mini-row">
              <span>Gemini:</span>
              <strong>
                {geminiUsage.usedRequests} / {geminiUsage.limitRequests} disp: {geminiUsage.remainingRequests}
              </strong>
            </div>
            <div className="quota-progress-bar">
              <div
                className="quota-progress-fill"
                style={{ width: `${Math.max(2, geminiUsage.percentUsed)}%` }}
              />
            </div>
            <div className="quota-mini-sub">
              Gmail: {gmailUsage?.usedRequests || 0}/{gmailUsage?.limitRequests || 2500} · Cal:{' '}
              {calUsage?.usedRequests || 0}/{calUsage?.limitRequests || 2500}
            </div>
          </div>
        )}

        <div className="user-profile-box">
          <div className="user-profile-info">
            <span className="user-name">Ivan</span>
            <span className="user-role">Admin · Gemini 3.5 Flash</span>
          </div>
          <ChevronUp size={15} className="user-chevron" />
        </div>

        <div className="google-status-card">
          <div className="status-header">
            {accounts.length > 0 ? (
              <>
                <CheckCircle2 size={14} className="status-icon connected" />
                <span className="status-text">Cuentas ({accounts.length})</span>
              </>
            ) : (
              <>
                <AlertCircle size={14} className="status-icon disconnected" />
                <span className="status-text">Sin cuentas</span>
              </>
            )}
          </div>

          {accounts.length > 0 && (
            <div className="accounts-mini-list">
              {accounts.map((acc) => (
                <div key={acc} className="status-connected-row">
                  <span className="status-email" title={acc}>
                    {acc}
                  </span>
                  <button
                    className="btn-ghost btn-xs"
                    onClick={() => onLogout(acc)}
                    title={`Desconectar ${acc}`}
                  >
                    <LogOut size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button className="btn-orange btn-sm full-width" onClick={handleConnectGoogle}>
            <Plus size={13} />
            <span>{accounts.length > 0 ? 'Añadir otro correo' : 'Conectar Google'}</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
