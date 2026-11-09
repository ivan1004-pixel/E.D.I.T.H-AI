import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import {
  checkGoogleEnvConfig,
  clearTokens,
  createOAuthClient,
  getGoogleAuthUrl,
  isGoogleConnected,
  saveTokens,
} from '../services/google';

const router = Router();

/**
 * GET /auth/status
 * Verifica si Google está conectado, lista todas las cuentas conectadas y si las credenciales OAuth están configuradas.
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const envCheck = checkGoogleEnvConfig();
    const status = await isGoogleConnected();
    res.json({
      connected: status.connected,
      email: status.email,
      accounts: status.accounts,
      configured: envCheck.valid,
      missingEnv: envCheck.missing,
      authUrl: '/auth/google',
    });
  } catch (err: any) {
    res.status(500).json({
      connected: false,
      accounts: [],
      error: err?.message || 'Error al verificar el estado de autenticación.',
    });
  }
});

/**
 * GET /auth/google
 * Redirige al consentimiento de Google OAuth 2.0 permitiendo seleccionar o añadir otra cuenta.
 */
router.get('/google', (_req: Request, res: Response) => {
  try {
    const url = getGoogleAuthUrl();
    res.redirect(url);
  } catch (err: any) {
    res.status(400).json({
      ok: false,
      error:
        err?.message ||
        'No se pudo iniciar la autenticación con Google. Verifica GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI en backend/.env.',
    });
  }
});

/**
 * GET /auth/google/callback
 * Recibe el código de Google, obtiene access_token y refresh_token y agrega la cuenta a SQLite (`google_accounts`).
 */
router.get('/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!code) {
    res.redirect(`${frontendUrl}?auth=error&reason=missing_code`);
    return;
  }

  try {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    let email: string | null = null;
    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      email = profile.data.emailAddress || null;
    } catch {
      email = null;
    }

    await saveTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      email,
    });

    res.redirect(`${frontendUrl}?auth=success`);
  } catch (err: any) {
    console.error('Error en /auth/google/callback:', err);
    res.redirect(
      `${frontendUrl}?auth=error&reason=${encodeURIComponent(
        err?.message || 'oauth_callback_failed'
      )}`
    );
  }
});

/**
 * POST /auth/logout
 * Desconecta una cuenta específica (`{ email }`) o todas si no se envía email.
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const email = req.body?.email ? String(req.body.email) : undefined;
    await clearTokens(email);
    const status = await isGoogleConnected();
    res.json({
      ok: true,
      connected: status.connected,
      accounts: status.accounts,
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al cerrar sesión de Google.',
    });
  }
});

export default router;
