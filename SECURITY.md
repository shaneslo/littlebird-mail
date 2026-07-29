# Security policy

## Supported version

Only the version deployed from `main` is supported.

## Reporting a vulnerability

Do not open a public issue with exploit details, bearer tokens, email content, message headers, addresses, or personal data.

Use [GitHub's private vulnerability reporting form](https://github.com/shaneslo/littlebird-mail/security/advisories/new). If that form is unavailable, contact the repository owner through the [GitHub profile](https://github.com/shaneslo) without including sensitive details in the first message.

Include the affected endpoint, the commit tested, the security impact, a minimal reproduction, and any known mitigation. Redact credentials and mailbox content from every attachment.

## Scope

Reports may cover bearer authentication, MCP request handling, inbound email parsing, outbound sender controls, D1 message storage, or Cloudflare Email Routing. Do not test by sending unsolicited email, accessing another person's mailbox, or disrupting the live service.

## Response

This project does not promise a public response-time SLA. The owner will confirm receipt, assess impact, coordinate a fix when needed, and agree on disclosure timing before sensitive details are published.
