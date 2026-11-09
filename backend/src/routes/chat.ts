import { Router, Request, Response } from 'express';
import {
  chatWithEdith,
  clearChatHistory,
  createConversation,
  deleteConversation,
  getChatHistory,
  listConversations,
  transcribeAudioWithGemini,
} from '../services/openai';

const router = Router();

/**
 * GET /api/chat/conversations
 * Lista todas las conversaciones de chat guardadas.
 */
router.get('/conversations', async (_req: Request, res: Response) => {
  try {
    const conversations = await listConversations();
    res.json({ ok: true, conversations });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al listar las conversaciones.',
    });
  }
});

/**
 * POST /api/chat/conversations
 * Crea una nueva conversación de chat.
 */
router.post('/conversations', async (req: Request, res: Response) => {
  try {
    const title = req.body?.title ? String(req.body.title) : 'Nuevo Chat';
    const conversation = await createConversation(title);
    res.status(201).json({ ok: true, conversation });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al crear la conversación.',
    });
  }
});

/**
 * DELETE /api/chat/conversations/:id
 * Elimina una conversación y sus mensajes.
 */
router.delete('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await deleteConversation(id);
    res.json({ ok: true, deletedId: id });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al eliminar la conversación.',
    });
  }
});

/**
 * GET /api/chat/history?userId=ivan&conversationId=default
 * Devuelve el historial de conversación guardado en SQLite.
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || 'ivan';
    const conversationId = (req.query.conversationId as string) || 'default';
    const history = await getChatHistory(userId, 50, conversationId);
    res.json({ ok: true, history });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al cargar el historial del chat.',
    });
  }
});

/**
 * DELETE /api/chat/history?userId=ivan&conversationId=default
 * Borra el historial de una conversación.
 */
router.delete('/history', async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || 'ivan';
    const conversationId = (req.query.conversationId as string) || 'default';
    await clearChatHistory(userId, conversationId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al borrar el historial del chat.',
    });
  }
});

/**
 * POST /api/chat/transcribe
 * Recibe { audioBase64, mimeType } y devuelve { ok: true, text } transcrito con Gemini.
 */
router.post('/transcribe', async (req: Request, res: Response) => {
  try {
    const { audioBase64, mimeType } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({ ok: false, error: 'No se recibió audio para transcribir.' });
      return;
    }

    const text = await transcribeAudioWithGemini(
      audioBase64,
      mimeType ? String(mimeType) : 'audio/webm'
    );
    res.json({ ok: true, text });
  } catch (err: any) {
    console.error('Error en POST /api/chat/transcribe:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al transcribir el audio con Gemini.',
    });
  }
});

/**
 * POST /api/chat
 * Recibe { message, userId, conversationId } y responde con la respuesta de Edith.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { message, userId, conversationId } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({
        error: 'El campo "message" es obligatorio y no puede estar vacío.',
      });
      return;
    }

    const result = await chatWithEdith(
      message.trim(),
      userId || 'ivan',
      conversationId || 'default'
    );
    res.json({
      ok: true,
      reply: result.reply,
      toolsUsed: result.toolsUsed,
    });
  } catch (err: any) {
    console.error('Error en POST /api/chat:', err);
    res.status(500).json({
      ok: false,
      error:
        err?.message ||
        'Ocurrió un error al comunicarse con Edith. Revisa que tu GEMINI_API_KEY sea válida en backend/.env.',
    });
  }
});

export default router;
