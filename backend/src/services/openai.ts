import OpenAI from 'openai';
import { getDb, saveDb } from '../db';
import {
  extractImplicitMemoryFromMessage,
  getFormattedMemoryContext,
  setMemory,
} from './memory';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getEmailById,
  isGoogleConnected,
  listCalendarEvents,
  listInboxEmails,
  listSavedContacts,
  saveContact,
  sendEmail,
  trashEmailById,
} from './google';
import { recordApiUsage } from './usage';

export interface ChatMessageRecord {
  id: number;
  user_id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  created_at: string;
}

export interface ConversationItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/**
 * Modelos de respaldo automático cuando uno tiene límite 429 o 503 en el Free Tier.
 */
const FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
];

/**
 * Lista todas las conversaciones guardadas en SQLite.
 */
export async function listConversations(): Promise<ConversationItem[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC'
  );
  const items: ConversationItem[] = [];
  while (stmt.step()) {
    items.push(stmt.getAsObject() as unknown as ConversationItem);
  }
  stmt.free();
  return items;
}

/**
 * Crea una nueva conversación de chat.
 */
export async function createConversation(title?: string): Promise<ConversationItem> {
  const db = await getDb();
  const id = `conv_${Date.now()}`;
  const now = new Date().toISOString();
  const cleanTitle = (title || 'Nuevo Chat').trim();

  db.run(
    'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, cleanTitle, now, now]
  );
  saveDb();

  return { id, title: cleanTitle, created_at: now, updated_at: now };
}

/**
 * Elimina una conversación y sus mensajes asociados.
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM chat_history WHERE conversation_id = ?', [conversationId]);
  if (conversationId !== 'default') {
    db.run('DELETE FROM conversations WHERE id = ?', [conversationId]);
  }
  saveDb();
}

/**
 * Obtiene el historial de mensajes guardado en SQLite para una conversación.
 */
