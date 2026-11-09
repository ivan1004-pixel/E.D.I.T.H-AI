# Edith — Asistente Personal con IA (MVP)

Edith es el asistente personal con inteligencia artificial de **Ivans**, construido en **React + Vite + TypeScript** (frontend) y **Node.js + Express + TypeScript + SQLite** (backend), integrado con **Google Gemini**, **Gmail API** y **Google Calendar API**.

---

## Estructura del Proyecto

```text
E.D.I.T.H/
  frontend/
    src/
      components/   # Chat, MessageList, Composer, Sidebar, GmailPanel, CalendarPanel
      pages/        # ChatPage, SettingsPage
      services/     # api.ts para llamar al backend
      App.tsx
      main.tsx
      styles.css
    .env.example
    package.json
    vite.config.ts
  backend/
    src/
      index.ts          # Servidor Express (puerto 3001)
      routes/
        chat.ts         # POST /api/chat, GET/DELETE /api/chat/history
        gmail.ts        # GET /api/gmail/inbox, GET /api/gmail/:id, POST /api/gmail/send
        calendar.ts     # GET /api/calendar/events, POST /api/calendar/events, DELETE /api/calendar/events/:id
        auth.ts         # GET /auth/google, GET /auth/google/callback, GET /auth/status, POST /auth/logout
      services/
        openai.ts       # Llamada a OpenAI + ejecución de tools (Gmail, Calendar, Memoria)
        google.ts       # Cliente OAuth2 + Gmail API + Google Calendar API
        memory.ts       # Guardar y leer memoria del usuario en SQLite
      db.ts             # Conexión y persistencia en SQLite (data/edith.db)
    data/
    .env.example
    package.json
    tsconfig.json
  README.md
  .gitignore
```

---

## 1. Cómo crear las credenciales de Google (Gmail + Calendar)

1. Entra a [Google Cloud Console](https://console.cloud.google.com/) y crea un proyecto nuevo (por ejemplo `edith-mvp`).
2. Ve a **APIs y servicios > Biblioteca** y habilita:
   - **Gmail API**
   - **Google Calendar API**
3. Ve a **APIs y servicios > Pantalla de consentimiento de OAuth**:
   - Tipo de usuario: **Externo**
   - Nombre de la app: `Edith`
   - Agrega estos 3 scopes:
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/calendar.events`
   - En **Usuarios de prueba**, agrega tu correo de Gmail.
4. Ve a **APIs y servicios > Credenciales > Crear credenciales > ID de cliente de OAuth**:
   - Tipo de aplicación: **Aplicación web**
   - En **URI de redirección autorizados**, agrega exactamente:
     `http://localhost:3001/auth/google/callback`
5. Copia el **Client ID** y el **Client Secret**.

---

## 2. Configurar las variables de entorno (`.env`)

### Backend (`backend/.env`)

Edita el archivo `backend/.env` (o créalo a partir de `backend/.env.example`):

```env
PORT=3001
FRONTEND_URL=http://localhost:5173
GEMINI_API_KEY=tu_clave_de_gemini
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_CLIENT_ID=tu_client_id_de_google
GOOGLE_CLIENT_SECRET=tu_client_secret_de_google
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
GOOGLE_SCOPES=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events
SESSION_SECRET=una_frase_larga_aleatoria
DATABASE_PATH=./data/edith.db
```

> Tu `GEMINI_API_KEY` la obtienes gratis en [Google AI Studio](https://aistudio.google.com/app/apikey).

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:3001
```

---

## 3. Instalación y ejecución

### Terminal 1 — Backend (Puerto 3001)

```bash
cd backend
npm install
npm run dev
```

### Terminal 2 — Frontend (Puerto 5173)

```bash
cd frontend
npm install
npm run dev
```

Abre en tu navegador: `http://localhost:5173`

---

## 4. Endpoints principales del Backend

- `GET  /health` → `{ ok: true }`
- `GET  /auth/status` → Estado de conexión OAuth y variables configuradas
- `GET  /auth/google` → Inicia login con Google OAuth 2.0
- `GET  /auth/google/callback` → Recibe tokens y los guarda en SQLite (`backend/data/edith.db`)
- `POST /auth/logout` → Desconecta la cuenta de Google
- `POST /api/chat` → Hablar con Edith (usa OpenAI + tools de Gmail, Calendar y Memoria)
- `GET  /api/gmail/inbox?limit=10` → Lista los últimos 10 correos
- `GET  /api/gmail/:id` → Lee el cuerpo completo de un correo
- `POST /api/gmail/send` → Envía un correo (`{ to, subject, body }`)
- `GET  /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD` → Lista eventos del calendario
- `POST /api/calendar/events` → Crea un evento (`{ title, start, end, description?, attendees? }`)
- `DELETE /api/calendar/events/:id` → Elimina un evento
- `GET  /api/memory` y `POST /api/memory` → Consulta y guarda recuerdos del usuario en SQLite

