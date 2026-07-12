# Littlebird MCP OAuth Debug Memo

Date: 2026-07-08

## Summary

`https://birb.workslo.ai/mcp` is a working MCP endpoint when called with the configured bearer token. The live smoke check successfully initializes MCP and lists all six tools:

- `send_email`
- `reply`
- `list_inbox`
- `read_message`
- `search_inbox`
- `inbox_stats`

Littlebird still fails when it chooses its OAuth connection path. The Worker can issue a valid authorization code, but Littlebird does not successfully consume that code at `/token`.

## Current Production State

Current deployed Worker behavior:

- `GET/POST /mcp` without `Authorization: Bearer <MCP_TOKEN>` returns a plain `401 Unauthorized`.
- `POST /mcp` with `Authorization: Bearer <MCP_TOKEN>` reaches the MCP handler and passes the smoke check.
- `/mcp` no longer advertises an OAuth `WWW-Authenticate` challenge.
- CORS preflight for `app.lilbird.co` succeeds.
- OAuth helper endpoints still exist, but they are not the recommended Littlebird path.

Recent compatibility changes:

- Added a direct `/mcp` static bearer-token path before OAuth handling.
- Added `scripts/smoke-mcp.mjs` and `npm run smoke:mcp`.
- Rotated `MCP_TOKEN`.
- Changed OAuth internal `userId` from `shane` to `littlebird-owner` so authorization codes no longer expose Shane's name.
- Removed the custom `iss` authorization response parameter and the metadata flag advertising it.
- Defaulted dynamic client registrations without `token_endpoint_auth_method` to public clients (`none`).
- Enabled origin-only resource matching for OAuth resource compatibility.

## Evidence

Verified locally and against production:

```bash
npm run check
git diff --check
npx wrangler deploy --dry-run
npx wrangler deploy
MCP_TOKEN=<redacted> npm run smoke:mcp
```

Smoke result:

```text
MCP smoke passed for https://birb.workslo.ai/mcp
Tools: inbox_stats, list_inbox, read_message, reply, search_inbox, send_email
```

Unauthenticated `/mcp` now returns:

```text
HTTP/2 401
Unauthorized
```

## OAuth Findings

Littlebird uses Client ID Metadata Document (CIMD):

```text
client_id: https://app.lilbird.co/mcp/oauth/client-metadata.json
client_name: Littlebird
redirect_uri: https://app.lilbird.co/mcp/oauth/callback
token_endpoint_auth_method: none
```

The Worker accepts Littlebird's OAuth authorize request and creates a grant with:

- Client ID: `https://app.lilbird.co/mcp/oauth/client-metadata.json`
- Scope: `mail:read`, `mail:send`
- Resource: `https://birb.workslo.ai/mcp`
- PKCE method: `S256`

Synthetic OAuth tests using Littlebird's exact client metadata, redirect URI, PKCE S256, and resource successfully exchanged authorization codes at `/token`.

However, Littlebird's real callback attempts left the authorization code unconsumed in KV. That means the Worker issued the code, but Littlebird did not complete the token exchange successfully. The failure is therefore in the Littlebird OAuth callback/token-exchange leg, not in the MCP handler itself.

## Recommendation

Stop debugging this OAuth path for now.

Build a fresh, tiny server from Cloudflare's `remote-mcp-authless` demo and add only one auth layer:

- `/mcp`
- static `Authorization: Bearer <token>` check
- no OAuth provider
- no `/authorize`
- no `/token`
- no OAuth metadata

This gives Littlebird only the URL + token path and avoids its current OAuth callback behavior entirely.

## Security Note

The current `MCP_TOKEN` value appeared in chat during debugging. Rotate it again before treating this server as production-safe or before using it with a successful integration.