export async function getChatHistory(
  userId = 'ivan',
  limit = 40,
  conversationId = 'default'
): Promise<ChatMessageRecord[]> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT id, user_id, conversation_id, role, content, tools_used, created_at
     FROM (
       SELECT id, user_id, COALESCE(conversation_id, 'default') AS conversation_id, role, content, tools_used, created_at
       FROM chat_history
       WHERE COALESCE(conversation_id, 'default') = ?
       ORDER BY id DESC
       LIMIT ?
     )
     ORDER BY id ASC`
  );
  stmt.bind([conversationId, limit]);
  const rows: ChatMessageRecord[] = [];
  while (stmt.step()) {
    const raw = stmt.getAsObject() as any;
    let parsedTools: string[] | undefined = undefined;
    if (raw.tools_used) {
      try {
        parsedTools = JSON.parse(raw.tools_used);
      } catch {
        parsedTools = undefined;
      }
    }
    rows.push({
      id: Number(raw.id),
      user_id: String(raw.user_id || userId),
      conversation_id: String(raw.conversation_id || conversationId),
      role: raw.role as 'user' | 'assistant',
      content: String(raw.content),
      toolsUsed: parsedTools,
      created_at: String(raw.created_at),
    });
  }
  stmt.free();
  return rows;
}

/**
 * Guarda un mensaje en el historial de SQLite y actualiza la conversación.
 */
export async function appendChatHistory(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  conversationId = 'default',
  toolsUsed?: string[]
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  const autoTitle =
    role === 'user'
      ? content.slice(0, 36) + (content.length > 36 ? '...' : '')
      : 'Conversación';

  db.run(
    `INSERT INTO conversations (id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       title = CASE WHEN conversations.title = 'Nuevo Chat' AND ? = 'user' THEN ? ELSE conversations.title END`,
    [conversationId, autoTitle, now, now, role, autoTitle]
  );

  db.run(
    'INSERT INTO chat_history (user_id, conversation_id, role, content, tools_used, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      userId,
      conversationId,
      role,
      content,
      toolsUsed && toolsUsed.length > 0 ? JSON.stringify(toolsUsed) : null,
      now,
    ]
  );
  saveDb();
}

/**
 * Limpia el historial de una conversación específica.
 */
export async function clearChatHistory(
  _userId = 'ivan',
  conversationId = 'default'
): Promise<void> {
  const db = await getDb();
  db.run("DELETE FROM chat_history WHERE COALESCE(conversation_id, 'default') = ?", [
    conversationId,
  ]);
  saveDb();
}

function getApiKey(): string {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY)?.trim();
  if (!apiKey) {
    throw new Error(
      'Falta configurar la variable GEMINI_API_KEY en backend/.env. Agrega tu clave de Google Gemini para que Edith pueda responder.'
    );
  }
  return apiKey;
}

function createGeminiClient(): { client: OpenAI; model: string } {
  const apiKey = getApiKey();
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  });
  const model =
    process.env.GEMINI_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    'gemini-3.5-flash';
  return { client, model };
}

/**
 * Llama a Gemini con rotación automática de modelo si el modelo primario devuelve 429 (Rate Limit) o 503.
 */
async function callGeminiWithFallback(
  params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, 'model'>
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const { client, model: preferredModel } = createGeminiClient();
  const candidateModels = Array.from(new Set([preferredModel, ...FALLBACK_MODELS]));

  let lastError: any = null;
  for (const candidate of candidateModels) {
    try {
      const res = await client.chat.completions.create({
        ...params,
        model: candidate,
      });
      await recordApiUsage('gemini', 1, res.usage?.total_tokens || 450);
      return res;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode;
      if (status === 429 || status === 503 || status === 404) {
        console.warn(`⚠️ Modelo ${candidate} devolvió ${status}, rotando al siguiente modelo libre...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Transcribe un audio en Base64 a texto en español usando Gemini Multimodal.
 * Funciona en cualquier navegador (incluyendo Opera GX, donde Web Speech API no tiene servidor de Google).
 */
export async function transcribeAudioWithGemini(
  audioBase64: string,
  mimeType = 'audio/wav'
): Promise<string> {
  const apiKey = getApiKey();
  const cleanBase64 = audioBase64.includes('base64,')
    ? audioBase64.split('base64,')[1].replace(/\s/g, '')
    : audioBase64.replace(/\s/g, '');
  const cleanMimeType = (mimeType || 'audio/wav').split(';')[0].trim() || 'audio/wav';
  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];

  let lastError = 'No se pudo transcribir el audio.';

  for (const modelName of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Transcribe exactamente lo que dice este audio en español. Devuelve ÚNICAMENTE las palabras habladas, sin comillas ni explicaciones adicionales.',
              },
              {
                inlineData: {
                  mimeType: cleanMimeType,
                  data: cleanBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      await recordApiUsage('gemini', 1, 250);
      const text =
        data?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p.text || '')
          .join(' ')
          .trim() || '';
      return text;
    } else {
      const errText = await res.text();
      lastError = `Error ${res.status}: ${errText.slice(0, 120)}`;
    }
  }

  throw new Error(lastError);
}

/**
 * Traduce el asunto y cuerpo de un correo o texto al idioma indicado usando Gemini.
 */
