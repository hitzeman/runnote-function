# RunNote — Prior Art Findings

Facts from the code and git history of `runnote-function` (66 commits, Oct 28 – Nov 2025). This document leaves out run classification and description generation on purpose.

## 1. Strava App Setup

**Scopes:** `read,activity:read,activity:write`. They are hard-coded in `src/functions/authConnect.ts` with the comment "these can come from configuration object in the future". The request also sends `approval_prompt=auto`.

**Initial authorization:**
- `GET /api/auth/connect` (`authConnect`, anonymous):
  - Generates a 32-byte random hex `state` and stores it in a table.
  - Returns a 302 redirect to `STRAVA_OAUTH_URL` with `client_id`, `redirect_uri` (`AUTH_CALLBACK_URL`), `response_type=code`, `scope` and `state`.
  - Throws if `AUTH_CALLBACK_URL` is not `https://`, unless the URL contains `localhost` or `127.0.0.1`.
- `GET /api/auth/callback` (`authCallback`, anonymous):
  - Checks `state`. It must exist and be under 10 minutes old, and is deleted after one use.
  - POSTs `code` with `grant_type=authorization_code` to `https://www.strava.com/api/v3/oauth/token`.
  - Takes the athlete ID from `token.athlete.id`, saves the tokens and returns a plain-text success message.

**Token refresh** (`src/shared/strava.ts`):
- `ensureValidTokens(athleteId)` loads the stored row. It refreshes when `expires_at <= now + 60s`.
- `refreshTokens()` POSTs `grant_type=refresh_token` to the same token endpoint and overwrites the row, including the new `refresh_token`.
- If no row exists, it throws `No tokens for athlete X. Connect via /api/auth/connect first.`

**Token storage:**
- Azure Table Storage, using `@azure/data-tables` with the `AzureWebJobsStorage` connection string.
- Table `TOKENS_TABLE` (default `stravatokens`). Each row has PartitionKey `"athlete"`, RowKey = athlete ID, `access_token`, `refresh_token` and `expires_at` (epoch seconds).
- Table `STATE_TABLE` (default `oauthstates`) holds OAuth state rows: PartitionKey `"oauth"`, RowKey = state, `timestamp` (ms).
- Every read and write first calls `createTable()` and ignores any error.
- `allowInsecureConnection` is enabled when the connection string points at Azurite or localhost.
- Tokens are stored as plain entity properties. The code does no encryption at the application level.

**Secrets / configuration:**
- All settings are read from `process.env`.
- For local development they live in `local.settings.json`, which is git-ignored and listed in `.funcignore`. The README shows a template with placeholder values.
- In Azure they are expected to be Function App application settings ("Configure application settings with the required environment variables").
- The repo has no Key Vault references, managed identity or `@Microsoft.KeyVault(...)` syntax.

## 2. Webhook

**Subscription creation:**
- The repo has no script or code for it.
- The README says to "Create a webhook subscription at https://www.strava.com/settings/api", with callback `https://<domain>/api/webhook` and the `VerifyToken` value. That makes it a manual, one-time step outside the code.

**GET validation handshake** (`src/functions/webhook.ts`, function `webhook`, route defaults to `/api/webhook`, anonymous):
- Compares `hub.verify_token` to the `VerifyToken` setting. On a mismatch it returns 403 `Invalid verify token`.
- On success it returns 200 with JSON `{ "hub.challenge": <challenge> }`.
- This was added as its own commit ("add strava get verification call") right after the first working version.

**POST event handling:**
1. Parses the JSON body. If `object_type`, `aspect_type`, `object_id` or `owner_id` is missing, it logs a warning and returns 200.
2. Logs `object_type/aspect_type`, `object_id` and `owner_id`.
3. Handles only `object_type === 'activity'` with `aspect_type === 'create'`. Everything else, including activity `update`/`delete` and athlete deauthorization events, is logged as "Ignoring" and gets 200. The inline comment reads "Only handle 'create' to start (add 'update' later if you want)".
4. The webhook does not filter by sport type.
5. Steps: `ensureValidTokens` → fetch activity → analyze → build updates → `PUT` only if `description` or `name` changed.
6. All errors are caught and logged, and the handler still returns 200 ("always ACK Strava").
7. Processing is synchronous inside the HTTP request. There is no queue and no background hand-off.

**Duplicate processing:**
- The code keeps no record of processed event or activity IDs and has no locking.
- Duplicate effects are limited only by how the description is handled:
  - Every line ending in `--from RunNote` is removed before exactly one fresh line is added at the top.
  - The update is skipped when the new description and name equal the current ones.
- A later activity `update` webhook, caused by RunNote's own `PUT`, is ignored because only `create` is handled.

