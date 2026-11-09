import { getDb, saveDb } from '../db';

export interface MemoryItem {
  key: string;
  value: string;
  updated_at: string;
}

/**
 * Obtiene todos los recuerdos almacenados en la tabla `memory`.
 */
export async function getAllMemory(): Promise<MemoryItem[]> {
  const db = await getDb();
  const stmt = db.prepare('SELECT key, value, updated_at FROM memory ORDER BY updated_at DESC');
  const items: MemoryItem[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as MemoryItem;
    items.push(row);
  }
  stmt.free();
  return items;
}

/**
 * Guarda o actualiza un recuerdo en la tabla `memory`.
 */
export async function setMemory(key: string, value: string): Promise<MemoryItem> {
  const db = await getDb();
  const cleanKey = key.trim().toLowerCase().replace(/\s+/g, '_');
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO memory (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [cleanKey, value.trim(), now]
  );
  saveDb();

  return {
    key: cleanKey,
    value: value.trim(),
    updated_at: now,
  };
}

/**
 * Elimina un recuerdo por su clave.
 */
export async function deleteMemory(key: string): Promise<boolean> {
  const db = await getDb();
  db.run('DELETE FROM memory WHERE key = ?', [key]);
  saveDb();
  return true;
}

/**
 * Detecta si el mensaje del usuario contiene una instrucción explícita tipo "recuerda que..."
 * y la guarda automáticamente además de permitir que el tool de IA también lo haga.
 */
export async function extractImplicitMemoryFromMessage(message: string): Promise<void> {
  const regex = /recuerda\s+que\s+(.+)/i;
  const match = message.match(regex);
  if (match && match[1]) {
    const note = match[1].trim();
    const key = `nota_${Date.now()}`;
    await setMemory(key, note);
  }
}

/**
 * Formatea la memoria para inyectarla como contexto en el prompt del sistema de Edith.
 */
export async function getFormattedMemoryContext(): Promise<string> {
  const items = await getAllMemory();
  if (items.length === 0) {
    return 'Nombre del usuario: Ivan (sin preferencias adicionales guardadas aún).';
  }
  return items
    .map((item) => `- ${item.key}: ${item.value} (actualizado: ${item.updated_at})`)
    .join('\n');
}

