import { google } from 'googleapis';
import { getDb, saveDb } from '../db';
import { recordApiUsage } from './usage';

export interface StoredTokens {
  access_token: string | null;
  refresh_token: string | null;
  expiry_date: number | null;
  email: string;
  updated_at?: string;
}

export interface SavedContact {
  email: string;
  name: string;
  updated_at: string;
}

/**
 * Guarda o actualiza un correo electrónico en la agenda de contactos frecuentes (`saved_contacts`).
 */
export async function saveContact(email: string, name?: string): Promise<SavedContact | null> {
  const raw = (email || '').trim();
  const match = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (!match) return null;

  const cleanEmail = match[1].toLowerCase();
  if (
    cleanEmail.includes('no-reply') ||
    cleanEmail.includes('noreply') ||
    cleanEmail.includes('donotreply') ||
    cleanEmail.includes('notifications@')
  ) {
    return null;
  }

  let cleanName = (name || '').trim();
  if (!cleanName && raw.includes('<')) {
    cleanName = raw.split('<')[0].replace(/["']/g, '').trim();
  }
  if (!cleanName) {
    cleanName = cleanEmail.split('@')[0];
  }

  const db = await getDb();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO saved_contacts (email, name, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       name = CASE WHEN excluded.name != '' AND excluded.name != excluded.email THEN excluded.name ELSE saved_contacts.name END,
       updated_at = excluded.updated_at`,
    [cleanEmail, cleanName, now]
  );
  saveDb();

  return { email: cleanEmail, name: cleanName, updated_at: now };
}

/**
 * Lista todos los correos guardados en SQLite (incluyendo las cuentas conectadas de Ivan).
 */
export async function listSavedContacts(): Promise<SavedContact[]> {
  const db = await getDb();
  const accounts = await getConnectedAccounts();
  for (const acc of accounts) {
    if (acc.email) {
      await saveContact(acc.email, `Mi cuenta (${acc.email.split('@')[0]})`);
    }
  }

  const stmt = db.prepare(
    'SELECT email, name, updated_at FROM saved_contacts ORDER BY updated_at DESC LIMIT 60'
  );
  const items: SavedContact[] = [];
  while (stmt.step()) {
    items.push(stmt.getAsObject() as unknown as SavedContact);
  }
  stmt.free();
  return items;
}

/**
 * Elimina un correo guardado de `saved_contacts`.
 */
export async function deleteSavedContact(email: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM saved_contacts WHERE LOWER(email) = LOWER(?)', [email.trim()]);
  saveDb();
}

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
];

/**
 * Verifica que las variables de entorno de Google OAuth estén configuradas.
 */
export function checkGoogleEnvConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!process.env.GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI');
  return { valid: missing.length === 0, missing };
}

/**
 * Crea un cliente OAuth2 de Google con la configuración actual.
 */
export function createOAuthClient() {
  const { valid, missing } = checkGoogleEnvConfig();
  if (!valid) {
    throw new Error(
      `Faltan variables de entorno de Google en backend/.env: ${missing.join(', ')}. Por favor configúralas según el README.`
    );
  }

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Genera la URL de autorización para iniciar el flujo OAuth 2.0 con Google (permite elegir cualquier cuenta).
 */
export function getGoogleAuthUrl(): string {
  const oauth2Client = createOAuthClient();
  const scopesEnv = process.env.GOOGLE_SCOPES;
  const scopes = scopesEnv ? scopesEnv.split(/\s+/).filter(Boolean) : DEFAULT_SCOPES;

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account consent',
    scope: scopes,
  });
}

/**
 * Obtiene todas las cuentas de Google conectadas en SQLite (`google_accounts`).
 */
export async function getConnectedAccounts(): Promise<StoredTokens[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT email, access_token, refresh_token, expiry_date, updated_at FROM google_accounts ORDER BY updated_at DESC'
  );
  const accounts: StoredTokens[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as StoredTokens;
    if (row.access_token || row.refresh_token) {
      accounts.push(row);
    }
  }
  stmt.free();
  return accounts;
}

/**
 * Lee los tokens de una cuenta específica o de la cuenta principal si no se especifica.
 */
export async function getStoredTokens(
  email?: string,
  strict = false
): Promise<StoredTokens | null> {
  const accounts = await getConnectedAccounts();
  if (accounts.length === 0) return null;
  if (email && email.trim() && email.trim().toLowerCase() !== 'all') {
    const cleanEmail = email.trim().toLowerCase();
    const found = accounts.find((a) => a.email.toLowerCase() === cleanEmail);
    if (!found && strict) {
      const available = accounts.map((a) => a.email).join(', ');
      throw new Error(
        `La cuenta "${email}" no está conectada en Edith. Cuentas conectadas actualmente: ${available}`
      );
    }
    return found || null;
  }
  return accounts[0];
}

/**
 * Guarda o actualiza una cuenta OAuth en `google_accounts` (y mantiene sincronizada `auth_tokens`).
 */
export async function saveTokens(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  email?: string | null;
}): Promise<void> {
  const db = await getDb();
  const emailKey = (tokens.email || 'cuenta_principal@gmail.com').trim();
  const existing = await getStoredTokens(emailKey, false);
  const now = new Date().toISOString();

  const accessToken = tokens.access_token ?? existing?.access_token ?? null;
  const refreshToken = tokens.refresh_token ?? existing?.refresh_token ?? null;
  const expiryDate = tokens.expiry_date ?? existing?.expiry_date ?? null;

  db.run(
    `INSERT INTO google_accounts (email, access_token, refresh_token, expiry_date, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, google_accounts.refresh_token),
       expiry_date = excluded.expiry_date,
       updated_at = excluded.updated_at`,
    [emailKey, accessToken, refreshToken, expiryDate, now]
  );

  // Mantener compatibilidad en auth_tokens
  db.run(
    `INSERT INTO auth_tokens (id, access_token, refresh_token, expiry_date, email, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, auth_tokens.refresh_token),
       expiry_date = excluded.expiry_date,
       email = excluded.email,
       updated_at = excluded.updated_at`,
    [accessToken, refreshToken, expiryDate, emailKey, now]
  );

  saveDb();
}

/**
 * Elimina una cuenta específica o todas las cuentas de Google de SQLite.
 */
export async function clearTokens(email?: string): Promise<void> {
  const db = await getDb();
  if (email) {
    db.run('DELETE FROM google_accounts WHERE LOWER(email) = LOWER(?)', [email]);
    const remaining = await getConnectedAccounts();
    if (remaining.length === 0) {
      db.run('DELETE FROM auth_tokens WHERE id = 1');
    }
  } else {
    db.run('DELETE FROM google_accounts');
    db.run('DELETE FROM auth_tokens WHERE id = 1');
  }
  saveDb();
}

/**
 * Indica si existen cuentas de Google conectadas y devuelve la lista completa.
 */
export async function isGoogleConnected(): Promise<{
  connected: boolean;
  email: string | null;
  accounts: string[];
}> {
  const accounts = await getConnectedAccounts();
  if (accounts.length === 0) {
    return { connected: false, email: null, accounts: [] };
  }
  return {
    connected: true,
    email: accounts[0].email,
    accounts: accounts.map((a) => a.email),
  };
}

/**
 * Retorna un cliente OAuth autenticado estrictamente para la cuenta solicitada.
 */
export async function getAuthenticatedClient(email?: string) {
  const accounts = await getConnectedAccounts();
  if (accounts.length === 0) {
    const err = new Error('Tu cuenta de Google no está conectada. Conéctala primero en Edith.');
    (err as any).code = 'NOT_CONNECTED';
    throw err;
  }

  const tokens = await getStoredTokens(email, Boolean(email && email.trim() && email !== 'all'));
  if (!tokens || (!tokens.access_token && !tokens.refresh_token)) {
    const err = new Error('Tu cuenta de Google no está conectada. Conéctala primero en Edith.');
    (err as any).code = 'NOT_CONNECTED';
    throw err;
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokens.access_token || undefined,
    refresh_token: tokens.refresh_token || undefined,
    expiry_date: tokens.expiry_date || undefined,
  });

  oauth2Client.on('tokens', async (newTokens) => {
    await saveTokens({
      email: tokens.email,
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      expiry_date: newTokens.expiry_date,
    });
  });

  return { oauth2Client, accountEmail: tokens.email };
}

// ==========================================
// FUNCIONES DE GMAIL (MULTI-CUENTA)
// ==========================================

export interface EmailSummary {
  id: string;
  threadId: string;
  accountEmail: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface EmailDetail extends EmailSummary {
  to: string;
  body: string;
}

function getHeader(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string
): string {
  if (!headers) return '';
  const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value || '';
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function extractEmailBody(payload: any): string {
  if (!payload) return '';

  if (payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64Url(part.body.data);
        return html
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
      if (part.parts) {
        const nested = extractEmailBody(part);
        if (nested) return nested;
      }
    }
  }

  return '';
}

/**
 * Lista los correos de una cuenta específica o de TODAS las cuentas conectadas (`account === 'all'` o undefined).
 */
export async function listInboxEmails(limit = 10, account?: string): Promise<EmailSummary[]> {
  const allAccounts = await getConnectedAccounts();
  if (allAccounts.length === 0) {
    const err = new Error('Tu cuenta de Google no está conectada.');
    (err as any).code = 'NOT_CONNECTED';
    throw err;
  }

  let accountsToQuery = allAccounts;
  if (account && account.trim() && account.trim().toLowerCase() !== 'all') {
    const cleanAccount = account.trim().toLowerCase();
    const matched = allAccounts.filter((a) => a.email.toLowerCase() === cleanAccount);
    if (matched.length === 0) {
      throw new Error(
        `La cuenta "${account}" no está conectada en Edith. Cuentas conectadas actualmente: ${allAccounts.map((a) => a.email).join(', ')}`
      );
    }
    accountsToQuery = matched;
  }
  const results: EmailSummary[] = [];

  for (const acc of accountsToQuery) {
    const { oauth2Client, accountEmail } = await getAuthenticatedClient(acc.email);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await recordApiUsage('gmail', 1);
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: limit,
      q: 'in:inbox',
    });

    const messages = listRes.data.messages || [];

    for (const msg of messages) {
      if (!msg.id) continue;
      await recordApiUsage('gmail', 1);
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = detail.data.payload?.headers;
      const fromHeader = getHeader(headers, 'From') || 'Desconocido';
      await saveContact(fromHeader);
      results.push({
        id: msg.id,
        threadId: msg.threadId || '',
        accountEmail,
        from: fromHeader,
        subject: getHeader(headers, 'Subject') || '(Sin asunto)',
        date: getHeader(headers, 'Date') || '',
        snippet: detail.data.snippet || '',
      });
    }
  }

  return results
    .sort((a, b) => {
      const tA = new Date(a.date).getTime() || 0;
      const tB = new Date(b.date).getTime() || 0;
      return tB - tA;
    })
    .slice(0, limit * accountsToQuery.length);
}

/**
 * Obtiene el detalle y cuerpo completo de un correo por su ID.
 */
export async function getEmailById(id: string, account?: string): Promise<EmailDetail> {
  const { oauth2Client, accountEmail } = await getAuthenticatedClient(account);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  await recordApiUsage('gmail', 1);
  const res = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'full',
  });

  const headers = res.data.payload?.headers;
  const body = extractEmailBody(res.data.payload) || res.data.snippet || '';
  const fromVal = getHeader(headers, 'From') || 'Desconocido';
  const toVal = getHeader(headers, 'To') || '';
  await saveContact(fromVal);
  if (toVal) await saveContact(toVal);

  return {
    id: res.data.id || id,
    threadId: res.data.threadId || '',
    accountEmail,
    from: fromVal,
    to: toVal,
    subject: getHeader(headers, 'Subject') || '(Sin asunto)',
    date: getHeader(headers, 'Date') || '',
    snippet: res.data.snippet || '',
    body,
  };
}

/**
 * Envía un correo electrónico usando la cuenta de Gmail indicada (o la principal).
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  account?: string
): Promise<{ id: string; accountEmail: string }> {
  const { oauth2Client, accountEmail } = await getAuthenticatedClient(account);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  await saveContact(to);

  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `To: ${to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    body,
  ];
  const message = messageParts.join('\r\n');
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await recordApiUsage('gmail', 1);
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
    },
  });

  return { id: res.data.id || '', accountEmail };
}

