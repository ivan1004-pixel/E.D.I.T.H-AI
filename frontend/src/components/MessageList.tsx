import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check, Code2, ChevronRight, Sparkles, Volume2 } from 'lucide-react';
import { ChatMessage } from '../services/api';
import { speakWithEdith } from '../services/voice';

interface MessageListProps {
  messages: ChatMessage[];
  isTyping: boolean;
  onQuickPrompt: (prompt: string) => void;
}

const TOOL_LABELS: Record<string, string> = {
  save_memory: 'SQLite Memory',
  save_contact: 'Agenda Contactos SQLite',
  list_inbox_emails: 'Gmail Inbox API',
  get_email_by_id: 'Gmail Read API',
  translate_email: 'Gemini Translate API',
  send_email: 'Gmail Send API',
  trash_email: 'Gmail Trash API',
  list_calendar_events: 'Calendar List API',
  create_calendar_event: 'Calendar Insert API',
  delete_calendar_event: 'Calendar Delete API',
};

/**
 * Elimina cualquier emoji de los textos para mantener la interfaz 100% basada en iconos limpios.
 */
function stripEmojis(text: string): string {
  return text
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/  +/g, ' ');
}

/**
 * Convierte sintaxis inline de Markdown (**negrita**, *cursiva*, `código`)
 * en elementos reales de React eliminando los asteriscos visibles y cualquier emoji.
 */
function renderInlineFormatting(rawText: string): React.ReactNode[] {
  const text = stripEmojis(rawText);
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="md-strong">
          {renderInlineFormatting(part.slice(2, -2))}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={idx} className="md-em">
          {renderInlineFormatting(part.slice(1, -1))}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={idx} className="md-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

/**
 * Renderiza bloques de Markdown (encabezados ###, listas numeradas, viñetas y párrafos)
 * sin dejar signos crudos como ###, ** o *, y sustituyendo emojis por iconos vectoriales.
 */
function renderRichMarkdown(content: string): React.ReactNode {
  const lines = stripEmojis(content).split(/\r?\n/);
  const elements: React.ReactNode[] = [];

  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) {
      elements.push(<div key={`sp-${i}`} className="md-spacer" />);
      return;
    }

    // Encabezados (#, ##, ###, ####)
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cleanHeadingText = headingMatch[2].replace(/^\*\*(.+)\*\*$/, '$1').trim();
      elements.push(
        <div
          key={`h-${i}`}
          className={`md-heading md-h${level}`}
          style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
        >
          <Sparkles size={15} style={{ flexShrink: 0, color: 'var(--accent)' }} />
          <span>{renderInlineFormatting(cleanHeadingText)}</span>
        </div>
      );
      return;
    }

    // Lista numerada (1. texto)
    const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      elements.push(
        <div key={`ol-${i}`} className="md-list-row">
          <span className="md-list-num">{numMatch[1]}.</span>
          <div className="md-list-body">{renderInlineFormatting(numMatch[2])}</div>
        </div>
      );
      return;
    }

    // Lista de viñetas (- o * al inicio)
    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      elements.push(
        <div key={`ul-${i}`} className="md-list-row">
          <span className="md-list-bullet" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <ChevronRight size={14} />
          </span>
          <div className="md-list-body">{renderInlineFormatting(bulletMatch[1])}</div>
        </div>
      );
      return;
    }

    // Párrafo normal
    elements.push(
      <p key={`p-${i}`} className="md-paragraph">
        {renderInlineFormatting(line)}
      </p>
    );
  });

  return <div className="md-rendered">{elements}</div>;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isTyping,
  onQuickPrompt,
}) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1600);
  };

  if (messages.length === 0 && !isTyping) {
    return (
      <div className="empty-chat">
        <div className="empty-globe">
          <div className="parallel-globe lg" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <h2>Hola Ivan, soy Edith</h2>
        <p>
          Asistente personal conectado en tiempo real a todas tus cuentas de Gmail, Google Calendar,
          traductor de correos y memoria SQLite con Google Gemini.
        </p>
        <div className="quick-prompts">
          <button
            className="prompt-chip"
            onClick={() => onQuickPrompt('¿Qué eventos tengo agendados para hoy?')}
          >
            ¿Qué tengo hoy en mi agenda?
          </button>
          <button
            className="prompt-chip"
            onClick={() =>
              onQuickPrompt('Muéstrame mis últimos correos de todas mis cuentas conectadas')
            }
          >
            Ver últimos correos de mis cuentas
          </button>
          <button
            className="prompt-chip"
            onClick={() =>
              onQuickPrompt('Tradúceme al español el último correo en inglés que recibí')
            }
          >
            Traducir último correo en inglés
          </button>
          <button
            className="prompt-chip"
            onClick={() =>
              onQuickPrompt('Agenda una reunión mañana a las 10:00 con el título Prueba Edith')
            }
          >
            Agendar reunión mañana a las 10:00
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((msg, idx) => {
        const isUser = msg.role === 'user';
        return (
          <div key={msg.id ? `msg-${msg.id}-${idx}` : `idx-${idx}`} className={`parallel-msg-group ${isUser ? 'user' : 'assistant'}`}>
            {isUser ? (
              <div className="user-stack">
                <div className="user-pill">{msg.content}</div>
                <div className="msg-action-bar">
                  <button
                    className="copy-icon-btn"
                    onClick={() => handleCopy(msg.content, idx)}
                    title="Copiar mensaje"
                  >
                    {copiedIdx === idx ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <span className="api-orange-badge">
                    <Code2 size={12} />
                    API
                  </span>
                </div>
              </div>
            ) : (
              <div className="assistant-row">
                <div className="assistant-globe-avatar">
                  <div className="parallel-globe sm" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <div className="assistant-body">
                  <div className="assistant-text">{renderRichMarkdown(msg.content)}</div>

                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="parallel-sources">
                      <span className="sources-title">Tools ejecutadas:</span>
                      <ol className="sources-list">
                        {Array.from(new Set(msg.toolsUsed)).map((t) => (
                          <li key={t}>{TOOL_LABELS[t] || t}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <div className="msg-action-bar left">
                    <button
                      className="copy-icon-btn"
                      onClick={() => speakWithEdith(msg.content)}
                      title="Escuchar respuesta con la voz de Edith"
                    >
                      <Volume2 size={13} />
                    </button>
                    <button
                      className="copy-icon-btn"
                      onClick={() => handleCopy(msg.content, idx)}
                      title="Copiar respuesta"
                    >
                      {copiedIdx === idx ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    <span className="api-orange-badge">
                      <Code2 size={12} />
                      API
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {isTyping && (
        <div className="parallel-msg-group assistant">
          <div className="assistant-row">
            <div className="assistant-globe-avatar">
              <div className="parallel-globe sm" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="assistant-body">
              <div className="typing-bubble">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-text">Edith está procesando...</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
