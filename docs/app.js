// ShopPal v2 — static demo for GitHub Pages (PayPal AI Hackathon).
// Same 7-step flow as the Node.js server version, running fully in the
// browser: risk score + total cost are the same audited rule formulas as
// server.js; checkout uses the official PayPal JS SDK (Sandbox, client-side
// createOrder/capture); Proof Vault lives in this browser's localStorage.
// No secrets here — the PayPal Client ID in index.html is a public identifier.
(function () {
  'use strict';

  // --- Demo catalog (same data as data/catalog.json) ---
  var CATALOG = {
    products: [
      { id: 'p01', name: 'Aurora Wireless Headphones', priceUSD: 59.99, referencePriceUSD: 59.99, category: 'Headphones', sellerId: 'seller-safe' },
      { id: 'p02', name: 'Aurora Wireless Headphones', priceUSD: 54.99, referencePriceUSD: 59.99, category: 'Headphones', sellerId: 'seller-caution' },
      { id: 'p03', name: 'Aurora Wireless Headphones', priceUSD: 29.99, referencePriceUSD: 59.99, category: 'Headphones', sellerId: 'seller-risky' },
      { id: 'p04', name: 'Pulse Smartwatch Series 5', priceUSD: 89.00, referencePriceUSD: 89.00, category: 'Smartwatch', sellerId: 'seller-safe' },
      { id: 'p05', name: 'Pulse Smartwatch Series 5', priceUSD: 44.00, referencePriceUSD: 89.00, category: 'Smartwatch', sellerId: 'seller-risky' },
      { id: 'p06', name: 'Nova Mechanical Keyboard', priceUSD: 79.00, referencePriceUSD: 79.00, category: 'Keyboard', sellerId: 'seller-safe' },
      { id: 'p07', name: 'Nova Mechanical Keyboard', priceUSD: 69.00, referencePriceUSD: 79.00, category: 'Keyboard', sellerId: 'seller-caution' },
      { id: 'p08', name: 'Echo Bluetooth Speaker', priceUSD: 39.99, referencePriceUSD: 39.99, category: 'Speaker', sellerId: 'seller-safe' },
      { id: 'p09', name: 'Echo Bluetooth Speaker', priceUSD: 19.99, referencePriceUSD: 39.99, category: 'Speaker', sellerId: 'seller-risky' },
      { id: 'p10', name: 'Volt 65W GaN Charger', priceUSD: 24.99, referencePriceUSD: 24.99, category: 'Charger', sellerId: 'seller-caution' }
    ],
    sellers: [
      { id: 'seller-safe', name: 'TechHub Official', riskProfile: 'Safe', accountAgeYears: 4.2, profileComplete: true, totalTransactions: 12400, disputeRate: 0.4, hasTracking: true, hasReturnPolicy: true },
      { id: 'seller-caution', name: 'GadgetZone ID', riskProfile: 'Caution', accountAgeYears: 1.1, profileComplete: true, totalTransactions: 340, disputeRate: 2.8, hasTracking: true, hasReturnPolicy: false },
      { id: 'seller-risky', name: 'DealHunter88', riskProfile: 'Risky', accountAgeYears: 0.2, profileComplete: false, totalTransactions: 18, disputeRate: 6.5, hasTracking: false, hasReturnPolicy: false }
    ]
  };

  var VAULT_KEY = 'shoppal-vault-v1';
  var selected = null; // { product, seller, risk, cost }
  var lastVaultId = null;
  var paypalRenderToken = 0;

  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return '$' + Number(n).toFixed(2); };

  // --- Risk Score (identical formulas to server.js) ---
  function scoreProfile(s) {
    return Math.round(Math.min(s.accountAgeYears / 3, 1) * 60 + (s.profileComplete ? 40 : 0));
  }
  function scoreHistory(s) {
    if (s.disputeRate <= 1) return 100;
    if (s.disputeRate >= 5) return 0;
    return Math.round(100 - ((s.disputeRate - 1) / 4) * 100);
  }
  function scorePrice(p) {
    var median = p.referencePriceUSD;
    if (!median || median <= 0) return 50;
    var deviation = Math.abs(p.priceUSD / median - 1);
    if (deviation <= 0.2) return 100;
    if (deviation >= 0.5) return 0;
    return Math.round(100 - ((deviation - 0.2) / 0.3) * 100);
  }
  function scoreTracking(s) {
    if (s.hasTracking && s.hasReturnPolicy) return 100;
    if (s.hasTracking || s.hasReturnPolicy) return 50;
    return 0;
  }
  function calculateRiskScore(seller, product) {
    var components = {
      profile: scoreProfile(seller),
      history: scoreHistory(seller),
      price: scorePrice(product),
      tracking: scoreTracking(seller)
    };
    var total = Math.round(components.profile * 0.25 + components.history * 0.35 + components.price * 0.2 + components.tracking * 0.2);
    var label = total >= 80 ? 'Safe' : total >= 50 ? 'Caution' : 'Risky';
    var reasons = [];
    reasons.push(components.profile < 60 ? 'This seller account is new or its profile is incomplete.' : 'This seller has an established, complete profile.');
    reasons.push(components.history < 60 ? 'This seller has a high dispute rate compared with other sellers.' : 'This seller has a low dispute rate across many transactions.');
    if (components.price < 60) reasons.push('This price is far below the category median — a common scam pattern.');
    else if (components.tracking < 60) reasons.push('This seller does not offer tracking or a clear return policy.');
    else reasons.push('The price is fair for this category, with tracking and returns offered.');
    var recommendation = label === 'Safe'
      ? 'Safe to proceed with PayPal Goods & Services.'
      : label === 'Caution'
        ? 'Proceed with caution. Use PayPal Goods & Services — never Friends & Family.'
        : 'Risky. Consider an alternative seller before paying.';
    return { score: total, label: label, components: components, reasons: reasons.slice(0, 3), recommendation: recommendation, aiAvailable: false, aiNote: 'AI explanation unavailable in the static demo — showing rule-based reasons.' };
  }

  // --- Total Cost (identical rates to server.js) ---
  function calculateTotalCost(priceUSD, international, currencyConversion) {
    var price = Number(priceUSD);
    var paypalFee = Math.round((price * 0.0349 + 0.49) * 100) / 100;
    var internationalFee = international ? Math.round(price * 0.015 * 100) / 100 : 0;
    var conversionSpread = currencyConversion ? Math.round(price * 0.035 * 100) / 100 : 0;
    var total = Math.round((price + paypalFee + internationalFee + conversionSpread) * 100) / 100;
    return { currency: 'USD', itemPrice: price, paypalFee: paypalFee, internationalFee: internationalFee, conversionSpread: conversionSpread, total: total, estimated: true };
  }

  // --- Proof Vault (localStorage) ---
  function loadVault() {
    try { return JSON.parse(localStorage.getItem(VAULT_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveVaultEntry(entry) {
    var entries = loadVault();
    entries.unshift(entry);
    try { localStorage.setItem(VAULT_KEY, JSON.stringify(entries)); } catch (e) { /* storage unavailable */ }
  }

  function sellerOf(product) {
    return CATALOG.sellers.find(function (s) { return s.id === product.sellerId; });
  }

  function renderCatalog(products) {
    var grid = $('catalog');
    grid.innerHTML = '';
    products.forEach(function (p) {
      var seller = sellerOf(p);
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'product-card';
      card.innerHTML = '<strong>' + p.name + '</strong><br>' + money(p.priceUSD) + ' · ' + p.category + '<br>Seller: ' + seller.name + ' (' + seller.riskProfile + ')';
      card.addEventListener('click', function () { selectProduct(p); });
      grid.appendChild(card);
    });
  }

  function selectProduct(product) {
    var seller = sellerOf(product);
    selected = { product: product, seller: seller, risk: calculateRiskScore(seller, product), cost: null };
    renderRisk();
    refreshCost();
    $('approve').checked = false;
    $('checkout-status').textContent = '';
    renderPayPalButton();
    document.getElementById('step-2').scrollIntoView({ behavior: 'smooth' });
  }

  function renderRisk() {
    var r = selected.risk;
    var zone = r.label.toLowerCase();
    $('risk').innerHTML =
      '<p><strong>' + selected.seller.name + '</strong> — Risk Score <span class="score score-' + zone + '">' + r.score + '/100 · ' + r.label + '</span></p>' +
      '<ul>' + r.reasons.map(function (reason) { return '<li>' + reason + '</li>'; }).join('') + '</ul>' +
      '<p><strong>Recommendation:</strong> ' + r.recommendation + '</p>' +
      '<p class="hint">Profile ' + r.components.profile + ' · History ' + r.components.history +
      ' · Price ' + r.components.price + ' · Tracking ' + r.components.tracking + ' · ' + r.aiNote + '</p>';
  }

  function refreshCost() {
    if (!selected) return;
    selected.cost = calculateTotalCost(
      selected.product.priceUSD,
      $('opt-international').checked,
      $('opt-conversion').checked
    );
    var c = selected.cost;
    $('cost').innerHTML =
      '<table>' +
      '<tr><td>Item price</td><td>' + money(c.itemPrice) + '</td></tr>' +
      '<tr><td>PayPal Checkout fee (3.49% + $0.49)</td><td>' + money(c.paypalFee) + '</td></tr>' +
      '<tr><td>International fee (1.5%)</td><td>' + money(c.internationalFee) + '</td></tr>' +
      '<tr><td>Currency conversion spread (~3.5%, estimated)</td><td>' + money(c.conversionSpread) + '</td></tr>' +
      '<tr><td><strong>Total (estimated)</strong></td><td><strong>' + money(c.total) + '</strong></td></tr>' +
      '</table>';
    var warning = $('hold-warning');
    if (selected.risk && selected.risk.label === 'Risky') {
      warning.classList.remove('hidden');
      warning.textContent = 'Hold warning: this seller pattern is at higher risk of a payment hold. Ask the seller to upload tracking promptly and avoid unusual payment spikes.';
    } else {
      warning.classList.add('hidden');
      warning.textContent = '';
    }
    renderPayPalButton();
  }

  // --- PayPal JS SDK checkout (Sandbox, client-side) ---
  function renderPayPalButton() {
    var container = $('paypal-button-container');
    if (!selected || !window.paypal) {
      if (!window.paypal) container.innerHTML = '<p class="hint">PayPal SDK failed to load. Check your connection and reload.</p>';
      return;
    }
    var token = ++paypalRenderToken;
    container.innerHTML = '';
    var total = selected.cost ? selected.cost.total : selected.product.priceUSD;
    var fees = selected.cost ? (selected.cost.paypalFee + selected.cost.internationalFee + selected.cost.conversionSpread) : 0;
    var product = selected.product;
    var seller = selected.seller;
    var risk = selected.risk;
    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
      onClick: function (data, actions) {
        if (!$('approve').checked) {
          $('checkout-status').textContent = 'Please tick the approval checkbox in Step 4 first.';
          return actions.reject();
        }
        return actions.resolve();
      },
      createOrder: function (data, actions) {
        if (token !== paypalRenderToken) return Promise.reject(new Error('Selection changed.'));
        $('checkout-status').textContent = 'Creating PayPal order…';
        return actions.order.create({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: product.id,
            description: product.name + ' — ShopPal v2 demo (PayPal Sandbox)',
            amount: {
              currency_code: 'USD',
              value: total.toFixed(2),
              breakdown: {
                item_total: { currency_code: 'USD', value: product.priceUSD.toFixed(2) },
                handling: { currency_code: 'USD', value: fees.toFixed(2) }
              }
            },
            items: [{
              name: product.name,
              unit_amount: { currency_code: 'USD', value: product.priceUSD.toFixed(2) },
              quantity: '1',
              category: 'PHYSICAL_GOODS'
            }]
          }],
          application_context: { brand_name: 'ShopPal v2', landing_page: 'LOGIN', user_action: 'PAY_NOW' }
        });
      },
      onApprove: function (data, actions) {
        $('checkout-status').textContent = 'PayPal approved order ' + data.orderID + ' — capturing…';
        return actions.order.capture().then(function (details) {
          if (token !== paypalRenderToken) return;
          var capture = (details.purchase_units && details.purchase_units[0] && details.purchase_units[0].payments && details.purchase_units[0].payments.captures && details.purchase_units[0].payments.captures[0]) || null;
          if (!details || details.status !== 'COMPLETED' || !capture) {
            $('checkout-status').textContent = 'Capture did not complete (status: ' + (details && details.status) + '). Nothing was saved to the Proof Vault.';
            return;
          }
          var entry = {
            id: data.orderID,
            createdAt: new Date().toISOString(),
            product: { id: product.id, name: product.name, priceUSD: product.priceUSD, category: product.category },
            seller: { id: seller.id, name: seller.name, tracking: seller.hasTracking, returnPolicy: seller.hasReturnPolicy },
            riskScore: { score: risk.score, label: risk.label },
            totalCost: { total: Number(capture.amount.value), currency: capture.amount.currency_code || 'USD' },
            paypal: {
              orderId: data.orderID,
              captureId: capture.id,
              status: capture.status,
              payerEmail: (details.payer && details.payer.email_address) || null,
              createTime: capture.create_time || null,
              updateTime: capture.update_time || null
            }
          };
          saveVaultEntry(entry);
          $('checkout-status').textContent = 'Payment captured: ' + capture.id;
          $('success').innerHTML =
            '<p><strong>Success — paid ' + money(entry.totalCost.total) + ' via PayPal Sandbox.</strong> Order ' + data.orderID +
            ' · Capture ' + capture.id + ' · status ' + capture.status + '</p>' +
            '<p>Proof was saved to the Proof Vault automatically (this browser).</p>';
          refreshVault();
        });
      },
      onCancel: function () {
        $('checkout-status').textContent = 'Checkout was cancelled in PayPal. No payment was made.';
      },
      onError: function (err) {
        $('checkout-status').textContent = 'PayPal checkout error: ' + (err && err.message ? err.message : err);
      }
    }).render('#paypal-button-container');
  }

  function refreshVault() {
    var entries = loadVault();
    var vault = $('vault');
    if (!entries.length) {
      vault.innerHTML = '<p>No Proof Vault entries yet. Complete a successful checkout to save proof automatically.</p>';
      $('dispute-btn').disabled = true;
      return;
    }
    lastVaultId = entries[0].id;
    $('dispute-btn').disabled = false;
    vault.innerHTML = entries.map(function (e) {
      return '<p><strong>' + (e.product && e.product.name || e.id) + '</strong> — ' +
        (e.paypal && e.paypal.status || 'unknown') + ' · Order ' + (e.paypal && e.paypal.orderId || '—') + '</p>';
    }).join('');
  }

  function bindEvents() {
    $('ask-btn').addEventListener('click', function () {
      var q = $('ask').value.trim().toLowerCase();
      if (!q) return;
      var matches = CATALOG.products.filter(function (p) {
        return q.includes(p.category.toLowerCase()) || q.includes(p.name.toLowerCase().split(' ')[0]);
      });
      renderCatalog(matches.length ? matches : CATALOG.products);
      if (!matches.length) {
        $('catalog').insertAdjacentHTML('beforeend', '<p class="hint">No exact match in the demo catalog — showing all 10 demo products.</p>');
      }
    });
    $('opt-international').addEventListener('change', refreshCost);
    $('opt-conversion').addEventListener('change', refreshCost);
    $('approve').addEventListener('change', function (e) {
      if (e.target.checked && selected) renderPayPalButton();
    });
    $('vault-refresh').addEventListener('click', refreshVault);
    $('dispute-btn').addEventListener('click', function () {
      if (!lastVaultId) return;
      var entry = loadVault().find(function (e) { return e.id === lastVaultId; });
      var box = $('dispute-draft');
      box.classList.remove('hidden');
      if (!entry) { box.textContent = 'Proof Vault entry not found. Save a successful checkout first.'; return; }
      var missing = [];
      if (!entry.paypal || !entry.paypal.captureId) missing.push('capture ID');
      if (!entry.seller || !entry.seller.tracking) missing.push('tracking proof');
      var readiness = missing.length === 0 ? 100 : 70;
      box.innerHTML =
        '<p><strong>Simulated dispute draft</strong> — readiness ' + readiness + '/100</p>' +
        '<p>Dispute response draft (simulated, factual only): Order ' + (entry.paypal && entry.paypal.orderId || 'unknown') + ' for ' +
        (entry.product && entry.product.name || 'the product') + ' ($' + (entry.totalCost && entry.totalCost.total != null ? entry.totalCost.total : entry.product && entry.product.priceUSD || 'unknown') + ') ' +
        'was paid via PayPal Sandbox and captured as ' + (entry.paypal && entry.paypal.status || 'unknown') + '. ' +
        'Seller: ' + (entry.seller && entry.seller.name || 'unknown') +
        ' (risk score ' + (entry.riskScore && entry.riskScore.score != null ? entry.riskScore.score : 'unknown') + ' at checkout). ' +
        'Proof is attached in the Proof Vault entry ' + entry.id + '.</p>' +
        (missing.length ? '<p>Still missing: ' + missing.join(', ') + '</p>' : '<p>No proof missing.</p>');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindEvents();
    renderCatalog(CATALOG.products);
    refreshVault();
    if (!window.paypal) {
      $('checkout-status').textContent = 'PayPal SDK did not load yet — it loads from paypal.com; check your connection and reload the page.';
    }
  });
})();
