import React, { useEffect, useState } from 'react';
import { RotateCcw, Settings2, AlertTriangle, FileCode, Plus, Radio } from 'lucide-react';
import {
  ChatMessage,
  clearChatHistoryApi,
  fetchChatHistory,
  sendChatMessage,
} from '../services/api';
import { speakWithEdith, stopEdithSpeech } from '../services/voice';
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

  // Estados de Voz a Voz y activación por palabra clave ("Edith" o cualquiera)
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState<boolean>(true);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState<boolean>(false);
  const [wakeWord, setWakeWord] = useState<string>('edith');
  const [isEdithSpeaking, setIsEdithSpeaking] = useState<boolean>(false);
  const [followUpUntil, setFollowUpUntil] = useState<number>(0);

  useEffect(() => {
    loadHistory();
    return () => {
      stopEdithSpeech();
    };
  }, [conversationId]);

  const loadHistory = async () => {
    try {
      const history = await fetchChatHistory('ivan', conversationId);
      setMessages(history);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleStopSpeaking = () => {
    stopEdithSpeech();
    setIsEdithSpeaking(false);
    setFollowUpUntil(Date.now() + 45000);
  };

  const handleSend = async (text: string, fromVoice = false) => {
    setError(null);
    stopEdithSpeech();
    setIsEdithSpeaking(false);

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

      if (voiceReplyEnabled || fromVoice || handsFreeEnabled) {
        speakWithEdith(res.reply, {
          onStart: () => {
            setIsEdithSpeaking(true);
          },
          onEnd: () => {
            setIsEdithSpeaking(false);
            setFollowUpUntil(Date.now() + 45000);
          },
        });
      } else {
        setFollowUpUntil(Date.now() + 45000);
      }
    } catch (err: any) {
      setError(err?.message || 'Ocurrió un error al hablar con Edith.');
    } finally {
      setIsTyping(false);
    }
  };

  const handleClear = async () => {
    try {
      stopEdithSpeech();
      setIsEdithSpeaking(false);
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
            className={`parallel-pill-btn ${handsFreeEnabled ? 'active' : ''}`}
            onClick={() => setHandsFreeEnabled((prev) => !prev)}
            title="Activa o desactiva la conversación continua Voz a Voz al decir Edith"
          >
            <Radio size={13} />
            <span>{handsFreeEnabled ? 'VOZ A VOZ: ACTIVO' : 'MODO VOZ A VOZ'}</span>
          </button>
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
            <div className="quickstart-sub">Voz a Voz + Multi-Gmail + Calendar + Traductor</div>
          </div>
        </div>
      </header>

      {showSystemPrompt && (
        <div className="system-prompt-drawer">
          <strong>System Prompt activo:</strong> Eres Edith, el asistente personal con IA de Ivan.
          Hablas en español latinoamericano, tono cálido, claro y directo. Conectada a múltiples
          cuentas de Gmail, traductor con Gemini, Google Calendar, memoria persistente en SQLite y
          modo conversacional Voz a Voz.
        </div>
      )}

      {error && (
        <div className="alert-banner error">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      <MessageList
        messages={messages}
        isTyping={isTyping}
        onQuickPrompt={(prompt) => handleSend(prompt, false)}
      />
      <Composer
        onSend={handleSend}
        disabled={isTyping}
        isEdithSpeaking={isEdithSpeaking}
        onStopSpeaking={handleStopSpeaking}
        voiceReplyEnabled={voiceReplyEnabled}
        onToggleVoiceReply={() => {
          setVoiceReplyEnabled((prev) => {
            if (prev) {
              stopEdithSpeech();
              setIsEdithSpeaking(false);
            }
            return !prev;
          });
        }}
        handsFreeEnabled={handsFreeEnabled}
        onToggleHandsFree={() => setHandsFreeEnabled((prev) => !prev)}
        wakeWord={wakeWord}
        onChangeWakeWord={setWakeWord}
        isFollowUpWindowActive={followUpUntil > Date.now()}
      />
    </div>
  );
};
