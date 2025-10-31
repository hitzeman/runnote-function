# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RunNote is an Azure Functions application that integrates with Strava to automatically analyze running activities and update their descriptions with AI-generated workout summaries. The app uses OpenAI's GPT-4o-mini to identify workout types (threshold runs, easy runs, etc.) from Strava lap data.

## Build and Development Commands

```bash
# Build TypeScript to JavaScript
npm run build

# Watch mode for development (rebuilds on file changes)
npm run watch

# Clean build artifacts
npm run clean

# Start the Azure Functions runtime locally
npm start

# Full rebuild and start (cleans, builds, then starts)
npm run prestart && npm start
```

## Architecture

### Core Flow

1. **OAuth Flow** (`authConnect` → `authCallback`):

   - User visits `/api/auth/connect` to authorize the app
   - After Strava approval, `/api/auth/callback` exchanges the code for tokens
   - Tokens are stored in Azure Table Storage, keyed by athlete ID

2. **Webhook Processing** (`webhook`):
   - Strava sends POST requests when athletes create/update activities
   - The function fetches full activity data (including laps)
   - OpenAI analyzes the laps to identify workout structure
   - The generated summary is prepended to the activity description
   - Changes are pushed back to Strava via their API

### Key Modules

**`src/shared/tokenStore.ts`**:

- Manages OAuth tokens in Azure Table Storage
- Uses `AzureWebJobsStorage` connection string (supports Azurite for local dev)
- Table name defaults to `stravatokens`

**`src/shared/strava.ts`**:

- All Strava API interactions (OAuth, activity fetching, updates)
- Handles token refresh with 60-second expiration skew
- Automatically retries API calls with refreshed tokens on 401/403 errors

**`src/functions/webhook.ts`**:

- Main webhook handler with GET (verification) and POST (event) support
- `getRunNoteSummaryFromOpenAI()`: Analyzes activity laps using GPT-4o-mini with detailed prompt engineering
- `applyRunNoteTopLLMSafe()`: Safely manages activity descriptions, ensuring only one RunNote annotation exists (marked with `--from RunNote`)
- Only processes `activity` + `create` events currently

### Token Management Pattern

All Strava API calls follow this retry pattern:

1. Call `ensureValidTokens(athleteId)` to get valid token (auto-refreshes if expired)
2. Make API request with access token
3. If 401/403 received, call `refreshTokens()` and retry once
4. This handles race conditions where tokens expire between validation and API call

### AI Prompt Strategy

The OpenAI prompt (`webhook.ts:36-85`) classifies runs as either Tempo (T) or Easy (E) using a two-stage detection system:

**Tempo Run Detection:**

- Analyzes the `laps` array for contiguous workout blocks
- Requires ALL of: sustained HR 150+ bpm, pace zones 3-4, duration 15-40 minutes
- Calculates pace for just the workout block (sum moving_time ÷ sum distance)
- Output: `T 3.1 mi @ avg 6:38/mi`

**Easy Run Detection:**

- Identifies runs without sustained workout blocks
- Looks for: HR in zones 1-2 (115-145 bpm), consistent pace, no elevated HR blocks
- Uses overall activity stats (total distance, moving_time, average_heartrate)
- Output: `E 11 mi @ 8:59/mi (HR 130)`

**Key Design Decisions:**

- Uses HR zones as primary differentiator (adapts to fitness level over time)
- Distance formatting: whole numbers for 10+ miles, 1 decimal otherwise
- Returns JSON: `{ "type": "T"|"E", "distance": number, "pace": "MM:SS", "hr": number }`
- Model: `gpt-4o-mini` with `temperature: 0.2` and `response_format: { type: 'json_object' }`

### Description Update Logic

The webhook handler contains commented-out code blocks (`webhook.ts:186-204`) showing previous iterations of the update logic. The active implementation (`webhook.ts:206-221`) updates the activity description only when changes are detected and includes token refresh retry logic.

## Environment Variables

Required settings (configure in `local.settings.json` for local dev):

```
STRAVA_CLIENT_ID          # Strava OAuth app ID
STRAVA_CLIENT_SECRET      # Strava OAuth secret
STRAVA_OAUTH_URL          # Usually https://www.strava.com/oauth/authorize
AUTH_CALLBACK_URL         # Your callback URL (e.g., http://localhost:7071/api/auth/callback)
VerifyToken               # Secret token for webhook verification
AzureWebJobsStorage       # Azure Storage connection string (or UseDevelopmentStorage=true for Azurite)
TOKENS_TABLE              # Optional: table name (defaults to "stravatokens")
OPENAI_API_KEY            # OpenAI API key for GPT-4o-mini
```

## Testing the OAuth Flow Locally

1. Start the function: `npm start`
2. Visit `http://localhost:7071/api/auth/connect`
3. Authorize on Strava
4. Verify tokens are stored in Table Storage
5. Manually trigger webhook with a test payload or create a real Strava activity

## Git Branch Strategy

- `main`: production branch
- Use feature branches for development (e.g., `prompt` for AI prompt changes)
- Staged changes can be brought to new branches with `git checkout -b <branch-name>`

## Key Functions and Utilities

**`fmtPaceFromMs(ms: number)`** (`webhook.ts:19-27`):

- Converts meters/second to pace format (MM:SS/km)
- Currently defined but unused in the codebase

**`applyRunNoteTopLLMSafe(existing, llmSummary, marker)`** (`webhook.ts:237-265`):

- Exported utility for managing RunNote annotations
- Strips all existing RunNote lines (case-insensitive regex match)
- Ensures exactly one RunNote line appears at the top
- Preserves other description content (e.g., from COROS devices)
