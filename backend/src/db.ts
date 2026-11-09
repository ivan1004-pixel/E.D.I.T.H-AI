import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const dbRelativePath = process.env.DATABASE_PATH || './data/edith.db';
const dbPath = path.resolve(process.cwd(), dbRelativePath);
const dbDir = path.dirname(dbPath);

let dbInstance: Database | null = null;

/**
 * Inicializa y retorna la instancia de SQLite en archivo local (`data/edith.db`).
 */
export async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    dbInstance = new SQL.Database(fileBuffer);
  } else {
    dbInstance = new SQL.Database();
  }

  // Crear tablas necesarias
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS memory (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT,
      refresh_token TEXT,
      expiry_date INTEGER,
      email TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS google_accounts (
      email TEXT PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      expiry_date INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      conversation_id TEXT DEFAULT 'default',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tools_used TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_usage (
      date TEXT NOT NULL,
      service TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, service)
    );

    CREATE TABLE IF NOT EXISTS saved_contacts (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);

  // Asegurar columnas nuevas en chat_history si la tabla ya existía de antes
  try {
    dbInstance.run("ALTER TABLE chat_history ADD COLUMN conversation_id TEXT DEFAULT 'default'");
  } catch {
    // La columna ya existe
  }
  try {
    dbInstance.run('ALTER TABLE chat_history ADD COLUMN tools_used TEXT');
  } catch {
    // La columna ya existe
  }

  // Migrar token existente de auth_tokens a google_accounts para no perder la cuenta ya conectada
  try {
    const legacyStmt = dbInstance.prepare(
      'SELECT access_token, refresh_token, expiry_date, email FROM auth_tokens WHERE id = 1'
    );
    if (legacyStmt.step()) {
      const row = legacyStmt.getAsObject() as any;
      if (row.access_token || row.refresh_token) {
        const emailKey = row.email || 'cuenta_principal@gmail.com';
        const now = new Date().toISOString();
        dbInstance.run(
          `INSERT INTO google_accounts (email, access_token, refresh_token, expiry_date, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(email) DO NOTHING`,
          [emailKey, row.access_token, row.refresh_token, row.expiry_date, now]
        );
      }
    }
    legacyStmt.free();
  } catch {
    // Ignorar si no aplica
  }

  // Asegurar conversación por defecto
  const convStmt = dbInstance.prepare('SELECT id FROM conversations WHERE id = :id');
  convStmt.bind({ ':id': 'default' });
  const hasDefaultConv = convStmt.step();
  convStmt.free();

  if (!hasDefaultConv) {
    const now = new Date().toISOString();
    dbInstance.run(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['default', 'Chat Principal', now, now]
    );
  }

  // Asegurar que el nombre del usuario en memoria sea "Ivan"
  const now = new Date().toISOString();
  dbInstance.run(
    `INSERT INTO memory (key, value, updated_at)
     VALUES ('nombre_usuario', 'Ivan', ?)
     ON CONFLICT(key) DO UPDATE SET value = 'Ivan', updated_at = excluded.updated_at`,
    [now]
  );

  saveDb();
  return dbInstance;
}

/**
 * Persiste el estado actual de la base de datos en disco (`data/edith.db`).
 */
export function saveDb(): void {
  if (!dbInstance) return;
  const data = dbInstance.export();
  const buffer = Buffer.from(data);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  fs.writeFileSync(dbPath, buffer);
}