/**
 * Envía un correo electrónico a la papelera de Gmail por su ID.
 */
export async function trashEmailById(id: string, account?: string): Promise<void> {
  const { oauth2Client } = await getAuthenticatedClient(account);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  await recordApiUsage('gmail', 1);
  await gmail.users.messages.trash({
    userId: 'me',
    id,
  });
}

// ==========================================
// FUNCIONES DE GOOGLE CALENDAR
// ==========================================

export interface CalendarEventItem {
  id: string;
  accountEmail: string;
  title: string;
  start: string;
  end: string;
  description: string;
  attendees: string[];
  htmlLink: string;
}

/**
 * Lista eventos del calendario principal entre `from` y `to` para la cuenta indicada (o todas si `account === 'all'`).
 */
export async function listCalendarEvents(
  from?: string,
  to?: string,
  account?: string
): Promise<CalendarEventItem[]> {
  const allAccounts = await getConnectedAccounts();
  if (allAccounts.length === 0) {
    const err = new Error('Tu cuenta de Google no está conectada.');
    (err as any).code = 'NOT_CONNECTED';
    throw err;
  }

  let accountsToQuery = allAccounts;
  if (account && account.trim() && account.trim().toLowerCase() !== 'all') {
    const cleanAccount = account.trim().toLowerCase();
    const matched = allAccounts.filter((a) => a.email.toLowerCase() === cleanAccount);
    if (matched.length === 0) {
      throw new Error(
        `La cuenta "${account}" no está conectada en Edith. Cuentas conectadas actualmente: ${allAccounts.map((a) => a.email).join(', ')}`
      );
    }
    accountsToQuery = matched;
  } else if (!account) {
    accountsToQuery = [allAccounts[0]];
  }

  const now = new Date();
  let timeMin: string;
  let timeMax: string | undefined;

  if (from) {
    timeMin = from.includes('T')
      ? new Date(from).toISOString()
      : new Date(`${from}T00:00:00`).toISOString();
  } else {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    timeMin = startOfToday.toISOString();
  }

  if (to) {
    timeMax = to.includes('T')
      ? new Date(to).toISOString()
      : new Date(`${to}T23:59:59`).toISOString();
  }

  const allEvents: CalendarEventItem[] = [];

  for (const acc of accountsToQuery) {
    const { oauth2Client, accountEmail } = await getAuthenticatedClient(acc.email);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    await recordApiUsage('calendar', 1);
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    const items = res.data.items || [];
    for (const ev of items) {
      allEvents.push({
        id: ev.id || '',
        accountEmail,
        title: ev.summary || '(Sin título)',
        start: ev.start?.dateTime || ev.start?.date || '',
        end: ev.end?.dateTime || ev.end?.date || '',
        description: ev.description || '',
        attendees: (ev.attendees || []).map((a) => a.email || '').filter(Boolean),
        htmlLink: ev.htmlLink || '',
      });
    }
  }

  return allEvents.sort((a, b) => {
    const tA = new Date(a.start).getTime() || 0;
    const tB = new Date(b.start).getTime() || 0;
    return tA - tB;
  });
}

