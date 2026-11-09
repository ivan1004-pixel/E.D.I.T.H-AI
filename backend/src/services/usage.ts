import { getDb, saveDb } from '../db';

export type ApiServiceType = 'gemini' | 'gmail' | 'calendar';

export interface ServiceQuotaStatus {
  service: ApiServiceType;
  label: string;
  usedRequests: number;
  limitRequests: number;
  remainingRequests: number;
  usedTokens: number;
  limitTokens: number;
  remainingTokens: number;
  percentUsed: number;
}

/**
 * Límites diarios gratuitos seguros para no generar cargos (Free Tier):
 * - Gemini Flash Free Tier: 1,500 solicitudes/día y 1,000,000 tokens/día
 * - Gmail API Free Quota: 2,500 llamadas/día seguras de uso personal (Google da 1B quota units/día gratis)
 * - Google Calendar API Free Quota: 2,500 llamadas/día (Google da 1,000,000 queries/día gratis)
 */
const DAILY_FREE_LIMITS: Record<
  ApiServiceType,
  { label: string; requests: number; tokens: number }
> = {
  gemini: {
    label: 'Google Gemini API (Free Tier)',
    requests: 1500,
    tokens: 1000000,
  },
  gmail: {
    label: 'Gmail API (Cuota Gratuita)',
    requests: 2500,
    tokens: 0,
  },
  calendar: {
    label: 'Google Calendar API (Cuota Gratuita)',
    requests: 2500,
    tokens: 0,
  },
};

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Registra el uso de una API (solicitudes y tokens opcionales) en el día actual.
 */
export async function recordApiUsage(
  service: ApiServiceType,
  requestsDelta = 1,
  tokensDelta = 0
): Promise<void> {
  const db = await getDb();
  const today = getTodayKey();

  db.run(
    `INSERT INTO api_usage (date, service, requests, tokens)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date, service) DO UPDATE SET
       requests = api_usage.requests + excluded.requests,
       tokens = api_usage.tokens + excluded.tokens`,
    [today, service, requestsDelta, tokensDelta]
  );
  saveDb();
}

/**
 * Devuelve el resumen de consumo del día actual y cuánto queda disponible gratis.
 */
export async function getTodayApiUsage(): Promise<{
  date: string;
  services: Record<ApiServiceType, ServiceQuotaStatus>;
}> {
  const db = await getDb();
  const today = getTodayKey();

  const stmt = db.prepare(
    'SELECT service, requests, tokens FROM api_usage WHERE date = ?'
  );
  stmt.bind([today]);

  const rawMap: Record<string, { requests: number; tokens: number }> = {};
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    rawMap[String(row.service)] = {
      requests: Number(row.requests) || 0,
      tokens: Number(row.tokens) || 0,
    };
  }
  stmt.free();

  const services = {} as Record<ApiServiceType, ServiceQuotaStatus>;

  (['gemini', 'gmail', 'calendar'] as ApiServiceType[]).forEach((svc) => {
    const usedReq = rawMap[svc]?.requests || 0;
    const usedTok = rawMap[svc]?.tokens || 0;
    const limitReq = DAILY_FREE_LIMITS[svc].requests;
    const limitTok = DAILY_FREE_LIMITS[svc].tokens;

    const remReq = Math.max(0, limitReq - usedReq);
    const remTok = limitTok > 0 ? Math.max(0, limitTok - usedTok) : 0;
    const pct = Math.min(100, Math.round((usedReq / limitReq) * 1000) / 10);

    services[svc] = {
      service: svc,
      label: DAILY_FREE_LIMITS[svc].label,
      usedRequests: usedReq,
      limitRequests: limitReq,
      remainingRequests: remReq,
      usedTokens: usedTok,
      limitTokens: limitTok,
      remainingTokens: remTok,
      percentUsed: pct,
    };
  });

  return {
    date: today,
    services,
  };
}

