import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getDb } from './db';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import gmailRoutes from './routes/gmail';
import calendarRoutes from './routes/calendar';
import { deleteMemory, getAllMemory, setMemory } from './services/memory';
import { getTodayApiUsage } from './services/usage';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(
  cors({
    origin: [FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);
app.use(express.json({ limit: '15mb' }));

// Endpoint de salud del servidor
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Endpoint de uso y cuota gratuita de APIs (Gemini, Gmail, Calendar)
app.get('/api/usage', async (_req: Request, res: Response) => {
  try {
    const usage = await getTodayApiUsage();
    res.json({ ok: true, ...usage });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al obtener el uso de APIs.',
    });
  }
});

// Rutas de autenticación con Google OAuth
app.use('/auth', authRoutes);

// Rutas de API principales
app.use('/api/chat', chatRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/calendar', calendarRoutes);

// Endpoints de memoria del usuario (GET, POST, DELETE /api/memory)
app.get('/api/memory', async (_req: Request, res: Response) => {
  try {
    const items = await getAllMemory();
    res.json({ ok: true, memory: items });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al obtener la memoria de Edith.',
    });
  }
});

app.post('/api/memory', async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body || {};
    if (!key || !value) {
      res.status(400).json({
        ok: false,
        error: 'Se requieren los campos "key" y "value" para guardar en memoria.',
      });
      return;
    }
    const item = await setMemory(String(key), String(value));
    res.status(201).json({ ok: true, item });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al guardar en la memoria de Edith.',
    });
  }
});

app.delete('/api/memory/:key', async (req: Request, res: Response) => {
  try {
    const key = String(req.params.key);
    await deleteMemory(key);
    res.json({ ok: true, deletedKey: key });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al eliminar el recuerdo.',
    });
  }
});

// Inicializar base de datos SQLite y arrancar el servidor
async function startServer() {
  try {
    await getDb();
    app.listen(PORT, () => {
      console.log(`✅ Edith Backend corriendo en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Error al iniciar la base de datos o el servidor:', err);
    process.exit(1);
  }
}

startServer();

