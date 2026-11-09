import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { ChatPage } from './pages/ChatPage';
import { GmailPanel } from './components/GmailPanel';
import { CalendarPanel } from './components/CalendarPanel';
import { SettingsPage } from './pages/SettingsPage';
import {
  ApiUsageSummary,
  AuthStatus,
  ConversationItem,
  createConversationApi,
  deleteConversationApi,
  fetchApiUsage,
  fetchAuthStatus,
  fetchConversations,
  logoutGoogle,
} from './services/api';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('default');
  const [apiUsage, setApiUsage] = useState<ApiUsageSummary | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [bannerType, setBannerType] = useState<'success' | 'error'>('success');

  useEffect(() => {
    refreshAllState();

    const params = new URLSearchParams(window.location.search);
    const authParam = params.get('auth');
    const reasonParam = params.get('reason');
    if (authParam === 'success') {
      setBannerType('success');
      setBannerMessage('Cuenta de Google conectada correctamente.');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (authParam === 'error') {
      setBannerType('error');
      setBannerMessage(
        `No se pudo completar la conexión con Google: ${reasonParam || 'revisa tus credenciales OAuth'}.`
      );
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const refreshAllState = async () => {
    await Promise.all([checkStatus(), loadConversations(), loadApiUsage()]);
  };

  const checkStatus = async () => {
    try {
      const status = await fetchAuthStatus();
      setAuthStatus(status);
    } catch (err) {
      console.error('Error al verificar estado:', err);
    }
  };

  const loadConversations = async () => {
    try {
      const list = await fetchConversations();
      setConversations(list);
      if (list.length > 0 && !list.some((c) => c.id === activeConversationId)) {
        setActiveConversationId(list[0].id);
      }
    } catch (err) {
      console.error('Error al cargar conversaciones:', err);
    }
  };

  const loadApiUsage = async () => {
    try {
      const usage = await fetchApiUsage();
      setApiUsage(usage);
    } catch (err) {
      console.error('Error al cargar uso de API:', err);
    }
  };

  const handleNewConversation = async () => {
    try {
      const created = await createConversationApi('Nuevo Chat');
      setConversations((prev) => [created, ...prev]);
      setActiveConversationId(created.id);
      setActiveTab('chat');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteConversationApi(id);
      const updated = await fetchConversations();
      setConversations(updated);
      if (activeConversationId === id) {
        setActiveConversationId(updated[0]?.id || 'default');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = async (email?: string) => {
    try {
      await logoutGoogle(email);
      await checkStatus();
      setBannerMessage(
        email ? `Cuenta ${email} desconectada.` : 'Cuentas de Google desconectadas.'
      );
    } catch (err) {
      console.error(err);
    }
  };

  const currentConversation = conversations.find((c) => c.id === activeConversationId);

  return (
    <div className="app-layout">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        authStatus={authStatus}
        onLogout={handleLogout}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        apiUsage={apiUsage}
      />

      <main className="main-content">
        {bannerMessage && (
          <div className="top-notification" onClick={() => setBannerMessage(null)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              {bannerType === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
              {bannerMessage}
            </span>
            <button className="close-toast" aria-label="Cerrar notificación">
              <X size={15} />
            </button>
          </div>
        )}

        {activeTab === 'chat' && (
          <ChatPage
            conversationId={activeConversationId}
            conversationTitle={currentConversation?.title}
            onActivityChange={refreshAllState}
            onNewConversation={handleNewConversation}
          />
        )}
        {activeTab === 'gmail' && (
          <GmailPanel authStatus={authStatus} onActivityChange={refreshAllState} />
        )}
        {activeTab === 'calendar' && (
          <CalendarPanel authStatus={authStatus} onActivityChange={refreshAllState} />
        )}
        {activeTab === 'settings' && (
          <SettingsPage
            authStatus={authStatus}
            onLogout={handleLogout}
            apiUsage={apiUsage}
            onRefreshUsage={loadApiUsage}
          />
        )}
      </main>
    </div>
  );
};

export default App;
