# littlebird-mail

Littlebird's independent mailbox - a Cloudflare Worker that acts as a remote MCP server for send, read, reply, and search.

## What it does

- **Outbound**: Sends email as `little-bird@<domain>` via Cloudflare's `send_email` Worker binding. DKIM-signed, so it lands as Littlebird - not Shane.
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
- **Auth**: `/mcp` is guarded by a Bearer token (`MCP_TOKEN` secret).
- **Threading**: Unified `messages` table with `thread_id` and `in_reply_to`. Replies attach to the parent thread.

## Deploy

### 1. Domain setup (alive-node only)

- Onboard a domain to **Cloudflare Email Service** (Dashboard: Compute & AI > Email Service > Onboard Domain).
- Add SPF + DKIM records as instructed.
- Update `LB_ADDRESS` and `allowed_addresses` in `wrangler.jsonc` if you want a different domain than `smslosar.com`.

### 2. Install & deploy

```bash
npm install
npx wrangler deploy
```

### 3. Set secrets

```bash
npx wrangler secret put MCP_TOKEN
# Enter a long random string (this guards /mcp)
```

### 4. Inbound routing rule

Dashboard: Email Service > Email Routing > Create rule
- **Custom address**: `little-bird@<your-domain>`
- **Action**: **Send to a Worker**
- **Worker**: `littlebird-mail`

### 5. Wire up the MCP client

In **Littlebird Settings > Integrations**, add a Remote MCP server:
- **URL**: `https://littlebird-mail.<your-subdomain>.workers.dev/mcp`
- **Auth**: Bearer token = the value you set in step 3

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
| secret | `MCP_TOKEN` | Bearer auth for /mcp |
