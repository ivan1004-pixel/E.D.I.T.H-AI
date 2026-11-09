import { Router, Request, Response } from 'express';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  isGoogleConnected,
  listCalendarEvents,
} from '../services/google';

const router = Router();

async function ensureGoogleConnected(res: Response): Promise<boolean> {
  const status = await isGoogleConnected();
  if (!status.connected) {
    res.status(401).json({
      connected: false,
      authUrl: '/auth/google',
      error: 'Tu cuenta de Google Calendar no está conectada. Conéctala primero.',
    });
    return false;
  }
  return true;
}

/**
 * GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD&account=email|all
 * Lista eventos reales de Google Calendar en ese rango para la cuenta indicada.
 */
router.get('/events', async (req: Request, res: Response) => {
  try {
    if (!(await ensureGoogleConnected(res))) return;

    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const account = req.query.account ? String(req.query.account) : 'all';
    const events = await listCalendarEvents(from, to, account);

    res.json({ connected: true, events });
  } catch (err: any) {
    if (err?.code === 'NOT_CONNECTED') {
      res.status(401).json({ connected: false, authUrl: '/auth/google', error: err.message });
      return;
    }
    res.status(500).json({
      error: err?.message || 'Error al obtener los eventos de Google Calendar.',
    });
  }
});

/**
 * POST /api/calendar/events
 * Crea un evento { title, start, end, description?, attendees?, account? }.
 */
router.post('/events', async (req: Request, res: Response) => {
  try {
    if (!(await ensureGoogleConnected(res))) return;

    const { title, start, end, description, attendees, account } = req.body || {};
    if (!title || !start || !end) {
      res.status(400).json({
        error: 'Faltan datos obligatorios para el evento: title, start y end son requeridos.',
      });
      return;
    }

    const event = await createCalendarEvent({
      title: String(title),
      start: String(start),
      end: String(end),
      description: description ? String(description) : undefined,
      attendees: Array.isArray(attendees) ? attendees.map(String) : undefined,
      account: account ? String(account) : undefined,
    });

    res.status(201).json({ ok: true, event });
  } catch (err: any) {
    if (err?.code === 'NOT_CONNECTED') {
      res.status(401).json({ connected: false, authUrl: '/auth/google', error: err.message });
      return;
    }
    res.status(500).json({
      error: err?.message || 'Error al crear el evento en Google Calendar.',
    });
  }
});

/**
 * DELETE /api/calendar/events/:id
 * Elimina un evento por su ID en la cuenta indicada (?account=email).
 */
router.delete('/events/:id', async (req: Request, res: Response) => {
  try {
    if (!(await ensureGoogleConnected(res))) return;

    const eventId = String(req.params.id);
    const account = req.query.account ? String(req.query.account) : undefined;
    await deleteCalendarEvent(eventId, account);
    res.json({ ok: true, deletedId: eventId });
  } catch (err: any) {
    if (err?.code === 'NOT_CONNECTED') {
      res.status(401).json({ connected: false, authUrl: '/auth/google', error: err.message });
      return;
    }
    res.status(500).json({
      error: err?.message || 'Error al eliminar el evento de Google Calendar.',
    });
  }
});

export default router;