export async function translateTextWithGemini(
  text: string,
  targetLanguage = 'Español'
): Promise<string> {
  const response = await callGeminiWithFallback({
    messages: [
      {
        role: 'system',
        content: `Eres un traductor experto. Traduce el siguiente correo o texto fielmente al idioma "${targetLanguage}". Mantén el formato legible y devuelve únicamente la traducción directa sin explicaciones extra.`,
      },
      {
        role: 'user',
        content: text,
      },
    ],
    temperature: 0.2,
  });

  return response.choices[0]?.message?.content?.trim() || text;
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        'Guarda un dato, preferencia o nota importante sobre el usuario en la memoria permanente (SQLite). Úsala siempre que el usuario diga "recuerda que...", cambie una preferencia o comparta información personal útil.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description:
              'Clave descriptiva corta en snake_case (ej. "cafe_favorito", "horario_reuniones")',
          },
          value: {
            type: 'string',
            description: 'Valor o detalle a recordar',
          },
        },
        required: ['key', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_inbox_emails',
      description:
        'Lista los correos más recientes de la bandeja de entrada de Gmail. IMPORTANTE: Antes de llamar a esta herramienta, Ivan debe haber indicado qué cuenta de correo desea consultar.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Cantidad máxima de correos por cuenta (por defecto 10)',
          },
          account: {
            type: 'string',
            description:
              'Dirección de correo exacta de la cuenta conectada que Ivan indicó usar (o "all" si pidió explícitamente todas las cuentas)',
          },
        },
        required: ['account'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_email_by_id',
      description:
        'Lee el contenido completo de un correo específico de Gmail usando su ID. Requiere la cuenta de correo confirmada por Ivan.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'ID del correo en Gmail',
          },
          account: {
            type: 'string',
            description: 'Dirección de correo exacta de la cuenta donde está el mensaje',
          },
        },
        required: ['id', 'account'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'translate_email',
      description:
        'Traduce un correo electrónico de Gmail (por su ID) o un texto al idioma que pida el usuario (por defecto Español).',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'ID del correo en Gmail a traducir (opcional si se pasa text)',
          },
          text: {
            type: 'string',
            description: 'Texto directo a traducir si no se proporciona ID',
          },
          targetLanguage: {
            type: 'string',
            description: 'Idioma destino (por ejemplo "Español", "Inglés", "Francés")',
          },
          account: {
            type: 'string',
            description: 'Dirección de correo exacta de la cuenta que Ivan confirmó usar',
          },
        },
        required: ['account'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description:
        'Envía un correo electrónico desde la cuenta de Gmail que Ivan haya confirmado explícitamente usar.',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Dirección de correo del destinatario',
          },
          subject: {
            type: 'string',
            description: 'Asunto del correo',
          },
          body: {
            type: 'string',
            description: 'Cuerpo del mensaje en texto plano',
          },
          account: {
            type: 'string',
            description:
              'Dirección de correo remitente exacta que Ivan indicó o confirmó usar para enviar este correo',
          },
        },
        required: ['to', 'subject', 'body', 'account'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trash_email',
      description:
        'Elimina un correo electrónico (lo mueve a la papelera de Gmail) usando su ID en la cuenta confirmada por Ivan.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'ID del correo en Gmail que se desea eliminar',
          },
          account: {
            type: 'string',
            description: 'Dirección de correo exacta de la cuenta donde se eliminará el mensaje',
          },
        },
        required: ['id', 'account'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_calendar_events',
      description:
        'Consulta los eventos reales del Google Calendar en la cuenta de correo que Ivan haya indicado.',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Fecha o fecha-hora de inicio en formato YYYY-MM-DD o ISO 8601',
          },
          to: {
            type: 'string',
            description: 'Fecha o fecha-hora de fin en formato YYYY-MM-DD o ISO 8601',
          },
          account: {
            type: 'string',
            description:
              'Dirección de correo exacta de la cuenta de Google Calendar que Ivan confirmó usar',
          },
        },
        required: ['account'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description:
        'Crea un recordatorio o evento nuevo en el Google Calendar de la cuenta de correo que Ivan haya confirmado explícitamente usar.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Título o nombre del evento o recordatorio',
          },
          start: {
            type: 'string',
            description:
              'Fecha y hora de inicio en formato ISO 8601 (ej. 2026-11-09T10:00:00-06:00)',
          },
          end: {
            type: 'string',
            description:
              'Fecha y hora de fin en formato ISO 8601 (ej. 2026-11-09T11:00:00-06:00)',
          },
          description: {
            type: 'string',
            description: 'Descripción opcional del evento',
          },
          attendees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista opcional de correos de invitados',
          },
          account: {
            type: 'string',
            description:
              'Dirección de correo exacta de la cuenta de Google Calendar donde Ivan indicó agendar el evento/recordatorio',
          },
        },
        required: ['title', 'start', 'end', 'account'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_calendar_event',
      description:
        'Elimina un evento de Google Calendar por su ID en la cuenta de correo confirmada por Ivan.',
      parameters: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'ID del evento en Google Calendar',
          },
          account: {
            type: 'string',
            description:
              'Dirección de correo exacta de la cuenta de Google Calendar donde se eliminará el evento',
          },
        },
        required: ['eventId', 'account'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_contact',
      description:
        'Guarda un correo electrónico frecuente con su nombre o alias en la agenda de contactos de Ivan para que no tenga que volver a escribir el correo completo cada vez.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'Dirección de correo electrónico a guardar',
          },
          name: {
            type: 'string',
            description: 'Nombre o alias del contacto (ej. "Juan", "Trabajo", "Universidad")',
          },
        },
        required: ['email'],
      },
    },
  },
];

