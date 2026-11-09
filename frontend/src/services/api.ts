const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface AuthStatus {
  connected: boolean;
  email: string | null;
  accounts: string[];
  configured: boolean;
  missingEnv: string[];
  authUrl: string;
}

export interface ConversationItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id?: number;
  conversation_id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
  toolsUsed?: string[];
}

export interface EmailSummary {
  id: string;
  threadId: string;
  accountEmail?: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface EmailDetail extends EmailSummary {
  to: string;
  body: string;
}

export interface CalendarEventItem {
  id: string;
  accountEmail?: string;
  title: string;
  start: string;
  end: string;
  description: string;
  attendees: string[];
  htmlLink: string;
}

export interface MemoryItem {
  key: string;
  value: string;
  updated_at: string;
}

export interface ServiceQuotaStatus {
  service: 'gemini' | 'gmail' | 'calendar';
  label: string;
  usedRequests: number;
  limitRequests: number;
  remainingRequests: number;
  usedTokens: number;
  limitTokens: number;
  remainingTokens: number;
  percentUsed: number;
}

export interface ApiUsageSummary {
  date: string;
  services: {
    gemini: ServiceQuotaStatus;
    gmail: ServiceQuotaStatus;
    calendar: ServiceQuotaStatus;
  };
}

export function getGoogleLoginUrl(): string {
  return `${API_BASE}/auth/google`;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE}/auth/status`);
  if (!res.ok) {
    throw new Error('No se pudo verificar el estado de autenticación con el servidor.');
  }
  return res.json();
}

export async function logoutGoogle(email?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(email ? { email } : {}),
  });
  if (!res.ok) {
    throw new Error('Error al desconectar la cuenta de Google.');
  }
}

export async function fetchApiUsage(): Promise<ApiUsageSummary> {
  const res = await fetch(`${API_BASE}/api/usage`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al obtener el uso de API.');
  }
  return data;
}

export async function fetchConversations(): Promise<ConversationItem[]> {
  const res = await fetch(`${API_BASE}/api/chat/conversations`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al listar conversaciones.');
  }
  return data.conversations || [];
}

export async function createConversationApi(title = 'Nuevo Chat'): Promise<ConversationItem> {
  const res = await fetch(`${API_BASE}/api/chat/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al crear un nuevo chat.');
  }
  return data.conversation;
}

export async function deleteConversationApi(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('Error al eliminar la conversación.');
  }
}

export async function fetchChatHistory(
  userId = 'ivan',
  conversationId = 'default'
): Promise<ChatMessage[]> {
  const params = new URLSearchParams({ userId, conversationId });
  const res = await fetch(`${API_BASE}/api/chat/history?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al cargar el historial de chat.');
  }
  return data.history || [];
}

export async function clearChatHistoryApi(
  userId = 'ivan',
  conversationId = 'default'
): Promise<void> {
  const params = new URLSearchParams({ userId, conversationId });
  const res = await fetch(`${API_BASE}/api/chat/history?${params.toString()}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('No se pudo limpiar el historial de chat.');
  }
}

export async function sendChatMessage(
  message: string,
  userId = 'ivan',
  conversationId = 'default'
): Promise<{ reply: string; toolsUsed: string[] }> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, userId, conversationId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al procesar tu mensaje con Edith.');
  }
  return data;
}

export async function transcribeVoiceApi(
  audioBase64: string,
  mimeType = 'audio/webm'
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/chat/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, mimeType }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al transcribir tu voz.');
  }
  return data.text || '';
}

export async function fetchGmailInbox(
  limit = 10,
  account = 'all'
): Promise<{ connected: boolean; authUrl?: string; emails: EmailSummary[] }> {
  const params = new URLSearchParams({ limit: String(limit), account });
  const res = await fetch(`${API_BASE}/api/gmail/inbox?${params.toString()}`);
  const data = await res.json();
  if (res.status === 401) {
    return { connected: false, authUrl: data.authUrl || '/auth/google', emails: [] };
  }
  if (!res.ok) {
    throw new Error(data.error || 'Error al consultar la bandeja de entrada de Gmail.');
  }
  return { connected: true, emails: data.emails || [] };
}

export async function fetchGmailDetail(id: string, account?: string): Promise<EmailDetail> {
  const query = account ? `?account=${encodeURIComponent(account)}` : '';
  const res = await fetch(`${API_BASE}/api/gmail/${encodeURIComponent(id)}${query}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al abrir el correo.');
  }
  return data.email;
}

export async function translateEmailApi(payload: {
  id?: string;
  text?: string;
  targetLanguage?: string;
  account?: string;
}): Promise<string> {
  const res = await fetch(`${API_BASE}/api/gmail/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al traducir el correo.');
  }
  return data.translated;
}

export async function sendGmailMessage(payload: {
  to: string;
  subject: string;
  body: string;
  account?: string;
}): Promise<{ id: string; accountEmail?: string }> {
  const res = await fetch(`${API_BASE}/api/gmail/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al enviar el correo.');
  }
  return data;
}

export interface SavedContact {
  email: string;
  name: string;
  updated_at: string;
}

export async function fetchSavedContacts(): Promise<SavedContact[]> {
  const res = await fetch(`${API_BASE}/api/gmail/contacts`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al obtener correos guardados.');
  }
  return data.contacts || [];
}

export async function saveContactApi(email: string, name?: string): Promise<SavedContact> {
  const res = await fetch(`${API_BASE}/api/gmail/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al guardar correo.');
  }
  return data.contact;
}

export async function deleteSavedContactApi(email: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/gmail/contacts/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('Error al eliminar correo guardado.');
  }
}

export async function deleteGmailMessage(id: string, account?: string): Promise<void> {
  const query = account ? `?account=${encodeURIComponent(account)}` : '';
  const res = await fetch(`${API_BASE}/api/gmail/${encodeURIComponent(id)}${query}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al eliminar el correo.');
  }
}

export async function fetchCalendarEvents(
  from?: string,
  to?: string,
  account = 'all'
): Promise<{ connected: boolean; authUrl?: string; events: CalendarEventItem[] }> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (account) params.set('account', account);

  const res = await fetch(`${API_BASE}/api/calendar/events?${params.toString()}`);
  const data = await res.json();
  if (res.status === 401) {
    return { connected: false, authUrl: data.authUrl || '/auth/google', events: [] };
  }
  if (!res.ok) {
    throw new Error(data.error || 'Error al obtener eventos de Google Calendar.');
  }
  return { connected: true, events: data.events || [] };
}

export async function createCalendarEventApi(payload: {
  title: string;
  start: string;
  end: string;
  description?: string;
  attendees?: string[];
  account?: string;
}): Promise<CalendarEventItem> {
  const res = await fetch(`${API_BASE}/api/calendar/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al crear el evento.');
  }
  return data.event;
}

export async function deleteCalendarEventApi(id: string, account?: string): Promise<void> {
  const query = account ? `?account=${encodeURIComponent(account)}` : '';
  const res = await fetch(
    `${API_BASE}/api/calendar/events/${encodeURIComponent(id)}${query}`,
    {
      method: 'DELETE',
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al eliminar el evento.');
  }
}

export async function fetchMemory(): Promise<MemoryItem[]> {
  const res = await fetch(`${API_BASE}/api/memory`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al cargar la memoria de Edith.');
  }
  return data.memory || [];
}

export async function saveMemoryApi(key: string, value: string): Promise<MemoryItem> {
  const res = await fetch(`${API_BASE}/api/memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al guardar recuerdo en memoria.');
  }
  return data.item;
}

export async function deleteMemoryApi(key: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/memory/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al eliminar el recuerdo.');
  }
}
