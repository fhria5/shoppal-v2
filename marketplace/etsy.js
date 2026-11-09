// Etsy adapter — the second real marketplace for ShopPal v2.
//
// The Open API v3 listing search is free with an Etsy Developers app:
// create an app at etsy.com/developers/register and put its keystring +
// shared secret in .env as ETSY_API_KEY, in the form
// "keystring:shared_secret" (the colon-joined pair the x-api-key header
// expects). No key, no calls — searchEtsy returns null and the server
// tells the UI to show the demo catalog instead.
//
// Only the public listing search is used (findAllListingsActive), which
// needs just the API key — no OAuth user token. There is no cart or
// checkout endpoint on Etsy's API, so buying an Etsy listing works the
// same way as eBay here: the PayPal order is a SANDBOX SIMULATION of
// paying that listing's total, it does not buy the item on Etsy. The
// buyer is told this in the UI.
//
// Same normalized shape as marketplace/ebay.js, so the risk scorer,
// the marketplace search route and the PayPal checkout mapping all work
// unchanged. Two Etsy specifics: prices come as { amount, divisor,
// currency_code } (priceUSD = amount / divisor), and the search is
// global, so only USD listings are kept — totals and risk scores stay
// comparable. Seller feedback % is not in the listing search response,
// so it stays null (the scorer treats it as unknown, 50/100).
const ETSY_API_BASE = (process.env.ETSY_API_BASE || 'https://api.etsy.com').replace(/\/$/, '');

function isConfigured() {
  return Boolean(process.env.ETSY_API_KEY);
}

function normalize(item) {
  const price = (item && item.price) || {};
  const amount = Number(price.amount);
  const divisor = Number(price.divisor) || 100;
  const currency = price.currency_code || 'USD';
  const images = Array.isArray(item && item.images) ? item.images : [];
  const firstImage = images[0] || {};
  const image = firstImage.url_570xN || firstImage.url_fullxfull || null;
  const shopId = item && item.shop_id !== undefined ? item.shop_id : null;
  const shop = (item && item.shop) || {};
  return {
    marketplace: 'Etsy',
    itemId: (item && item.listing_id !== undefined) ? String(item.listing_id) : null,
    title: (item && item.title) || 'Untitled listing',
    priceUSD: Number.isFinite(amount) ? Math.round((amount / divisor) * 100) / 100 : null,
    currency,
    sellerName: shop.shop_name || (shopId !== null ? 'Shop ' + shopId : 'Unknown seller'),
    sellerFeedbackPercentage: null,
    sellerFeedbackScore: null,
    image,
    itemUrl: (item && item.url) || null,
    condition: null,
    returnsAccepted: false,
    hasShipping: !item || item.type !== 'download',
  };
}

// Returns normalized listings, or null when Etsy is not configured.
async function searchEtsy(query, { limit = 8 } = {}) {
  if (!isConfigured()) return null;
  const url =
    ETSY_API_BASE +
    '/v3/application/listings/active?keywords=' +
    encodeURIComponent(query) +
    '&limit=' +
    Math.min(Math.max(Number(limit) || 8, 1), 20) +
    '&sort_on=score';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: {
        'x-api-key': process.env.ETSY_API_KEY,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('Etsy search rate-limited (HTTP 429). Try again in a moment.');
      }
      throw new Error('Etsy search failed (HTTP ' + res.status + ').');
    }
    const data = await res.json();
    const items = Array.isArray(data.results) ? data.results : [];
    return items
      .map(normalize)
      .filter((l) => l.priceUSD !== null && Number.isFinite(l.priceUSD) && l.currency === 'USD');
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

module.exports = { isConfigured, searchEtsy, normalize };