interface ToolExecutionContext {
  currentMessage: string;
  history: ChatMessageRecord[];
  connectedAccounts: string[];
}

/**
 * Verifica si Ivan especificó explícitamente el correo en su mensaje actual
 * o si está respondiendo a la pregunta de confirmación de cuenta de Edith del turno inmediato anterior.
 */
function didUserSpecifyOrConfirmAccount(ctx: ToolExecutionContext): boolean {
  const msgLower = ctx.currentMessage.toLowerCase();

  // 1. ¿Mencionó explícitamente alguna de sus cuentas conectadas (o su usuario antes de @) en este mensaje?
  for (const acc of ctx.connectedAccounts) {
    const emailLower = acc.toLowerCase();
    const localPart = emailLower.split('@')[0];
    if (msgLower.includes(emailLower) || (localPart.length >= 4 && msgLower.includes(localPart))) {
      return true;
    }
  }

  // 2. ¿Mencionó "cuenta 1", "correo 1", "primera cuenta", "segunda cuenta"?
  if (
    /\b(cuenta\s*[1-9]|correo\s*[1-9]|primer\s*correo|primera\s*cuenta|segundo\s*correo|segunda\s*cuenta)\b/i.test(
      msgLower
    )
  ) {
    return true;
  }

  // 3. ¿Pidió explícitamente usar todas las cuentas a la vez?
  if (
    msgLower.includes('todas las cuentas') ||
    msgLower.includes('todos mis correos') ||
    msgLower.includes('ambas cuentas') ||
    msgLower.includes('todas mis cuentas')
  ) {
    return true;
  }

  // 4. ¿El último mensaje de Edith le preguntó qué cuenta/correo deseaba usar?
  const lastAssistant = [...ctx.history].reverse().find((h) => h.role === 'assistant');
  if (lastAssistant) {
    const lastText = lastAssistant.content.toLowerCase();
    const askedForAccount =
      lastText.includes('qué correo') ||
      lastText.includes('cuál correo') ||
      lastText.includes('qué cuenta') ||
      lastText.includes('cuál cuenta') ||
      lastText.includes('cuál de tus cuentas') ||
      lastText.includes('cuál de tus correos') ||
      lastText.includes('deseas usar') ||
      lastText.includes('deseas utilizar') ||
      (lastText.includes('?') &&
        ctx.connectedAccounts.some((acc) => lastText.includes(acc.toLowerCase())));

    if (askedForAccount) {
      return true;
    }
  }

  return false;
}

/**
 * Normaliza y valida que la cuenta solicitada exista entre las cuentas conectadas de Ivan.
 * Permite referirse por número ("1", "2"), "primera", nombre de usuario o correo completo.
 */
function resolveTargetAccount(
  requestedAccount: string | undefined,
  connectedAccounts: string[],
  allowAll = false
): string | null {
  if (!requestedAccount || !requestedAccount.trim()) return null;
  const clean = requestedAccount.trim().toLowerCase();
  if (allowAll && (clean === 'all' || clean === 'todas' || clean === 'todos')) {
    return 'all';
  }
  if ((clean === '1' || clean.includes('primer')) && connectedAccounts[0]) {
    return connectedAccounts[0];
  }
  if ((clean === '2' || clean.includes('segund')) && connectedAccounts[1]) {
    return connectedAccounts[1];
  }
  if ((clean === '3' || clean.includes('tercer')) && connectedAccounts[2]) {
    return connectedAccounts[2];
  }
  const exact = connectedAccounts.find(
    (a) => a.toLowerCase() === clean || a.toLowerCase().split('@')[0] === clean
  );
  return exact || null;
}

