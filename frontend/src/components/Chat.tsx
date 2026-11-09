import React, { useEffect, useState } from 'react';
import { RotateCcw, Settings2, AlertTriangle, FileCode, Plus } from 'lucide-react';
import {
  ChatMessage,
  clearChatHistoryApi,
  fetchChatHistory,
  sendChatMessage,
} from '../services/api';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

interface ChatProps {
  conversationId: string;
  conversationTitle?: string;
  onActivityChange?: () => void;
  onNewConversation?: () => void;
}

export const Chat: React.FC<ChatProps> = ({
  conversationId,
  conversationTitle,
  onActivityChange,
  onNewConversation,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  useEffect(() => {
    loadHistory();
  }, [conversationId]);

  const loadHistory = async () => {
    try {
      const history = await fetchChatHistory('ivan', conversationId);
      setMessages(history);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleSend = async (text: string) => {
    setError(null);
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const res = await sendChatMessage(text, 'ivan', conversationId);
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: res.reply,
        toolsUsed: res.toolsUsed,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (onActivityChange) {
        onActivityChange();
      }
    } catch (err: any) {
      setError(err?.message || 'Ocurrió un error al hablar con Edith.');
    } finally {
      setIsTyping(false);
    }
  };

  const handleClear = async () => {
    try {
      await clearChatHistoryApi('ivan', conversationId);
      setMessages([]);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'No se pudo limpiar la conversación.');
    }
  };

  return (
    <div className="chat-wrapper">
      <header className="parallel-chat-header">
        <div className="parallel-header-left">
          <h2 className="parallel-page-title">{conversationTitle || 'Chat API'}</h2>
          {onNewConversation && (
            <button type="button" className="parallel-pill-btn" onClick={onNewConversation}>
              <Plus size={13} />
              <span>NUEVO CHAT</span>
            </button>
          )}
          <button
            type="button"
            className={`parallel-pill-btn ${showSystemPrompt ? 'active' : ''}`}
            onClick={() => setShowSystemPrompt((prev) => !prev)}
          >
            <Settings2 size={13} />
            <span>SYSTEM PROMPT</span>
          </button>
          <button type="button" className="parallel-pill-btn" onClick={handleClear}>
            <RotateCcw size={13} />
            <span>LIMPIAR</span>
          </button>
        </div>

        <div className="parallel-quickstart-card">
          <FileCode size={16} className="quickstart-icon" />
          <div>
            <div className="quickstart-title">Edith Gemini Quickstart</div>
            <div className="quickstart-sub">Multi-Gmail + Calendar + Traductor + Voz</div>
          </div>
        </div>
      </header>

      {showSystemPrompt && (
        <div className="system-prompt-drawer">
          <strong>System Prompt activo:</strong> Eres Edith, el asistente personal con IA de Ivan.
          Hablas en español latinoamericano, tono cálido, claro y directo. Conectada a múltiples
          cuentas de Gmail, traductor con Gemini, Google Calendar y memoria persistente en SQLite.
        </div>
      )}

      {error && (
        <div className="alert-banner error">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      <MessageList messages={messages} isTyping={isTyping} onQuickPrompt={handleSend} />
      <Composer onSend={handleSend} disabled={isTyping} />
    </div>
  );
};
