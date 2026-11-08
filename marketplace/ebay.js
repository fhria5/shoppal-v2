// eBay adapter — the first real marketplace for ShopPal v2.
//
// The Browse API is free with an eBay Developers account: create an app at
// developer.ebay.com and put its App ID + Cert ID in .env as EBAY_APP_ID
// and EBAY_CERT_ID. No keys, no calls — searchEbay returns null and the
// server tells the UI to show the demo catalog instead.
//
// Other marketplaces plug in the same way (one adapter file each, same
// normalized shape): Amazon needs Product Advertising API approval,
// AliExpress needs an affiliate app, Shopee/Tokopedia need partner access.
// eBay is first because its Browse API is open to any developer account.
const EBAY_API_BASE = (process.env.EBAY_API_BASE || 'https://api.ebay.com').replace(/\/$/, '');
const MARKETPLACE = process.env.EBAY_MARKETPLACE || 'EBAY_US';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function isConfigured() {
  return Boolean(process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID);
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt - 60000) return cachedToken;
  const basic = Buffer.from(
    process.env.EBAY_APP_ID + ':' + process.env.EBAY_CERT_ID
  ).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(EBAY_API_BASE + '/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + basic,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }).toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error('eBay token request failed (HTTP ' + res.status + ').');
    }
    const data = await res.json();
    if (!data.access_token) throw new Error('eBay token response had no access_token.');
    cachedToken = data.access_token;
    cachedTokenExpiresAt = now + (Number(data.expires_in) || 7200) * 1000;
    return cachedToken;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function normalize(item) {
  const seller = (item && item.seller) || {};
  const price = (item && item.price) || {};
  const image = (item && item.image && item.image.imageUrl) || null;
  const shipping = Array.isArray(item && item.shippingOptions) ? item.shippingOptions : [];
  const returns = (item && item.returnTerms) || {};
  return {
    marketplace: 'eBay',
    itemId: (item && item.itemId) || null,
    title: (item && item.title) || 'Untitled listing',
    priceUSD: price.value !== undefined ? Number(price.value) : null,
    currency: price.currency || 'USD',
    sellerName: seller.username || 'Unknown seller',
    sellerFeedbackPercentage: seller.feedbackPercentage !== undefined
      ? Number(seller.feedbackPercentage)
      : null,
    sellerFeedbackScore: seller.feedbackScore !== undefined
      ? Number(seller.feedbackScore)
      : null,
    image,
    itemUrl: (item && item.itemWebUrl) || null,
    condition: (item && item.condition) || null,
    returnsAccepted: returns.returnsAccepted === true,
    hasShipping: shipping.length > 0,
  };
}

// Returns normalized listings, or null when eBay is not configured.
async function searchEbay(query, { limit = 8 } = {}) {
  if (!isConfigured()) return null;
  const token = await getAccessToken();
  const url =
    EBAY_API_BASE +
    '/buy/browse/v1/item_summary/search?q=' +
    encodeURIComponent(query) +
    '&limit=' +
    Math.min(Math.max(Number(limit) || 8, 1), 20);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + token,
        'X-EBAY-C-MARKETPLACE': MARKETPLACE,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error('eBay search failed (HTTP ' + res.status + ').');
    }
    const data = await res.json();
    const items = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
    return items.map(normalize).filter((l) => l.priceUSD !== null && Number.isFinite(l.priceUSD));
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

module.exports = { isConfigured, searchEbay, normalize };
