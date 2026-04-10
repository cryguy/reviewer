import { Database } from 'bun:sqlite';
import * as path from 'path';
import { initializeDatabase } from './schema.ts';

export type {
  Run,
  AgentOutput,
  Review,
  RunStep,
  ConversationMemory,
  InlineComment,
  RunWithDetails,
  RunStatus,
  AgentType,
  MemoryRole,
} from './types.ts';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const PROJECT_ROOT = process.cwd();

let _db: Database | null = null;

export function getDb(dbPath?: string): Database {
  if (_db !== null) {
    return _db;
  }

  const resolvedPath = dbPath ?? path.join(PROJECT_ROOT, 'reviewer.db');
  _db = new Database(resolvedPath, { create: true });

  // Enable WAL mode for better concurrent read performance
  _db.run('PRAGMA journal_mode = WAL');
  _db.run('PRAGMA foreign_keys = ON');

  initializeDatabase(_db);

  return _db;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateId(): string {
  return crypto.randomUUID();
}
