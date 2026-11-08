// Test the ShopPal MCP server over stdio: initialize, list tools, call a few.
// Run: node test_mcp.js  (the ShopPal server must be running on localhost:3000)
const { spawn } = require('child_process');

const child = spawn('node', ['mcp-server.js'], {
  cwd: __dirname,
  env: { ...process.env, SHOPPAL_API_BASE: 'http://localhost:3000' },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
let nextId = 1;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { console.error('bad JSON from mcp server:', line); continue; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }
});

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); }
}

(async () => {
  try {
    const init = await send('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'shoppal-mcp-test', version: '1.0.0' },
    });
    check('mcp initialize', init && init.serverInfo && init.serverInfo.name === 'shoppal-mcp', init);
    notify('notifications/initialized', {});

    const tools = await send('tools/list', {});
    const names = (tools.tools || []).map((t) => t.name);
    check('mcp tools list has 8 tools', names.length === 8, names);
    check('mcp has get_access_token', names.includes('get_access_token'), names);
    check('mcp has create_paypal_order', names.includes('create_paypal_order'), names);
    check('mcp has capture_order', names.includes('capture_order'), names);
    check('mcp has split_payment_link', names.includes('split_payment_link'), names);
    check('mcp has track_and_dispute', names.includes('track_and_dispute'), names);
    check('mcp has search_mock_products', names.includes('search_mock_products'), names);
    check('mcp has check_budget_guardrail', names.includes('check_budget_guardrail'), names);
    check('mcp has simulate_price_change', names.includes('simulate_price_change'), names);
    check('mcp has no create_sandbox_invoice', !names.includes('create_sandbox_invoice'), names);

    const guard = await send('tools/call', {
      name: 'check_budget_guardrail',
      arguments: { totalUSD: 65.57, category: 'Headphones' },
    });
    const guardText = (guard.content || [])[0]?.text || '';
    let guardData = {};
    try { guardData = JSON.parse(guardText); } catch (e) {}
    check('mcp guardrail >$20 needs approval', guardData.needsApproval === true, guardData);

    const token = await send('tools/call', { name: 'get_access_token', arguments: {} });
    const tokenText = (token.content || [])[0]?.text || '';
    let tokenData = {};
    try { tokenData = JSON.parse(tokenText); } catch (e) {}
    check('mcp get_access_token ok', tokenData.ok === true && !tokenText.includes('access_token'), tokenData);

    const search = await send('tools/call', {
      name: 'search_mock_products',
      arguments: { query: 'headphones under $60' },
    });
    const searchText = (search.content || [])[0]?.text || '';
    let searchData = {};
    try { searchData = JSON.parse(searchText); } catch (e) {}
    check('mcp search_mock_products finds headphones', Array.isArray(searchData.products) && searchData.products.length > 0, searchData);

    const price = await send('tools/call', {
      name: 'simulate_price_change',
      arguments: { productId: 'p03', newPrice: 25 },
    });
    const priceText = (price.content || [])[0]?.text || '';
    let priceData = {};
    try { priceData = JSON.parse(priceText); } catch (e) {}
    check('mcp simulate_price_change returns watch', priceData.watch && priceData.watch.productId === 'p03' && priceData.watch.targetPrice === 25, priceData);
  } catch (err) {
    fail++;
    console.log('FAIL mcp run', err.message);
  } finally {
    child.kill();
  }

  // Fail-fast: when the ShopPal server is not running, a tool call must
  // return a clear "start it first" error, not a raw fetch/ECONNREFUSED.
  const dead = spawn('node', ['mcp-server.js'], {
    cwd: __dirname,
    env: { ...process.env, SHOPPAL_API_BASE: 'http://localhost:39999' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let deadBuf = '';
  let deadId = 1;
  const deadPending = new Map();
  function deadSend(method, params) {
    return new Promise((resolve, reject) => {
      const id = deadId++;
      deadPending.set(id, { resolve, reject });
      dead.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  dead.stdout.on('data', (chunk) => {
    deadBuf += chunk.toString();
    let idx;
    while ((idx = deadBuf.indexOf('\n')) >= 0) {
      const line = deadBuf.slice(0, idx);
      deadBuf = deadBuf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.id && deadPending.has(msg.id)) {
        const { resolve, reject } = deadPending.get(msg.id);
        deadPending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    }
  });
  try {
    await deadSend('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'shoppal-mcp-test', version: '1.0.0' },
    });
    dead.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    const call = await deadSend('tools/call', {
      name: 'check_budget_guardrail',
      arguments: { totalUSD: 10 },
    });
    const text = (call.content || [])[0]?.text || '';
    check('mcp fail-fast clear error', /not running/i.test(text) && /node server\.js/i.test(text), text.slice(0, 200));
    check('mcp fail-fast isError', call.isError === true, call);
  } catch (err) {
    fail++;
    console.log('FAIL mcp fail-fast', err.message);
  } finally {
    dead.kill();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
