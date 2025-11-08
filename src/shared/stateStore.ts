import { TableClient } from '@azure/data-tables';
import { randomBytes } from 'crypto';

export type StateRow = {
  partitionKey: string; // "oauth"
  rowKey: string; // state token
  timestamp: number; // creation time
};

function getEnv(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (v == null) throw new Error(`Missing setting: ${name}`);
  return v;
}

function stateTable(): TableClient {
  const conn = getEnv('AzureWebJobsStorage');
  const tableName = getEnv('STATE_TABLE', 'oauthstates');

  // Allow HTTP when using Azurite (UseDevelopmentStorage=true)
  const allowInsecure =
    conn.includes('UseDevelopmentStorage=true') ||
    conn.includes('127.0.0.1') ||
    conn.toLowerCase().includes('localhost');

  return TableClient.fromConnectionString(conn, tableName, {
    allowInsecureConnection: allowInsecure,
  });
}

/**
 * Generate a cryptographically secure random state token for OAuth CSRF protection
 */
export function generateState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Save state token to storage with timestamp
 * States expire after 10 minutes
 */
export async function saveState(state: string): Promise<void> {
  const t = stateTable();
  try {
    await t.createTable();
  } catch {}

  await t.upsertEntity(
    {
      partitionKey: 'oauth',
      rowKey: state,
      timestamp: Date.now(),
    },
    'Replace'
  );
}

/**
 * Validate and consume state token (one-time use)
 * Returns true if valid, false if invalid or expired
 */
export async function validateAndConsumeState(state: string): Promise<boolean> {
  const t = stateTable();
  try {
    await t.createTable();
  } catch {}

  try {
    const entity = await t.getEntity<StateRow>('oauth', state);

    // Check if state is older than 10 minutes (600000 ms)
    const age = Date.now() - entity.timestamp;
    if (age > 600000) {
      // Expired, delete it
      await t.deleteEntity('oauth', state);
      return false;
    }

    // Valid state, delete it (one-time use)
    await t.deleteEntity('oauth', state);
    return true;
  } catch {
    // State not found
    return false;
  }
}

/**
 * Clean up expired states (older than 10 minutes)
 * Should be called periodically, e.g., via a timer trigger
 */
export async function cleanupExpiredStates(): Promise<number> {
  const t = stateTable();
  try {
    await t.createTable();
  } catch {}

  const cutoff = Date.now() - 600000; // 10 minutes ago
  let deleted = 0;

  const entities = t.listEntities<StateRow>({
    queryOptions: { filter: `PartitionKey eq 'oauth'` },
  });

  for await (const entity of entities) {
    if (entity.timestamp < cutoff) {
      await t.deleteEntity('oauth', entity.rowKey);
      deleted++;
    }
  }

  return deleted;
}
