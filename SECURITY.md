# Security Documentation

This document outlines the security measures implemented in RunNote to protect user data and prevent common web vulnerabilities.

## Security Improvements

### 1. CSRF Protection (OAuth State Parameter)

**Issue:** Without state validation, attackers could trick users into connecting the attacker's Strava account to the victim's RunNote session.

**Implementation:**
- `authConnect` generates a cryptographically secure random state token (64 hex characters)
- State is stored in Azure Table Storage with a 10-minute expiration
- `authCallback` validates the state before processing the OAuth callback
- State tokens are single-use (deleted after validation)

**Files:**
- `src/shared/stateStore.ts` - State token management
- `src/functions/authConnect.ts` - State generation and storage
- `src/functions/authCallback.ts` - State validation

### 2. Webhook Validation

**Issue:** Without validation, attackers could send fake webhook events to trigger unwanted API calls.

**Implementation:**
- Validates verify_token on GET requests (Strava subscription verification)
- Validates required webhook fields (object_type, aspect_type, object_id, owner_id)
- Logs all webhook events for monitoring and auditing
- Returns 200 to Strava even for invalid payloads (to prevent retries)

**Files:**
- `src/functions/webhook.ts` - Enhanced webhook validation and logging

### 3. HTTPS Enforcement

**Issue:** OAuth callback URLs should always use HTTPS in production to prevent token interception.

**Implementation:**
- Validates that `AUTH_CALLBACK_URL` uses HTTPS in production
- Allows HTTP for local development (localhost, 127.0.0.1)
- Throws error on startup if misconfigured

**Files:**
- `src/functions/authConnect.ts` - HTTPS validation logic

### 4. Token Access Logging

**Issue:** Without logging, it's difficult to detect unauthorized token access or abuse.

**Implementation:**
- Logs when tokens are retrieved from storage
- Logs when tokens are saved to storage
- Logs when tokens are refreshed via Strava API
- Includes athlete ID and expiration timestamp in logs

**Files:**
- `src/shared/tokenStore.ts` - Token retrieval and storage logging
- `src/shared/strava.ts` - Token refresh logging

## Data Protection

### What We Store

RunNote stores only the minimum data required for OAuth authentication:
- Athlete ID (numeric identifier from Strava)
- OAuth access token (6-hour expiration)
- OAuth refresh token (no expiration)
- Token expiration timestamp

### What We Don't Store

- User personal information (name, email, etc.)
- Activity data (runs, distance, pace, heart rate)
- Activity descriptions
- Location data or GPS tracks
- Any other Strava profile information

### Data Flow

1. User authorizes RunNote via OAuth (one-time)
2. RunNote stores OAuth tokens in Azure Table Storage
3. When activity is created, Strava sends webhook
4. RunNote fetches activity data using stored tokens
5. OpenAI analyzes activity in-memory (no storage)
6. Summary is sent back to Strava
7. Activity data is discarded

### Encryption

- **Data at rest:** Azure Table Storage provides automatic encryption with Microsoft-managed keys
- **Data in transit:** All API calls use HTTPS (TLS 1.2+)
- **Tokens:** Stored encrypted in Azure Table Storage

## Environment Variables

Required security settings:

```
# OAuth Configuration
STRAVA_CLIENT_ID          # Public app identifier
STRAVA_CLIENT_SECRET      # Secret (never commit to git)
STRAVA_OAUTH_URL          # https://www.strava.com/oauth/authorize
AUTH_CALLBACK_URL         # Must use HTTPS in production

# Webhook Security
VerifyToken               # Secret token for webhook verification

# Storage
AzureWebJobsStorage       # Connection string (encrypted)
TOKENS_TABLE              # Optional: token table name (default: stravatokens)
STATE_TABLE               # Optional: state table name (default: oauthstates)
```

## Best Practices

1. **Never commit secrets** - Keep `.env` and `local.settings.json` in `.gitignore`
2. **Use HTTPS in production** - Required for OAuth callbacks
3. **Monitor logs** - Review token access logs for unusual patterns
4. **Rotate secrets regularly** - Update `STRAVA_CLIENT_SECRET` and `VerifyToken` periodically
5. **Limit token scope** - Only request necessary Strava permissions (`read,activity:read,activity:write`)

## Incident Response

If you suspect a security breach:

1. **Revoke OAuth tokens** - Delete affected athlete tokens from Table Storage
2. **Rotate secrets** - Update `STRAVA_CLIENT_SECRET` in Strava dashboard
3. **Review logs** - Check Application Insights for suspicious activity
4. **Notify users** - If personal data was accessed, inform affected athletes

## Security Audit Checklist

- [ ] All production URLs use HTTPS
- [ ] Environment variables are properly secured
- [ ] OAuth state validation is enabled
- [ ] Webhook events are logged
- [ ] Token access is monitored
- [ ] Secrets are not committed to git
- [ ] Azure Table Storage encryption is enabled
- [ ] Regular log reviews are performed

## Reporting Security Issues

If you discover a security vulnerability, please email [your-email] instead of creating a public GitHub issue.

## References

- [Strava OAuth Documentation](https://developers.strava.com/docs/authentication/)
- [Strava Webhook Events](https://developers.strava.com/docs/webhooks/)
- [Azure Functions Security](https://learn.microsoft.com/en-us/azure/azure-functions/security-concepts)
- [OWASP OAuth 2.0 Security](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)
