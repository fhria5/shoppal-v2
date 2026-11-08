// ShopPal v2 — MCP wrapper (mcp-server.js)
//
// A thin Model Context Protocol server over stdio that exposes ShopPal's
// existing tools as MCP tools. It does NOT re-implement any logic: every
// tool call is forwarded to the running ShopPal web server (server.js)
// over HTTP, so the E2E checkout flow stays exactly as tested.
//
// Modules (as in the project brief):
//   paypal-sandbox-mcp       — PayPal Sandbox auth, orders, capture,
//                              split payment links, tracking + dispute.
//   mock-store-guardrail-mcp — mock catalog search, budget guardrail,
//                              simulated price changes.
// Notes on the brief's tool names:
//   - create_sandbox_invoice is NOT exposed: the PayPal Invoicing API
//     returns 403 NOT_AUTHORIZED for this sandbox app. split_payment_link
//     (Orders API v2) is the replacement, and it is exposed instead.
//   - The dispute in track_and_dispute is a SIMULATION (the Disputes API
//     is not called to open a real ticket); the payload it returns follows
//     the official PayPal Disputes API shape and is labelled simulated.
//
// Run:  SHOPPAL_API_BASE=http://localhost:3000 node mcp-server.js
// (the ShopPal server must be running on that base URL first).
// Test:  echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-server.js
//        after the initialize handshake (see README section "MCP server").

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const API_BASE = (process.env.SHOPPAL_API_BASE || 'http://localhost:3000').replace(/\/$/, '');

async function api(path, method, body) {
  const res = await fetch(API_BASE + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || ('ShopPal API ' + path + ' failed (HTTP ' + res.status + ')'));
    err.status = res.status;
    throw err;
  }
  return data;
}

function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer(
  { name: 'shoppal-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ---------- paypal-sandbox-mcp ----------

server.tool(
  'get_access_token',
  'Confirm the PayPal Sandbox OAuth2 client-credentials auth is working. Returns only the token status (type + seconds until expiry); the access token itself is never returned.',
  {},
  async () => textResult(await api('/api/paypal/token-status'))
);

server.tool(
  'create_paypal_order',
  'Create a PayPal Sandbox order (Orders API v2) for a catalog product. The server enforces intent CAPTURE (per the project guardrail decision); the amount must match the calculated honest total for the product. Returns orderId, status and the buyer approveUrl.',
  {
    productId: z.string().describe('Catalog product id, e.g. p01'),
    totalUSD: z.number().describe('Total the buyer approved (product price + PayPal fees)'),
    intent: z.string().optional().describe('Requested intent; the server always uses CAPTURE'),
  },
  async ({ productId, totalUSD }) =>
    textResult(await api('/api/paypal/create-order', 'POST', { productId, totalUSD }))
);

server.tool(
  'capture_order',
  'Capture a PayPal Sandbox order after the buyer approved it on PayPal. Returns the verified capture (COMPLETED) saved to the Proof Vault.',
  {
    orderId: z.string().describe('PayPal order id, e.g. 6M815901GS984845M'),
    token: z.string().optional().describe('Approval token from the PayPal return URL, if any'),
  },
  async ({ orderId, token }) =>
    textResult(await api('/api/paypal/capture-order', 'POST', { orderId, token }))
);

server.tool(
  'split_payment_link',
  'Split a product price with friends and create a separate PayPal Sandbox order + payment link for each friend\'s share (Orders API v2). Replaces create_sandbox_invoice, because the PayPal Invoicing API returns 403 for this sandbox app. The user pays their own share through the normal checkout.',
  {
    productId: z.string().describe('Catalog product id, e.g. p01'),
    friends: z.array(z.string()).min(1).describe('Friend names, one per friend'),
  },
  async ({ productId, friends }) =>
    textResult(await api('/api/split-payment-link', 'POST', { productId, friends, lang: 'en' }))
);

server.tool(
  'track_and_dispute',
  'Add a tracking number to a Proof Vault purchase via the PayPal Tracking API, then run the dispute simulator for it. The dispute is a SIMULATION (no real Disputes API ticket is opened); the returned disputePayload follows the official PayPal Disputes API shape (dispute_id, reason, status OPEN) and is labelled simulated.',
  {
    vaultId: z.string().describe('Proof Vault entry id'),
    trackingNumber: z.string().optional().describe('Tracking number; a unique default is generated when omitted'),
    carrier: z.string().optional().describe('Carrier code, e.g. FEDEX'),
    reason: z.enum(['not_received', 'not_as_described', 'unauthorized']).optional().describe('Dispute reason'),
  },
  async ({ vaultId, trackingNumber, carrier, reason }) => {
    const tracking = await api('/api/tracking/add', 'POST', { vaultId, trackingNumber, carrier, lang: 'en' });
    const dispute = await api('/api/dispute/simulate', 'POST', { vaultId, disputeType: reason || 'not_received', lang: 'en' });
    return textResult({ tracking, dispute });
  }
);

// ---------- mock-store-guardrail-mcp ----------

server.tool(
  'search_mock_products',
  'Search the mock store catalog (10 products, 3 sellers) by plain language, e.g. "headphones under $60" or "safest keyboard". Returns the matching products with risk scores, safest first.',
  {
    query: z.string().describe('Plain-language search, e.g. "headphones under $60"'),
  },
  async ({ query }) => {
    const data = await api('/api/ask?message=' + encodeURIComponent(query) + '&lang=en');
    return textResult({ reply: data.reply, products: data.products || [] });
  }
);

server.tool(
  'check_budget_guardrail',
  'Check whether a transaction amount is safe to auto-pay or needs human approval. Auto-pay limit is $20 by default; above it (or above a per-category monthly cap) the agent must stop and ask the user first. Returns needsApproval and the reasons.',
  {
    totalUSD: z.number().describe('Total amount in USD to check'),
    category: z.string().optional().describe('Product category, e.g. Headphones'),
  },
  async ({ totalUSD, category }) =>
    textResult(await api('/api/guardrails/check', 'POST', { totalUSD, category: category || null, lang: 'en' }))
);

server.tool(
  'simulate_price_change',
  'Simulate a price change for a product (Price Drop Sniper demo). Creates a price watch for the product at the target price, then moves the simulated price once and reports the new price and watch status (watching/triggered). The demo price feed is a labelled simulation; the catalog price itself is fixed.',
  {
    productId: z.string().describe('Catalog product id, e.g. p03'),
    newPrice: z.number().describe('Target price in USD to watch for'),
  },
  async ({ productId, newPrice }) => {
    const watch = await api('/api/price-watch', 'POST', { productId, targetPrice: newPrice, lang: 'en' });
    const checked = await api('/api/price-watch/check', 'POST', { watchId: watch.id });
    return textResult({ watch: checked, note: 'Demo price feed is simulated and labelled.' });
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // MCP servers speak JSON-RPC on stdout; diagnostics go to stderr only.
  console.error('shoppal-mcp failed to start:', err);
  process.exit(1);
});