/**
 * Ejecuta una herramienta solicitada por Gemini y retorna el resultado serializado en JSON.
 */
async function executeToolCall(
  name: string,
  args: any,
  ctx: ToolExecutionContext
): Promise<{ resultJson: string; executed: boolean }> {
  try {
    const isGoogleTool = [
      'list_inbox_emails',
      'get_email_by_id',
      'send_email',
      'trash_email',
      'list_calendar_events',
      'create_calendar_event',
      'delete_calendar_event',
    ].includes(name) || (name === 'translate_email' && Boolean(args?.id));

    if (isGoogleTool) {
      if (ctx.connectedAccounts.length === 0) {
        return {
          executed: false,
          resultJson: JSON.stringify({
            ok: false,
            error:
              'Ivan no tiene ninguna cuenta de Google conectada actualmente. Pídele que conecte su correo en el botón "+ Añadir otro correo" de la barra lateral.',
          }),
        };
      }

      if (!didUserSpecifyOrConfirmAccount(ctx)) {
        return {
          executed: false,
          resultJson: JSON.stringify({
            ok: false,
            requiresAccountConfirmation: true,
            connectedAccounts: ctx.connectedAccounts,
            instruction: `REGLA OBLIGATORIA: Ivan NO ha especificado en su mensaje qué cuenta de correo desea usar para "${name}". NO ejecutes la acción todavía ni digas que ya la hiciste. Pregúntale primero a Ivan qué cuenta de correo desea utilizar (muéstrale sus cuentas conectadas: ${ctx.connectedAccounts.join(', ')}) y espera su confirmación.`,
          }),
        };
      }

      const allowAll = name === 'list_inbox_emails' || name === 'list_calendar_events';
      const resolvedAccount = resolveTargetAccount(args?.account, ctx.connectedAccounts, allowAll);
      if (!resolvedAccount) {
        return {
          executed: false,
          resultJson: JSON.stringify({
            ok: false,
            requiresAccountConfirmation: true,
            connectedAccounts: ctx.connectedAccounts,
            instruction: `La cuenta "${args?.account || ''}" no coincide con ninguna cuenta conectada. Pregúntale a Ivan cuál de sus cuentas conectadas (${ctx.connectedAccounts.join(', ')}) desea usar.`,
          }),
        };
      }
      args.account = resolvedAccount;
    }

    switch (name) {
      case 'save_memory': {
        const saved = await setMemory(args.key, args.value);
        return { executed: true, resultJson: JSON.stringify({ ok: true, memory: saved }) };
      }
      case 'save_contact': {
        const savedContact = await saveContact(args.email, args.name);
        return {
          executed: true,
          resultJson: JSON.stringify({ ok: Boolean(savedContact), contact: savedContact }),
        };
      }
      case 'list_inbox_emails': {
        const emails = await listInboxEmails(args.limit || 10, args.account);
        return {
          executed: true,
          resultJson: JSON.stringify({
            ok: true,
            accountUsed: args.account,
            count: emails.length,
            emails,
          }),
        };
      }
      case 'get_email_by_id': {
        const email = await getEmailById(args.id, args.account);
        return {
          executed: true,
          resultJson: JSON.stringify({ ok: true, accountUsed: email.accountEmail, email }),
        };
      }
      case 'translate_email': {
        let sourceText = args.text || '';
        let subject = '';
        if (args.id) {
          const email = await getEmailById(args.id, args.account);
          subject = email.subject;
          sourceText = `Asunto: ${email.subject}\nDe: ${email.from}\n\n${email.body}`;
        }
        const translated = await translateTextWithGemini(
          sourceText,
          args.targetLanguage || 'Español'
        );
        return {
          executed: true,
          resultJson: JSON.stringify({
            ok: true,
            accountUsed: args.account,
            subject,
            targetLanguage: args.targetLanguage || 'Español',
            translatedText: translated,
          }),
        };
      }
      case 'send_email': {
        let recipientEmail = String(args.to || '').trim();
        if (!recipientEmail.includes('@')) {
          const contacts = await listSavedContacts();
          const matchedContact = contacts.find(
            (c) =>
              c.name.toLowerCase().includes(recipientEmail.toLowerCase()) ||
              c.email.toLowerCase().split('@')[0] === recipientEmail.toLowerCase()
          );
          if (matchedContact) {
            recipientEmail = matchedContact.email;
          }
        }
        const sent = await sendEmail(recipientEmail, args.subject, args.body, args.account);
        return {
          executed: true,
          resultJson: JSON.stringify({
            ok: true,
            messageId: sent.id,
            to: recipientEmail,
            fromAccount: sent.accountEmail,
          }),
        };
      }
      case 'trash_email': {
        await trashEmailById(args.id, args.account);
        return {
          executed: true,
          resultJson: JSON.stringify({ ok: true, accountUsed: args.account, trashedId: args.id }),
        };
      }
      case 'list_calendar_events': {
        const events = await listCalendarEvents(args.from, args.to, args.account);
        return {
          executed: true,
          resultJson: JSON.stringify({
            ok: true,
            accountUsed: args.account,
            count: events.length,
            events,
          }),
        };
      }
      case 'create_calendar_event': {
        const created = await createCalendarEvent({
          title: args.title,
          start: args.start,
          end: args.end,
          description: args.description,
          attendees: args.attendees,
          account: args.account,
        });
        return {
          executed: true,
          resultJson: JSON.stringify({
            ok: true,
            accountUsed: created.accountEmail,
            event: created,
          }),
        };
      }
      case 'delete_calendar_event': {
        await deleteCalendarEvent(args.eventId, args.account);
        return {
          executed: true,
          resultJson: JSON.stringify({
            ok: true,
            accountUsed: args.account,
            deletedId: args.eventId,
          }),
        };
      }
      default:
        return {
          executed: false,
          resultJson: JSON.stringify({ ok: false, error: `Herramienta desconocida: ${name}` }),
        };
    }
  } catch (err: any) {
    return {
      executed: false,
      resultJson: JSON.stringify({
        ok: false,
        error: err?.message || 'Error al ejecutar la herramienta.',
        code: err?.code || 'TOOL_ERROR',
      }),
    };
  }
}

