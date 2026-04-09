import { getDb, generateId } from './index.ts';
import type { ConversationMemory, MemoryRole } from './types.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddMemoryParams {
  pr_url: string;
  role: MemoryRole;
  content: string;
  tool_name?: string;
  tool_result?: string;
  run_id?: string;
}

type NamedBinding = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function addMemory(params: AddMemoryParams): ConversationMemory {
  const db = getDb();
  const id = generateId();

  db.query<unknown, [NamedBinding]>(
    `INSERT INTO conversation_memory (id, pr_url, role, content, tool_name, tool_result, run_id)
     VALUES ($id, $pr_url, $role, $content, $tool_name, $tool_result, $run_id)`,
  ).run({
    $id: id,
    $pr_url: params.pr_url,
    $role: params.role,
    $content: params.content,
    $tool_name: params.tool_name ?? null,
    $tool_result: params.tool_result ?? null,
    $run_id: params.run_id ?? null,
  });

  const row = db
    .query<ConversationMemory, [NamedBinding]>(
      `SELECT * FROM conversation_memory WHERE id = $id`,
    )
    .get({ $id: id });

  if (row === null) {
    throw new Error(`Failed to retrieve conversation_memory after insert: ${id}`);
  }
  return row;
}

export function getMemoryForPR(pr_url: string): ConversationMemory[] {
  const db = getDb();
  return db
    .query<ConversationMemory, [NamedBinding]>(
      `SELECT * FROM conversation_memory WHERE pr_url = $pr_url ORDER BY created_at ASC`,
    )
    .all({ $pr_url: pr_url });
}

export function getMemoryForRun(run_id: string): ConversationMemory[] {
  const db = getDb();
  return db
    .query<ConversationMemory, [NamedBinding]>(
      `SELECT * FROM conversation_memory WHERE run_id = $run_id ORDER BY created_at ASC`,
    )
    .all({ $run_id: run_id });
}

export function clearMemoryForPR(pr_url: string): void {
  const db = getDb();
  db.query<unknown, [NamedBinding]>(
    `DELETE FROM conversation_memory WHERE pr_url = $pr_url`,
  ).run({ $pr_url: pr_url });
}
