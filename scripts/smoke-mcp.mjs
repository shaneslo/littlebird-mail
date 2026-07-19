import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL ?? "https://birb.workslo.ai/mcp";
const token = process.env.MCP_TOKEN;

if (!token) {
  console.error("MCP_TOKEN is required. Example: MCP_TOKEN=... npm run smoke:mcp");
  process.exit(2);
}

const client = new Client({
  name: "littlebird-mail-smoke",
  version: "1.0.0",
});

const mcpUrl = new URL(url);
const transport = new StreamableHTTPClientTransport(mcpUrl, {
  requestInit: {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
});

async function expectStatus(target, expected, label, init) {
  const response = await fetch(target, init);
  if (response.status !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${response.status}`);
  }
  return response;
}

try {
  await expectStatus(mcpUrl, 401, "Unauthenticated /mcp");
  await expectStatus(mcpUrl, 401, "Invalid bearer /mcp", {
    headers: { Authorization: `Bearer ${token}-invalid` },
  });

  const preflight = await expectStatus(mcpUrl, 200, "CORS preflight", {
    method: "OPTIONS",
    headers: {
      Origin: "https://app.lilbird.co",
      "Access-Control-Request-Headers": "authorization, content-type",
      "Access-Control-Request-Method": "POST",
    },
  });
  const allowedHeaders = preflight.headers.get("Access-Control-Allow-Headers")?.toLowerCase() ?? "";
  if (!allowedHeaders.includes("authorization")) {
    throw new Error("CORS preflight does not allow the Authorization header");
  }

  const removedOAuthRoutes = [
    { path: "/authorize", method: "GET" },
    { path: "/token", method: "POST" },
    { path: "/register", method: "POST" },
    { path: "/.well-known/oauth-authorization-server", method: "GET" },
    { path: "/.well-known/oauth-protected-resource", method: "GET" },
    { path: "/mcp/.well-known/oauth-protected-resource", method: "GET" },
  ];
  for (const { path, method } of removedOAuthRoutes) {
    await expectStatus(new URL(path, mcpUrl.origin), 404, `${method} ${path}`, { method });
  }

  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  const requiredTools = [
    "inbox_stats",
    "list_inbox",
    "read_message",
    "reply",
    "search_inbox",
    "send_email",
  ];

  const missing = requiredTools.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`Connected, but missing tools: ${missing.join(", ")}`);
  }

  console.log(`MCP smoke passed for ${url}`);
  console.log(`Tools: ${toolNames.join(", ")}`);
} finally {
  await client.close();
}
