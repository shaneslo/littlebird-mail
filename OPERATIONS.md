# Operations runbook

## Service map

The production service is the Cloudflare Worker `littlebird-mail`. It uses the D1 database `littlebird-mail`, the `EMAIL` outbound-email binding, the `LB_ADDRESS` configuration value, and the `MCP_TOKEN` secret. Inbound mail reaches the Worker through Cloudflare Email Routing. The remote MCP endpoint is `https://birb.workslo.ai/mcp`.

## Before a deployment

1. Confirm the intended commit and a clean worktree.
2. Install from the lockfile with `npm ci`.
3. Run `npm run check`.
4. Run `npx wrangler deploy --dry-run` and review binding changes.
5. Check the current deployment with `npx wrangler deployments status`.

Do not combine a code deployment with database deletion, Email Routing changes, sender-address changes, or token rotation.

## Deploy and verify

Deploy with:

```sh
npm run deploy
```

Confirm an unauthenticated MCP request is rejected. Then run the authenticated smoke test with `MCP_TOKEN` supplied from a secure local source:

```sh
MCP_TOKEN="<secure local value>" npm run smoke:mcp
```

Do not paste the token into a ticket, pull request, shared terminal transcript, or log. If the change affects email, test one controlled inbound or outbound message and verify its stored direction, recipient, and delivery result.

## Roll back code

Inspect recent versions, then start an interactive rollback:

```sh
npx wrangler deployments list
npx wrangler rollback
```

A rollback creates a new deployment immediately. It may fail when a required binding was removed or changed. Restore the binding first, then retry and repeat the MCP and email checks. See [Cloudflare's rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

A Worker rollback does not reverse D1 messages or email delivery. Preserve mailbox evidence before any manual data repair.

## Secret rotation and incidents

Rotate `MCP_TOKEN` only as an explicit operation. Update every authorized client in the same maintenance window, verify the new token, and confirm the old token is rejected. If message content or credentials may be exposed, contain access first, rotate affected credentials, then review Cloudflare and email-delivery evidence without copying message bodies into public systems.
