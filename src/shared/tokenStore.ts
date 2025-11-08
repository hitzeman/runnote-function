import { TableClient } from '@azure/data-tables';

export type TokenRow = {
  partitionKey: string; // "athlete"
  rowKey: string; // athlete id as string
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

function getEnv(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (v == null) throw new Error(`Missing setting: ${name}`);
  return v;
}

function table(): TableClient {
  const conn = getEnv('AzureWebJobsStorage');
  const tableName = getEnv('TOKENS_TABLE', 'stravatokens'); // letters/numbers only

  // Allow HTTP when using Azurite (UseDevelopmentStorage=true)
  const allowInsecure =
    conn.includes('UseDevelopmentStorage=true') ||
    conn.includes('127.0.0.1') ||
    conn.toLowerCase().includes('localhost');

  return TableClient.fromConnectionString(conn, tableName, {
    allowInsecureConnection: allowInsecure,
  });
}

export async function getTokens(athleteId: string): Promise<TokenRow | null> {
  const t = table();
  try {
    await t.createTable();
  } catch {}
  try {
    const e = await t.getEntity<TokenRow>('athlete', athleteId);
    console.log(`[TokenStore] Retrieved tokens for athlete ${athleteId}`);
    return e as TokenRow;
  } catch {
    console.log(`[TokenStore] No tokens found for athlete ${athleteId}`);
    return null;
  }
}

export async function saveTokens(row: TokenRow): Promise<void> {
  const t = table();
  try {
    await t.createTable();
  } catch {}
  await t.upsertEntity(row, 'Replace');
  console.log(`[TokenStore] Saved tokens for athlete ${row.rowKey}, expires_at: ${row.expires_at}`);
}
