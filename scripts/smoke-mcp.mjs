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

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
});

try {
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
