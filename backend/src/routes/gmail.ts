import { Router, Request, Response } from 'express';
import {
  deleteSavedContact,
  getEmailById,
  isGoogleConnected,
  listInboxEmails,
  listSavedContacts,
  saveContact,
  sendEmail,
  trashEmailById,
} from '../services/google';
import { translateTextWithGemini } from '../services/openai';

const router = Router();

/**
 * GET /api/gmail/contacts
 * Devuelve todos los correos/contactos guardados automáticamente o manualmente.
 */
router.get('/contacts', async (_req: Request, res: Response) => {
  try {
    const contacts = await listSavedContacts();
    res.json({ ok: true, contacts });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Error al obtener contactos guardados.' });
  }
});

/**
 * POST /api/gmail/contacts
 * Guarda manualmente un correo frecuente { email, name? }.
 */
router.post('/contacts', async (req: Request, res: Response) => {
  try {
    const { email, name } = req.body || {};
    if (!email) {
      res.status(400).json({ error: 'Se requiere una dirección de correo válida.' });
      return;
    }
    const saved = await saveContact(String(email), name ? String(name) : undefined);
    if (!saved) {
      res.status(400).json({ error: 'El formato del correo no es válido.' });
      return;
    }
    res.status(201).json({ ok: true, contact: saved });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Error al guardar contacto.' });
  }
});

/**
 * DELETE /api/gmail/contacts/:email
 * Elimina un correo guardado.
 */
router.delete('/contacts/:email', async (req: Request, res: Response) => {
  try {
    const email = String(req.params.email);
    await deleteSavedContact(email);
    res.json({ ok: true, deletedEmail: email });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Error al eliminar contacto.' });
  }
});

async function ensureGoogleConnected(res: Response): Promise<boolean> {
  const status = await isGoogleConnected();
  if (!status.connected) {
    res.status(401).json({
      connected: false,
      authUrl: '/auth/google',
      error: 'Tu cuenta de Gmail no está conectada. Conéctala para ver o enviar correos.',
    });
    return false;
  }
  return true;
}

/**
 * GET /api/gmail/inbox?limit=10&account=all
 * Lista los correos más recientes del inbox (de una cuenta o de todas las conectadas).
 */
router.get('/inbox', async (req: Request, res: Response) => {
  try {
    if (!(await ensureGoogleConnected(res))) return;

    const rawLimit = Number(req.query.limit) || 10;
    const limit = Math.min(Math.max(rawLimit, 1), 50);
    const account = req.query.account ? String(req.query.account) : 'all';
    const emails = await listInboxEmails(limit, account);

    res.json({ connected: true, emails });
  } catch (err: any) {
    if (err?.code === 'NOT_CONNECTED') {
      res.status(401).json({ connected: false, authUrl: '/auth/google', error: err.message });
      return;
    }
    res.status(500).json({
      error: err?.message || 'Error al consultar la bandeja de entrada de Gmail.',
    });
  }
});

/**
 * POST /api/gmail/translate
 * Traduce un correo por su ID o un texto al idioma solicitado.
 */
router.post('/translate', async (req: Request, res: Response) => {
  try {
    const { id, text, targetLanguage, account } = req.body || {};
    let contentToTranslate = text ? String(text) : '';

    if (id && !contentToTranslate) {
      if (!(await ensureGoogleConnected(res))) return;
      const email = await getEmailById(String(id), account ? String(account) : undefined);
      contentToTranslate = `Asunto: ${email.subject}\n\n${email.body}`;
    }

    if (!contentToTranslate.trim()) {
      res.status(400).json({ error: 'No hay contenido para traducir.' });
      return;
    }

    const translated = await translateTextWithGemini(
      contentToTranslate,
      targetLanguage ? String(targetLanguage) : 'Español'
    );

    res.json({ ok: true, translated });
  } catch (err: any) {
    res.status(500).json({
      error: err?.message || 'Error al traducir el correo con Gemini.',
    });
  }
});

/**
 * GET /api/gmail/:id?account=...
 * Obtiene el detalle y cuerpo de un correo por su ID.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!(await ensureGoogleConnected(res))) return;

    const id = String(req.params.id);
    const account = req.query.account ? String(req.query.account) : undefined;
    const email = await getEmailById(id, account);
    res.json({ connected: true, email });
  } catch (err: any) {
    if (err?.code === 'NOT_CONNECTED') {
      res.status(401).json({ connected: false, authUrl: '/auth/google', error: err.message });
      return;
    }
    res.status(500).json({
      error: err?.message || 'Error al leer el correo de Gmail.',
    });
  }
});

/**
 * POST /api/gmail/send
 * Envía un correo { to, subject, body, account? }.
 */
router.post('/send', async (req: Request, res: Response) => {
  try {
    if (!(await ensureGoogleConnected(res))) return;

    const { to, subject, body, account } = req.body || {};
    if (!to || !subject || !body) {
      res.status(400).json({
        error:
          'Faltan campos obligatorios: se requiere destinatario (to), asunto (subject) y mensaje (body).',
      });
      return;
    }

    const result = await sendEmail(
      String(to),
      String(subject),
      String(body),
      account ? String(account) : undefined
    );
    res.json({ ok: true, id: result.id, accountEmail: result.accountEmail });
  } catch (err: any) {
    if (err?.code === 'NOT_CONNECTED') {
      res.status(401).json({ connected: false, authUrl: '/auth/google', error: err.message });
      return;
    }
    res.status(500).json({
      error: err?.message || 'Error al enviar el correo con Gmail.',
    });
  }
});

/**
 * DELETE /api/gmail/:id?account=...
 * Mueve un correo a la papelera de Gmail por su ID.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (!(await ensureGoogleConnected(res))) return;

    const id = String(req.params.id);
    const account = req.query.account ? String(req.query.account) : undefined;
    await trashEmailById(id, account);
    res.json({ ok: true, deletedId: id });
  } catch (err: any) {
    if (err?.code === 'NOT_CONNECTED') {
      res.status(401).json({ connected: false, authUrl: '/auth/google', error: err.message });
      return;
    }
    res.status(500).json({
      error:
        err?.message ||
        'Error al eliminar el correo. Si reconectas Google con el permiso gmail.modify podrás borrar correos.',
    });
  }
});

export default router;