/**
 * Procesa un mensaje de chat con Edith usando la API de Google Gemini con fallback automático de modelos.
 */
export async function chatWithEdith(
  message: string,
  userId = 'ivan',
  conversationId = 'default'
): Promise<{
  reply: string;
  toolsUsed: string[];
}> {
  await extractImplicitMemoryFromMessage(message);

  const memoryContext = await getFormattedMemoryContext();
  const googleStatus = await isGoogleConnected();
  const savedContacts = await listSavedContacts();
  const history = await getChatHistory(userId, 18, conversationId);

  await appendChatHistory(userId, 'user', message, conversationId);

  const now = new Date();
  const isoNow = now.toISOString();
  const localTimeStr = now.toLocaleString('es-MX', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const numberedAccounts = googleStatus.accounts
    .map((acc, idx) => `${idx + 1}. ${acc}`)
    .join(' | ');

  const contactsSummary =
    savedContacts.length > 0
      ? savedContacts.map((c) => `- ${c.name}: ${c.email}`).join('\n')
      : 'Ningún contacto guardado todavía.';

  const systemPrompt = `Eres Edith, el asistente personal con inteligencia artificial de Ivan.
Siempre llámalo "Ivan" (nunca Ivans). Hablas en español latinoamericano, con un tono cálido, claro, empático y directo.
PROHIBIDO USAR EMOJIS: Nunca incluyas ningún emoji ni emoticono en tus respuestas.

INFORMACIÓN DEL SISTEMA Y CUENTAS CONECTADAS:
- Fecha y hora actual del servidor: ${localTimeStr} (ISO: ${isoNow})
- Cuentas de Google (Gmail y Calendar) conectadas (${googleStatus.accounts.length}): ${
    googleStatus.connected
      ? numberedAccounts
      : 'NINGUNA conectada (si Ivan pide correos o agenda, indícale que haga clic en "Añadir otro correo" en la barra lateral).'
  }

CORREOS Y CONTACTOS GUARDADOS (para que Ivan no tenga que escribir el correo completo cada vez):
${contactsSummary}

MEMORIA DE IVAN GUARDADA EN SQLITE:
${memoryContext}

REGLAS ESTRICTAS DE OPERACIÓN:
1. REGLA OBLIGATORIA DE SELECCIÓN DE CORREO: Antes de ejecutar CUALQUIER acción en Gmail (ver bandeja, leer correo, traducir correo por ID, enviar correo o eliminar correo) o en Google Calendar (ver agenda, crear un recordatorio/evento o eliminar un evento), SIEMPRE verifica si Ivan ya especificó en su mensaje qué cuenta de correo desea usar.
   - Si Ivan NO especificó qué correo desea usar en su solicitud, NO llames a la herramienta todavía: pregúntale primero cuál correo desea utilizar mostrándole sus cuentas numeradas (${
     numberedAccounts || 'ninguna'
   }) para que pueda responder simplemente con el número (ej. "el 1") o el nombre sin escribir todo el correo.
   - En cuanto Ivan te indique o confirme el correo (o si ya lo incluyó desde su primer mensaje), ejecuta la herramienta exactamente en ese correo pasando la dirección en el parámetro obligatorio \`account\`.
2. AGENDA DE CORREOS FRECUENTES: Si Ivan pide enviar un correo a un nombre o contacto que ya está en la lista de "CORREOS Y CONTACTOS GUARDADOS", usa directamente su correo guardado sin pedirle que vuelva a escribir la dirección completa. Si te da un correo nuevo, se guarda automáticamente.
3. CERO EMOJIS: No uses ningún emoji en tus mensajes.
4. NUNCA inventes correos electrónicos ni eventos de calendario ni afirmes haber creado un recordatorio o enviado un correo si la herramienta no devolvió \`ok: true\`.
5. Cuando agendes un recordatorio o evento en Google Calendar y no se especifique la duración, asume 1 hora por defecto. Confirma siempre en qué cuenta de correo quedó registrado.`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((h) => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    })),
    { role: 'user', content: message },
  ];

  const toolsUsed: string[] = [];
  const toolContext: ToolExecutionContext = {
    currentMessage: message,
    history,
    connectedAccounts: googleStatus.accounts,
  };

  let response = await callGeminiWithFallback({
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
    temperature: 0.3,
  });

  let assistantMessage = response.choices[0]?.message;

  let iterations = 0;
  while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0 && iterations < 5) {
    iterations++;
    messages.push(assistantMessage);

    let blockedByConfirmation = false;

    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.type !== 'function') continue;
      const fnName = toolCall.function.name;
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        parsedArgs = {};
      }

      const { resultJson, executed } = await executeToolCall(fnName, parsedArgs, toolContext);
      if (executed) {
        toolsUsed.push(fnName);
      } else {
        blockedByConfirmation = true;
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: resultJson,
      });
    }

    response = await callGeminiWithFallback({
      messages,
      tools: blockedByConfirmation ? undefined : TOOLS,
      tool_choice: blockedByConfirmation ? undefined : 'auto',
      temperature: 0.3,
    });

    assistantMessage = response.choices[0]?.message;
    if (blockedByConfirmation) {
      break;
    }
  }

  const rawReply = assistantMessage?.content?.trim() || 'Listo Ivan, he procesado tu solicitud.';
  const reply = rawReply
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    .replace(/  +/g, ' ')
    .trim();

  await appendChatHistory(userId, 'assistant', reply, conversationId, toolsUsed);

  return { reply, toolsUsed };
}
