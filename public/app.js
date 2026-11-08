// ShopPal v2 — frontend skeleton for the 7-step demo flow.
// No secrets here. The PayPal client ID is loaded from /api/config at runtime.
(function () {
  'use strict';

  let catalog = null;
  let selected = null; // { product, seller, risk, cost }
  let lastVaultId = null;

  const $ = (id) => document.getElementById(id);
  const money = (n) => '$' + Number(n).toFixed(2);

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      if (!cfg.paypalClientId) {
        $('checkout-status').textContent =
          'PayPal client ID is not configured yet. Add PAYPAL_CLIENT_ID to your local .env (Day 1).';
      }
      return cfg;
    } catch (e) {
      $('checkout-status').textContent = 'Could not load /api/config: ' + e.message;
      return {};
    }
  }

  async function loadCatalog() {
    const res = await fetch('/api/catalog');
    catalog = await res.json();
    renderCatalog(catalog.products);
  }

  function sellerOf(product) {
    return catalog.sellers.find((s) => s.id === product.sellerId);
  }

  function renderCatalog(products) {
    const grid = $('catalog');
    grid.innerHTML = '';
    products.forEach((p) => {
      const seller = sellerOf(p);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'product-card';
      card.innerHTML =
        '<strong>' + p.name + '</strong><br>' +
        money(p.priceUSD) + ' · ' + p.category + '<br>' +
        'Seller: ' + seller.name + ' (' + seller.riskProfile + ')';
      card.addEventListener('click', () => selectProduct(p));
      grid.appendChild(card);
    });
  }

  async function selectProduct(product) {
    const seller = sellerOf(product);
    selected = { product, seller, risk: null, cost: null };

    // Step 2 — Risk Score
    const riskRes = await fetch('/api/risk-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sellerId: seller.id, productId: product.id }),
    });
    selected.risk = await riskRes.json();
    renderRisk();

    // Step 3 — Total Cost
    await refreshCost();

    // Step 4 — require explicit approval before checkout is enabled
    $('approve').checked = false;
    $('checkout-btn').disabled = true;
    $('checkout-status').textContent = '';
    document.getElementById('step-2').scrollIntoView({ behavior: 'smooth' });
  }

  function renderRisk() {
    const r = selected.risk;
    const zone = r.label.toLowerCase();
    $('risk').innerHTML =
      '<p><strong>' + selected.seller.name + '</strong> — ' +
      'Risk Score <span class="score score-' + zone + '">' + r.score + '/100 · ' + r.label + '</span></p>' +
      '<ul>' + r.reasons.map((reason) => '<li>' + reason + '</li>').join('') + '</ul>' +
      '<p><strong>Recommendation:</strong> ' + r.recommendation + '</p>' +
      '<p class="hint">Profile ' + r.components.profile + ' · History ' + r.components.history +
      ' · Price ' + r.components.price + ' · Tracking ' + r.components.tracking +
      (r.aiAvailable ? '' : ' · ' + (r.aiNote || 'AI explanation unavailable.')) + '</p>';
  }

  async function refreshCost() {
    if (!selected) return;
    const res = await fetch('/api/total-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priceUSD: selected.product.priceUSD,
        international: $('opt-international').checked,
        currencyConversion: $('opt-conversion').checked,
      }),
    });
    selected.cost = await res.json();
    const c = selected.cost;
    $('cost').innerHTML =
      '<table>' +
      '<tr><td>Item price</td><td>' + money(c.itemPrice) + '</td></tr>' +
      '<tr><td>PayPal Checkout fee (3.49% + $0.49)</td><td>' + money(c.paypalFee) + '</td></tr>' +
      '<tr><td>International fee (1.5%)</td><td>' + money(c.internationalFee) + '</td></tr>' +
      '<tr><td>Currency conversion spread (~3.5%, estimated)</td><td>' + money(c.conversionSpread) + '</td></tr>' +
      '<tr><td><strong>Total (estimated)</strong></td><td><strong>' + money(c.total) + '</strong></td></tr>' +
      '</table>';

    // Hold Predictor (rule-based card, stretch): warn when the seller is risky.
    const warning = $('hold-warning');
    if (selected.risk && selected.risk.label === 'Risky') {
      warning.classList.remove('hidden');
      warning.textContent =
        'Hold warning: this seller pattern is at higher risk of a payment hold. ' +
        'Ask the seller to upload tracking promptly and avoid unusual payment spikes.';
    } else {
      warning.classList.add('hidden');
      warning.textContent = '';
    }
  }

  async function refreshVault() {
    const res = await fetch('/api/vault');
    const data = await res.json();
    const vault = $('vault');
    if (!data.entries || data.entries.length === 0) {
      vault.innerHTML = '<p>No Proof Vault entries yet. Complete a successful checkout to save proof automatically.</p>';
      $('dispute-btn').disabled = true;
      return;
    }
    lastVaultId = data.entries[0].id;
    $('dispute-btn').disabled = false;
    vault.innerHTML = data.entries.map((e) =>
      '<p><strong>' + (e.product?.name || e.id) + '</strong> — ' +
      (e.paypal?.status || 'unknown') + ' · Order ' + (e.paypal?.orderId || '—') + '</p>'
    ).join('');
  }

  function bindEvents() {
    $('ask-btn').addEventListener('click', () => {
      const q = $('ask').value.trim().toLowerCase();
      if (!q || !catalog) return;
      // Simple demo matching: filter by category or name words.
      const matches = catalog.products.filter((p) =>
        q.includes(p.category.toLowerCase()) || q.includes(p.name.toLowerCase().split(' ')[0])
      );
      renderCatalog(matches.length ? matches : catalog.products);
      if (!matches.length) {
        $('catalog').insertAdjacentHTML('beforeend',
          '<p class="hint">No exact match in the demo catalog — showing all 10 demo products.</p>');
      }
    });
    $('opt-international').addEventListener('change', refreshCost);
    $('opt-conversion').addEventListener('change', refreshCost);
    $('approve').addEventListener('change', (e) => {
      $('checkout-btn').disabled = !(e.target.checked && selected);
    });
    $('checkout-btn').addEventListener('click', async () => {
      if (!selected || !$('approve').checked) return;
      $('checkout-status').textContent = 'Creating PayPal order…';
      const res = await fetch('/api/paypal/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selected.product.id,
          totalUSD: selected.cost ? selected.cost.total : selected.product.priceUSD,
          international: $('opt-international').checked,
          currencyConversion: $('opt-conversion').checked,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        $('checkout-status').textContent = 'Could not create the PayPal order: ' + (data.error || res.status);
        return;
      }
      $('checkout-status').innerHTML =
        'Order created: <strong>' + data.orderId + '</strong> — total ' + money(data.totalUSD) + '. ' +
        'Approve it in PayPal Sandbox, then you will be sent back here to capture it.';
      $('success').innerHTML =
        '<p><a href="' + data.approveUrl + '" target="_blank" rel="noopener">Approve this order in PayPal Sandbox (opens in a new tab)</a></p>' +
        '<p class="hint">Use a PayPal sandbox buyer account to approve. No real money is involved.</p>';
      if (data.approveUrl) window.open(data.approveUrl, '_blank', 'noopener');
    });
    $('vault-refresh').addEventListener('click', refreshVault);
    $('dispute-btn').addEventListener('click', async () => {
      if (!lastVaultId) return;
      const res = await fetch('/api/dispute/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultId: lastVaultId }),
      });
      const data = await res.json();
      const box = $('dispute-draft');
      box.classList.remove('hidden');
      if (!res.ok) {
        box.textContent = data.error || 'Could not generate a dispute draft.';
        return;
      }
      box.innerHTML =
        '<p><strong>Simulated dispute draft</strong> — readiness ' + data.readinessScore + '/100</p>' +
        '<p>' + data.draft + '</p>' +
        (data.missingProof && data.missingProof.length
          ? '<p>Still missing: ' + data.missingProof.join(', ') + '</p>'
          : '<p>No proof missing.</p>');
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    await loadConfig();
    await loadCatalog();
    await refreshVault();
    // PayPal return: ?approved=1&token=<orderId>&PayerID=<id> — capture it.
    const params = new URLSearchParams(window.location.search);
    if (params.get('cancelled') === '1') {
      $('checkout-status').textContent = 'Checkout was cancelled in PayPal. No payment was made.';
    } else if (params.get('approved') === '1' && params.get('token')) {
      const orderId = params.get('token');
      $('checkout-status').textContent = 'PayPal approved order ' + orderId + ' — capturing…';
      const res = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        $('checkout-status').textContent = 'Capture failed: ' + (data.error || res.status);
        return;
      }
      $('checkout-status').textContent = 'Payment captured: ' + data.captureId;
      $('success').innerHTML =
        '<p><strong>Success — paid ' + money(selected && selected.cost ? selected.cost.total : 0) +
        ' via PayPal Sandbox.</strong> Order ' + data.orderId +
        ' · Capture ' + data.captureId + ' · status ' + data.status + '</p>' +
        '<p>Proof was saved to the Proof Vault automatically.</p>';
      await refreshVault();
      window.history.replaceState({}, '', window.location.pathname);
    }
  });
})();