## 3. Strava API Usage

| Call | Endpoint | Where |
|---|---|---|
| Token exchange / refresh | `POST https://www.strava.com/api/v3/oauth/token` | `strava.ts` |
| Get activity | `GET /api/v3/activities/{id}` | `getActivity()` |
| Update activity (`description`, `name`) | `PUT /api/v3/activities/{id}` | `updateActivity()` |

- **Laps:** the code makes no separate laps call. It reads the `laps` array from the detailed activity response, which also includes `splits_metric`, `splits_standard`, `best_efforts` and `segment_efforts`, as the samples in `src/data/*.json` show.
- **Streams:** the code makes no streams call and requests no stream types.
- The code makes no `include_all_efforts` or other query parameters on the activity call.
- The deprecated `updateActivityDescription()` wrapper is still exported.
- **Rate limiting:**
  - The code does not handle 429 responses.
  - It does not read the `X-RateLimit-*` headers.
  - It has no backoff.
  - The only retry is a single token refresh plus retry on 401/403 (`withTokenRetry` in `webhook.ts`).
- HTTP client: `axios`. The code sets no explicit timeouts.

## 4. Azure Deployment

- **Runtime:** Azure Functions v4 with the Node.js programming model v4 (`@azure/functions ^4.0.0`, `app.http(...)` registration). Code is written in TypeScript and compiled by `tsc` (CommonJS, ES6) to `dist/`. The entry point is `main: dist/src/{index.js,functions/*.js}`. `FUNCTIONS_WORKER_RUNTIME=node`. The README recommends Node 20.x, and `@types/node` is `^20.x`.
- `src/index.ts` sets `app.setup({ enableHttpStream: true })`.
- `host.json`: version 2.0, extension bundle `[4.*, 5.0.0)`, and Application Insights sampling enabled with `Request` excluded.
- **Triggers:** HTTP only (three functions). There are no timer, queue or blob triggers. `cleanupExpiredStates()` has the comment "Should be called periodically, e.g., via a timer trigger", but nothing calls it.
- **Hosting plan:** the repo does not say. It contains no IaC (Bicep, ARM or Terraform) and no plan settings.
- **Storage account purpose:** `AzureWebJobsStorage` serves the Functions runtime and also holds the two app tables (`stravatokens`, `oauthstates`). Azurite is used locally (`UseDevelopmentStorage=true`).
- **Deployment method:**
  - The README documents Azure Functions Core Tools: `func azure functionapp publish <function-app-name>`.
  - The repo has no `.github/workflows` and none appear in its history.
  - `.vscode` and VS Code files are git-ignored, so VS Code use cannot be confirmed.
  - `.funcignore` leaves out `*.ts`, `.vscode`, `local.settings.json`, test data and `tsconfig.json`.
- **Required app settings (names only):**
  - `STRAVA_CLIENT_ID`
  - `STRAVA_CLIENT_SECRET`
  - `STRAVA_OAUTH_URL`
  - `AUTH_CALLBACK_URL`
  - `VerifyToken`
  - `AzureWebJobsStorage`
  - `FUNCTIONS_WORKER_RUNTIME`
  - `OPENAI_API_KEY`
  - `TOKENS_TABLE` (optional)
  - `STATE_TABLE` (optional)

## 5. Gotchas (apparently learned the hard way)

- **Always return 200 to Strava**, even on errors and invalid payloads. Comments: "always ACK Strava", "Still ACK to Strava". `SECURITY.md` explains: "Returns 200 to Strava even for invalid payloads (to prevent retries)".
- **Token race condition:** a token can pass the expiry check and still be rejected, so each Strava call is retried once after a refresh on 401/403. The 60-second skew on `expires_at` serves the same purpose.
- **Refresh tokens rotate:** every refresh overwrites the stored `refresh_token` with the new one.
- **Duplicate `--from RunNote` markers** (commit 85552e2):
  - Descriptions ended up with `--from RunNote --from RunNote` because the generated summary already contained the marker and the formatter added it again.
  - The fix removes the marker from the summary and removes every existing marker line, using a regex that ignores case and spacing.
  - The first version had prepended text without deduplicating (commit 9dd728c, "remove duplication").
- **Preserving device text:** comments note that lines written by other sources, such as COROS, must be kept in their original order under the RunNote line.
- **Write-only-if-changed:** the `PUT` is skipped when nothing differs. This avoids needless API calls and self-triggered edits.
- **Azurite needs HTTP:** `allowInsecureConnection` is toggled by checking the connection string.
- **Table name rule:** the comment says `// letters/numbers only` on the default table name.
- **Lazy table creation:** `createTable()` errors are swallowed on every call, so the tables appear on first use.
