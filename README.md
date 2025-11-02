# RunNote

An Azure Functions application that automatically analyzes Strava running activities and updates their descriptions with AI-generated workout summaries.

## Features

- **Automatic Workout Classification**: Uses OpenAI GPT-4o-mini to identify workout types (Tempo runs, Easy runs, etc.) from Strava lap data
- **Smart Description Updates**: Prepends AI-generated summaries to activity descriptions without overwriting existing content
- **Strava OAuth Integration**: Secure authentication flow with token management and automatic refresh
- **Webhook Event Processing**: Real-time processing of Strava activity creation events
- **Heart Rate Zone Analysis**: Classifies workouts based on sustained HR zones and pace data
- **Idempotent Updates**: Safely manages activity descriptions, ensuring only one RunNote annotation exists

## Prerequisites

- [Node.js](https://nodejs.org/) (v20.x or higher recommended)
- [Azure Functions Core Tools](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) v4
- [Azure Storage Emulator](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) (Azurite) for local development
- Strava API application ([create one here](https://www.strava.com/settings/api))
- OpenAI API key

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd runnote-function
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `local.settings.json` file in the project root:
   ```json
   {
     "IsEncrypted": false,
     "Values": {
       "AzureWebJobsStorage": "UseDevelopmentStorage=true",
       "FUNCTIONS_WORKER_RUNTIME": "node",
       "STRAVA_CLIENT_ID": "your_strava_client_id",
       "STRAVA_CLIENT_SECRET": "your_strava_client_secret",
       "STRAVA_OAUTH_URL": "https://www.strava.com/oauth/authorize",
       "AUTH_CALLBACK_URL": "http://localhost:7071/api/auth/callback",
       "VerifyToken": "your_webhook_verify_token",
       "TOKENS_TABLE": "stravatokens",
       "OPENAI_API_KEY": "your_openai_api_key"
     }
   }
   ```

4. Start Azure Storage Emulator (Azurite):
   ```bash
   azurite --silent --location ./azurite --debug ./azurite/debug.log
   ```

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `STRAVA_CLIENT_ID` | Strava OAuth application ID | `12345` |
| `STRAVA_CLIENT_SECRET` | Strava OAuth application secret | `abc123...` |
| `STRAVA_OAUTH_URL` | Strava OAuth authorization URL | `https://www.strava.com/oauth/authorize` |
| `AUTH_CALLBACK_URL` | OAuth callback URL (must match Strava app settings) | `http://localhost:7071/api/auth/callback` |
| `VerifyToken` | Secret token for Strava webhook verification | `my_secret_token` |
| `AzureWebJobsStorage` | Azure Storage connection string | `UseDevelopmentStorage=true` |
| `TOKENS_TABLE` | Table name for storing OAuth tokens | `stravatokens` (default) |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o-mini | `sk-...` |

### Strava Webhook Setup

1. Create a webhook subscription at https://www.strava.com/settings/api
2. Set the callback URL to `https://your-domain.com/api/webhook`
3. Use the `VerifyToken` value for verification

## Usage

### Development

```bash
# Build TypeScript to JavaScript
npm run build

# Watch mode for development (rebuilds on file changes)
npm run watch

# Clean build artifacts
npm run clean

# Start the Azure Functions runtime locally
npm start

# Full rebuild and start
npm run prestart && npm start
```

### Testing the OAuth Flow

1. Start the function app: `npm start`
2. Visit `http://localhost:7071/api/auth/connect` in your browser
3. Authorize the application on Strava
4. Verify tokens are stored in Azure Table Storage
5. Create a running activity on Strava to trigger webhook processing

## Architecture

### Core Flow

1. **OAuth Flow** (`authConnect` → `authCallback`):
   - User visits `/api/auth/connect` to authorize the app
   - After Strava approval, `/api/auth/callback` exchanges the authorization code for access tokens
   - Tokens are stored in Azure Table Storage, keyed by athlete ID

2. **Webhook Processing** (`webhook`):
   - Strava sends POST requests when athletes create/update activities
   - Function fetches full activity data including lap-by-lap metrics
   - OpenAI analyzes laps to identify workout structure (Tempo vs Easy runs)
   - Generated summary is prepended to the activity description
   - Changes are pushed back to Strava via their API

### Key Modules

**`src/shared/tokenStore.ts`**:
- Manages OAuth tokens in Azure Table Storage
- Handles token persistence and retrieval

**`src/shared/strava.ts`**:
- All Strava API interactions (OAuth, activity fetching, updates)
- Handles automatic token refresh with 60-second expiration skew
- Implements retry logic for API calls on 401/403 errors

**`src/functions/webhook.ts`**:
- Main webhook handler with GET (verification) and POST (event processing)
- `getRunNoteSummaryFromOpenAI()`: Analyzes activity laps using GPT-4o-mini
- `applyRunNoteTopLLMSafe()`: Safely manages activity descriptions with RunNote markers
- `calculateTempoBlockMetrics()`: Calculates metrics for tempo run blocks

### AI Workout Classification

The app uses a two-stage detection system:

**Tempo Run Detection:**
- Analyzes lap data for contiguous workout blocks
- Requires: sustained HR 150+ bpm, pace zones 3-4, duration 15-40 minutes
- Output format: `T 3.1 mi @ avg 6:38/mi`

**Easy Run Detection:**
- Identifies runs without sustained workout blocks
- Looks for: HR zones 1-2 (115-145 bpm), consistent pace
- Output format: `E 11 mi @ 8:59/mi (HR 130)`

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/auth/connect` | Initiates OAuth flow with Strava |
| `GET` | `/api/auth/callback` | Handles OAuth callback and token exchange |
| `GET` | `/api/webhook` | Webhook verification endpoint |
| `POST` | `/api/webhook` | Processes Strava activity events |

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Serverless Framework**: Azure Functions v4
- **Storage**: Azure Table Storage
- **AI**: OpenAI GPT-4o-mini
- **APIs**: Strava API v3, OpenAI API
- **HTTP Client**: Axios

## Dependencies

Key dependencies:
- `@azure/functions` - Azure Functions runtime
- `@azure/data-tables` - Azure Table Storage client
- `openai` - OpenAI API client
- `axios` - HTTP client for Strava API

See [package.json](./package.json) for the complete list.

## Development Workflow

### Branch Strategy

- `main`: Production branch
- Feature branches: Use descriptive names (e.g., `prompt`, `oauth-improvements`)
- Create feature branches: `git checkout -b feature-name`

### Making Changes

1. Create a feature branch
2. Make your changes
3. Build and test locally: `npm run build && npm start`
4. Commit with descriptive messages
5. Create a pull request to `main`

## Token Management

All Strava API calls follow a robust retry pattern:

1. Call `ensureValidTokens(athleteId)` to get valid token (auto-refreshes if expired)
2. Make API request with access token
3. If 401/403 received, call `refreshTokens()` and retry once
4. Handles race conditions where tokens expire between validation and API call

## Deployment

To deploy to Azure:

1. Create an Azure Function App
2. Configure application settings with the required environment variables
3. Deploy using Azure Functions Core Tools:
   ```bash
   func azure functionapp publish <function-app-name>
   ```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is private and proprietary.