/**
 * Crea un evento en el calendario principal del usuario.
 */
export async function createCalendarEvent(params: {
  title: string;
  start: string;
  end: string;
  description?: string;
  attendees?: string[];
  account?: string;
}): Promise<CalendarEventItem> {
  const { oauth2Client, accountEmail } = await getAuthenticatedClient(params.account);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const startDate = new Date(params.start);
  const endDate = new Date(params.end);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Las fechas de inicio o fin no tienen un formato ISO válido.');
  }

  await recordApiUsage('calendar', 1);
  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: params.title,
      description: params.description || '',
      start: { dateTime: startDate.toISOString() },
      end: { dateTime: endDate.toISOString() },
      attendees: params.attendees?.map((email) => ({ email })),
    },
  });

  const ev = res.data;
  return {
    id: ev.id || '',
    accountEmail,
    title: ev.summary || params.title,
    start: ev.start?.dateTime || ev.start?.date || params.start,
    end: ev.end?.dateTime || ev.end?.date || params.end,
    description: ev.description || '',
    attendees: (ev.attendees || []).map((a) => a.email || '').filter(Boolean),
    htmlLink: ev.htmlLink || '',
  };
}

/**
 * Elimina un evento del calendario principal por su ID.
 */
export async function deleteCalendarEvent(eventId: string, account?: string): Promise<void> {
  const { oauth2Client } = await getAuthenticatedClient(account);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  await recordApiUsage('calendar', 1);
  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
  });
}
