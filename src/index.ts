import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import PostalMime from "postal-mime";

interface Env {
  DB: D1Database;
  EMAIL: SendEmail;
  LB_ADDRESS: string;
  MCP_TOKEN: string;
}

interface SendEmail {
  send(message: {
    from: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
    replyTo?: string;
  }): Promise<{ messageId: string }>;
}

function createServer(env: Env) {
  const server = new McpServer({
    name: "littlebird-mail",
    version: "1.0.0",
  });

  server.tool(
    "send_email",
    "Send an email as Littlebird.",
    {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Plain text body"),
      html: z.string().optional().describe("Optional HTML body"),
      from: z.string().optional().describe("Override From address (default: LB_ADDRESS)"),
    },
    async ({ to, subject, body, html, from }) => {
      const fromAddress = from ?? env.LB_ADDRESS;
      const response = await env.EMAIL.send({
        from: fromAddress,
        to,
        subject,
        text: body,
        html,
      });

      const messageId = response.messageId;
      await env.DB.prepare(
        `INSERT INTO messages
         (direction, from_address, to_address, subject, body_text, body_html, message_id, thread_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
        .bind("outbound", fromAddress, to, subject, body, html ?? null, messageId, messageId)
        .run();

      return {
        content: [
          {
            type: "text",
            text: `Sent email to ${to} from ${fromAddress} (ID: ${messageId})`,
          },
        ],
      };
    }
  );

  server.tool(
    "reply",
    "Reply to an existing message by its message_id.",
    {
      message_id: z.string().describe("Message ID to reply to"),
      body: z.string().describe("Reply body text"),
      html: z.string().optional().describe("Optional HTML body"),
    },
    async ({ message_id, body, html }) => {
      const original = await env.DB.prepare(
        `SELECT * FROM messages WHERE message_id = ?`
      )
        .bind(message_id)
        .first();

      if (!original) {
        return {
          content: [{ type: "text", text: `Message ${message_id} not found.` }],
          isError: true,
        };
      }

      const to = original.from_address as string;
      const rawSubject = (original.subject as string) ?? "";
      const subject = rawSubject.startsWith("Re:") ? rawSubject : `Re: ${rawSubject}`;
      const threadId = (original.thread_id as string) ?? message_id;

      const response = await env.EMAIL.send({
        from: env.LB_ADDRESS,
        to,
        subject,
        text: body,
        html,
        headers: {
          "In-Reply-To": message_id,
          References: `${(original.message_id as string) ?? ""} ${message_id}`.trim(),
        },
      });

      const replyId = response.messageId;
      await env.DB.prepare(
        `INSERT INTO messages
         (direction, from_address, to_address, subject, body_text, body_html, message_id, thread_id, in_reply_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
        .bind("outbound", env.LB_ADDRESS, to, subject, body, html ?? null, replyId, threadId, message_id)
        .run();

      return {
        content: [
          {
            type: "text",
            text: `Replied to ${to} (Reply ID: ${replyId})`,
          },
        ],
      };
    }
  );

  server.tool(
    "list_inbox",
    "List inbox messages with optional filters.",
    {
      limit: z.number().int().min(1).max(100).optional().default(20).describe("Max results to return"),
      offset: z.number().int().min(0).optional().default(0).describe("Offset for pagination"),
      unread_only: z.boolean().optional().default(false).describe("Only unread messages"),
    },
    async ({ limit, offset, unread_only }) => {
      let sql = `SELECT id, direction, from_address, to_address, subject, message_id, thread_id, created_at, read_at, labels
                   FROM messages
                   WHERE direction = 'inbound'`;
      if (unread_only) sql += ` AND read_at IS NULL`;
      sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

      const { results } = await env.DB.prepare(sql).bind(limit, offset).all();

      return {
        content: [
          { type: "text", text: JSON.stringify(results ?? [], null, 2) },
        ],
      };
    }
  );

  server.tool(
    "read_message",
    "Read a specific message by its message_id. Marks it as read.",
    {
      message_id: z.string().describe("Message ID to read"),
    },
    async ({ message_id }) => {
      const msg = await env.DB.prepare(
        `SELECT * FROM messages WHERE message_id = ?`
      )
        .bind(message_id)
        .first();

      if (!msg) {
        return {
          content: [{ type: "text", text: `Message ${message_id} not found.` }],
          isError: true,
        };
      }

      await env.DB.prepare(
        `UPDATE messages SET read_at = datetime('now') WHERE message_id = ?`
      )
        .bind(message_id)
        .run();

      return {
        content: [{ type: "text", text: JSON.stringify(msg, null, 2) }],
      };
    }
  );

  server.tool(
    "search_inbox",
    "Search inbox messages by query string.",
    {
      query: z.string().describe("Search term"),
      limit: z.number().int().optional().default(20).describe("Max results"),
    },
    async ({ query, limit }) => {
      const like = `%${query}%`;
      const { results } = await env.DB.prepare(
        `SELECT * FROM messages
         WHERE direction = 'inbound'
           AND (subject LIKE ? OR body_text LIKE ? OR from_address LIKE ?)
         ORDER BY created_at DESC LIMIT ?`
      )
        .bind(like, like, like, limit)
        .all();

      return {
        content: [{ type: "text", text: JSON.stringify(results ?? [], null, 2) }],
      };
    }
  );

  server.tool(
    "inbox_stats",
    "Get inbox statistics (total and unread counts).",
    {},
    async () => {
      const total = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM messages WHERE direction = 'inbound'`
      ).first();
      const unread = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM messages WHERE direction = 'inbound' AND read_at IS NULL`
      ).first();

      return {
        content: [
          {
            type: "text",
            text: `Total inbound: ${(total as any)?.count ?? 0}\nUnread: ${(unread as any)?.count ?? 0}`,
          },
        ],
      };
    }
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(JSON.stringify({ ok: true, name: "littlebird-mail" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/mcp") {
      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.MCP_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }

      const server = createServer(env);
      return createMcpHandler(server)(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    try {
      const raw = await new Response(message.raw).arrayBuffer();
      const parsed = await new PostalMime().parse(raw);

      const from = (parsed.from as any)?.address ?? message.from;
      const to = (parsed.to as any[])?.map((t: any) => t.address).join(", ") ?? message.to;
      const subject = parsed.subject ?? "";
      const bodyText = parsed.text ?? "";
      const bodyHtml = parsed.html ?? null;
      const messageId = parsed.messageId ?? crypto.randomUUID();
      const inReplyTo = (parsed as any).inReplyTo ?? null;

      let threadId = inReplyTo ?? messageId;
      if (inReplyTo) {
        const parent = await env.DB.prepare(
          `SELECT thread_id FROM messages WHERE message_id = ?`
        )
          .bind(inReplyTo)
          .first();
        if (parent) {
          threadId = (parent as any).thread_id;
        }
      }

      const headers = JSON.stringify(
        (parsed.headers ?? []).map((h: any) => ({ key: h.key, value: h.value }))
      );

      await env.DB.prepare(
        `INSERT INTO messages
         (direction, from_address, to_address, subject, body_text, body_html, message_id, thread_id, in_reply_to, raw_headers, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
        .bind(
          "inbound",
          from,
          to,
          subject,
          bodyText,
          bodyHtml,
          messageId,
          threadId,
          inReplyTo,
          headers
        )
        .run();

      console.log(`Stored inbound email ${messageId} from ${from}`);
    } catch (err) {
      console.error("Inbound email error:", err);
      message.setReject("Failed to process inbound email");
    }
  },
} satisfies ExportedHandler<Env>;
