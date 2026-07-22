# littlebird-mail

Littlebird's independent mailbox - a Cloudflare Worker that acts as a remote MCP server for send, read, reply, and search.

## What it does

- **Outbound**: Sends email as `littlebird-mail@workslo.ai` via Cloudflare's `send_email` Worker binding. DKIM-signed, so it lands as Littlebird - not Shane.
- **Inbound**: Receives email via Cloudflare Email Routing, parses with `postal-mime`, and stores in D1.
- **MCP Tools**: Six tools exposed over a stateless HTTP endpoint (`/mcp`):
  - `send_email` - Send mail as Littlebird
  - `reply` - Reply to an existing thread
  - `list_inbox` - Paginated inbox list, optional unread-only filter
  - `read_message` - Full message body + marks as read
  - `search_inbox` - Text search across subject, body, and from
  - `inbox_stats` - Total and unread counts

## Architecture

- **Stateless**: No Durable Objects or session state. All persistence is D1.
- **Auth**: `/mcp` accepts only `Authorization: Bearer <MCP_TOKEN>`. Unauthenticated requests return a plain `401`; there is no OAuth provider, authorization flow, token exchange, dynamic registration, or OAuth metadata.
- **Threading**: Unified `messages` table with `thread_id` and `in_reply_to`. Replies attach to the parent thread.

## Deploy

### 1. Domain setup (alive-node only)

- Onboard `workslo.ai` to **Cloudflare Email Service** (Dashboard: Compute & AI > Email Service > Onboard Domain).
- Add SPF + DKIM records as instructed.

### 2. Install & generate types

```bash
npm install
npx wrangler types  # Generates worker-configuration.d.ts with runtime types
```

### 3. Deploy

```bash
npx wrangler deploy
```

### 4. Set the bearer secret for a new deployment

```bash
npx wrangler secret put MCP_TOKEN
# Enter a long random string. Littlebird uses this as the Remote MCP bearer token.
```

Existing deployments keep their current `MCP_TOKEN`; a normal code deploy does not expose, replace, or rotate it. Do not re-run this command unless you intentionally need to replace the secret.

### 5. Inbound routing rule

Dashboard: Email Service > Email Routing > Create rule
- **Custom address**: `littlebird-mail@workslo.ai`
- **Action**: **Send to a Worker**
- **Worker**: `littlebird-mail`

### 6. Wire up the MCP client

In **Littlebird Settings > Integrations**, add a Remote MCP server:
- **URL**: `https://birb.workslo.ai/mcp`
- **Auth**: Bearer token = the value you set in step 4

This is the service's only authentication path. OAuth endpoints such as `/authorize`, `/token`, and `/register` are intentionally not exposed.

### 7. Smoke check the deployed MCP endpoint

Use the same URL + token shape as Littlebird:

```bash
MCP_TOKEN=<token-from-step-4> npm run smoke:mcp
```

Expected result:

```text
MCP smoke passed for https://birb.workslo.ai/mcp
Tools: inbox_stats, list_inbox, read_message, reply, search_inbox, send_email
```

## Schema

D1 database `littlebird-mail` was provisioned manually. If you start fresh, run:

```sql
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL, -- 'inbound' or 'outbound'
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  thread_id TEXT,
  in_reply_to TEXT,
  message_id TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME,
  labels TEXT,
  raw_headers TEXT
);

CREATE INDEX IF NOT EXISTS idx_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_in_reply_to ON messages(in_reply_to);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

## D1 Database ID

- **Name**: `littlebird-mail`
- **ID**: `dbc3a61d-e581-4b03-9296-eee97dfb5851`
- **Region**: WNAM

## Environment

| Binding | Name | Purpose |
|---------|------|---------|
| D1 | `DB` | Message store + config |
| send_email | `EMAIL` | Outbound mail |
| var | `LB_ADDRESS` | Default From address |
| secret | `MCP_TOKEN` | Bearer auth for `/mcp` |
