# ShopPal v2 — Shop safer, see the real cost, keep your proof

> **PayPal AI Hackathon — Best Use of Agentic Commerce**
> Deadline: Friday, 13 November 2026, 04:00 WITA (12 November 2026, 12:00 PT)
> Internal target: submit Thursday, 12 November 2026, 22:00 WITA.

ShopPal v2 is an AI shopping agent built on the PayPal Developer Platform. The demo is a messaging-style chat: you talk to ShopPal, it checks the seller, shows the real total, and keeps your proof. Product photos are AI-generated illustrations of generic demo products, and the header carries a shield-check logo.
Most shopping agents only buy things. ShopPal v2 protects you while it buys:

1. **AI Seller Risk Score (0–100)** — before you pay, every seller is scored
   with auditable, rule-based weights and explained in plain language.
   Safe 80–100 · Caution 50–79 · Risky 0–49.
2. **AI Total Cost** — before checkout starts, you see the full estimated
   cost: item price, PayPal Checkout fee, international fee, and currency
   conversion spread. No surprise total after checkout starts.
3. **AI Proof Vault** — after a successful PayPal capture, a snapshot of the
   product, seller score, cost breakdown, and PayPal order / capture IDs is
   saved automatically. If a dispute is simulated, AI drafts a factual
   response using only the saved proof.

**The agent never pays without your explicit approval.** The agent shows the
risk score and the total cost first, then stops and waits for you to approve.
That is responsible Agentic Commerce, and it is a deliberate design choice.

> **Sandbox only. No real money.** Every payment in this project uses the
> PayPal Sandbox with sandbox buyer / seller test accounts. No live PayPal
> account, no real funds, and no real credentials are used or committed.

## Demo flow (7 steps)

1. Ask for a product (for example, "headphones under $60 for a gift") or pick one from the demo catalog.
2. See the Risk Score for each seller option. A risky option is shown in red with reasons — never hidden.
3. Pick a product and see the full Total Cost breakdown, plus a Hold Predictor warning when relevant.
4. Check out with PayPal Sandbox: the server creates an order via Orders API v2, you approve as a sandbox buyer, then the server captures it.
5. See the success screen: order ID, `COMPLETED` status, and the exact same total as in step 3.
6. Open the Proof Vault: the transaction snapshot is saved automatically.
7. Simulate a dispute: AI drafts a response from the Proof Vault evidence, with a proof-readiness score and a list of anything still missing.

## How to run locally

```bash
# 1. Install dependencies (Node.js >= 20)
npm install

# 2. Copy the environment template and fill in your own sandbox values
cp .env.example .env

# 3. Start the server
npm start
# or, for development with auto-reload (requires nodemon, optional):
# npm run dev

# 4. Open http://localhost:3000
# 5. Check health: curl http://localhost:3000/api/health
```

## Required environment variables

See `.env.example`. Never commit a real `.env` file.

| Variable | Description |
|---|---|
| `PAYPAL_CLIENT_ID` | Client ID of your PayPal Sandbox app (public identifier, safe for the JS SDK). |
| `PAYPAL_CLIENT_SECRET` | Secret of your PayPal Sandbox app. Server only. Never log it, never commit it. |
| `PAYPAL_MODE` | `sandbox` (always, for this hackathon). |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` |
| `VYCE_API_KEY` | Vyce API key for AI explanations. Server only — never log it, never commit it, never put it in the static demo. Optional: the rule-based Risk Score and Total Cost work without it. |
| `VYCE_API_BASE` | Vyce API base URL (default `https://vyceai.com/v1`). |
| `VYCE_MODEL` | Vyce model for explanations (default `deepseek-v4.1`). |
| `EBAY_APP_ID` | eBay Developers App ID for real marketplace search. Free at developer.ebay.com. Optional: without it, marketplace search answers "not configured" and the demo uses the catalog. |
| `EBAY_CERT_ID` | eBay Developers Cert ID (the App ID's secret). Server only — never log it, never commit it. |
| `EBAY_API_BASE` | eBay API base URL (default `https://api.ebay.com`). |
| `EBAY_MARKETPLACE` | eBay marketplace site (default `EBAY_US`). |
| `PORT` | Port for the local server (default `3000`). |

## Real marketplace search (eBay)

The demo catalog is 10 fake products — good for the judged static demo, but
a shopping agent should search real marketplaces. ShopPal does that through
one adapter file per marketplace (`marketplace/<name>.js`), all
returning the same normalized listing shape. eBay is first because its
Browse API is open to any free developer account:

1. Create a free account at [developer.ebay.com](https://developer.ebay.com/) and make an app (Sandbox or Production — Sandbox is enough to test).
2. Copy the app's **App ID** and **Cert ID** into your local `.env` as `EBAY_APP_ID` and `EBAY_CERT_ID`.
3. Restart the server and ask ShopPal anything — real eBay listings appear below the demo catalog, each with a real photo, the seller's feedback %, a ShopPal risk score built from marketplace signals (feedback, price vs this search's median, returns and shipping), and a link to the listing.
4. Picking a real listing runs the same 7 steps. Checkout is a **PayPal Sandbox simulation**: it creates a sandbox order for the listing total and saves the proof — it does **not** buy the eBay item, and the UI says so.

Other marketplaces need their own keys and adapters, one at a time: Amazon
(Product Advertising API, needs affiliate approval), AliExpress (affiliate
app), Shopee / Tokopedia (partner access). There is no single key that
unlocks every marketplace, and scraping them is against their terms — so
ShopPal only searches marketplaces through their official APIs.

## Create your own PayPal Sandbox buyer / seller accounts

No credentials are included in this repo. Create your own test accounts:

1. Go to [developer.paypal.com](https://developer.paypal.com/) and sign in with your PayPal developer account (create a free one if needed).
2. Open **Apps & Credentials → Sandbox** and create a Sandbox app (or use the default app). Copy its **Client ID** and **Secret** into your local `.env` only.
3. Open **Sandbox → Accounts** and create two sandbox test accounts if they do not exist yet:
   - One **Business (Merchant)** account — the demo seller.
   - One **Personal (Buyer)** account — the demo buyer.
   PayPal generates test email addresses and passwords for these accounts. Use only those sandbox test credentials to approve a payment in the demo.
4. Never use a real PayPal account, real email, or real password in this project, and never paste sandbox secrets into the repo, chat logs, or screenshots.

## Architecture

```
ShopPal v2 (single repo, single deploy to Render / Vercel)
├── public/            Static frontend (index.html, app.js, styles.css)
│                      7-step flow. PayPal JS SDK client-id is loaded
│                      from /api/config at runtime — never hardcoded.
├── server.js          Express server. Serves the frontend, the catalog,
│                      Risk Score, Total Cost, PayPal Orders / Capture,
│                      and the Proof Vault. One server function handles
│                      AI explanations (Vyce API, DeepSeek, with a
│                      rule-based fallback when the key is absent).
├── data/catalog.json  Demo catalog: 10 products, 3 sellers with
│                      distinct risk profiles (Safe / Caution / Risky).
└── data/vault/        Proof Vault entries (JSON files, git-ignored).
                       A .gitkeep keeps the directory in the repo.
```

### How the AI works

Scores are calculated by transparent, auditable rules — the model never
invents the number. AI has three bounded jobs only:

1. **Explain the score** — turn the score components into 3 short reasons and 1 recommendation. It must not change the score.
2. **Summarize the cost** — explain in 2 sentences why the final total differs from the item price.
3. **Draft a dispute response** — write a polite, factual reply using only the Proof Vault contents, without adding new facts.

If the AI is unavailable, the rule-based score and cost breakdown are still
shown, labelled "AI explanation unavailable".

The other modules are rule-based and labelled as estimates, not AI
judgements: the **Hold Predictor** scores hold risk from dispute rate,
account age, transaction count, price deviation and tracking; the
**Subscription Watcher** flags a product bought twice or more from the
Proof Vault; the **trouble-costs strip** lists public PayPal figures the
cost table doesn't show (chargeback $20, dispute $15/$30, refund keeps
the fee, instant transfer 1.5%, micropayments 4.99% + $0.09 under $12)
plus Buyer Protection coverage.

### Risk Score formula (0–100, higher = safer)

| Component | Weight | Rule (summary) |
|---|---|---|
| Profile age & completeness | 25 | Account over 2 years + complete profile scores full. New, incomplete accounts score low. |
| Transaction & dispute history | 35 | Dispute rate under 1% scores full. Over 5% scores near zero. |
| Price fairness vs. median | 20 | Price within 20% of the category median scores full. 50% below the median scores near zero (a common scam pattern). |
| Tracking & return policy | 20 | Tracking + written returns scores full. Neither scores low. |

Zones: **80–100 Safe** (proceed) · **50–79 Caution** (check reasons, use Goods & Services) · **0–49 Risky** (consider an alternative seller).

### Total Cost formula (open, estimated)

For a cross-border purchase, using the public rates from the project research:

| Component | Formula | Example, $50 item |
|---|---|---|
| Item price | — | $50.00 |
| PayPal Checkout fee | 3.49% + $0.49 | $2.24 |
| International fee | 1.50% | $0.75 |
| Currency conversion spread | ~3.5% (shown as an estimate) | $1.75 |
| **Total** | **price + all fees** | **~$54.74–$54.99** |

Every line in the UI is labelled "estimated". These are public fee figures
used for transparency in the demo, not a quote from PayPal for every account
type. What matters is that no fee appears after checkout starts.

## API (Day 0 skeleton)

| Method & path | Description |
|---|---|
| `GET /api/health` | Health check. |
| `GET /api/config` | Returns the PayPal client ID (public) and mode. Never returns secrets. |
| `GET /api/catalog` | Demo catalog (sellers + products). |
| `POST /api/risk-score` | `{ sellerId, productId }` → score, label, components, 3 reasons, recommendation, comparison, scam-pattern warning, before-you-pay checklist. |
| `POST /api/hold-risk` | `{ sellerId, productId }` → hold-risk score, label (Low/Moderate/High), estimated chance, reasons, tip. |
| `GET /api/ask?q=` | Plain-language search (English or Indonesian: category, budget or range, cheapest/best/safest, seller, returns/tracking) → products sorted by the ranking asked for. Follow-ups ("yang termurah", "yang pertama") refer to the last results via `&context=`. With `VYCE_API_KEY` set, the intent is parsed by AI (Vyce/DeepSeek) with the regex parser as fallback; `aiParsed` says which one ran. |
| `GET /api/subscriptions` | Recurring purchases found in the Proof Vault (same product bought 2+ times). |
| `POST /api/total-cost` | `{ priceUSD, international, currencyConversion }` → fee breakdown, total, and trouble-costs (chargeback/dispute/refund/instant transfer/micropayments) + Buyer Protection note. |
| `POST /api/paypal/create-order` | Orders API v2 create (Sandbox). Rejects a total that doesn't match the approved total. |
| `POST /api/paypal/capture-order` | Orders API v2 capture, verified via Orders + Payments API. Only COMPLETED saves a Proof Vault entry. Re-capturing an already-captured order recovers the existing capture (`alreadyCaptured: true`) instead of erroring. |
| `POST /api/paypal/refund` | Payments API v2 refund of a capture (full by default; optional partial `amount` + `reason` → `note_to_payer`). Accepts `vaultId` or a direct `captureId`. The vault entry is updated with the refund record. |
| `GET /api/paypal/order?orderId=` | Live order status: Orders API + Payments API capture re-verification (status, payer, capture, amount, whether the order is in the Proof Vault). |
| `POST /api/dispute/simulate` | Dispute Win Simulator: win-chance estimate (0–100) for a PayPal dispute, from a Proof Vault entry (`vaultId`) or a product (`sellerId` + `productId`, pre-purchase). Transparent rule-based components + missing-proof list + recommendation; Vyce rewrites the explanation only (never the number). |
| `GET /api/evidence?vaultId=` | Evidence Pack: a standalone printable HTML proof page (order, verified capture, risk score, timeline, refund) returned as JSON `{ html }` — the client opens it via a blob URL and prints to PDF. |
| `POST /api/check-link` | Paste any product URL: reads the page's public metadata (title, price, image — like a chat link preview), scores the domain + price vs the demo catalog median, returns a verdict + honest total. Blocks private/localhost hosts. |
| `GET /api/deadlines` | Deadline Tracker: 180-day dispute-filing + 20-day escalation + 30-day return deadlines, from a vault entry (`vaultId`) or a product (`sellerId` + `productId`, purchase assumed today). |
| `POST /api/import-cost` | Import Cost: duty + VAT/GST for a cross-border purchase, per destination country (ID / US / EU / UK / SG). Indonesia rates verified against PMK 96/2023 + PMK 4/2025 (de minimis FOB US$3; US$3–1,500: duty 7.5% + VAT 11% effective, PPh waived for parcels). Always labelled an estimate — exact duty depends on the product HS code. |
| `POST /api/phishing-check` | PayPal Phishing Check: paste a message claiming to be from PayPal, get a verdict (0–100) from rule-based signals (lookalike-domain detection with character-swap normalisation, urgency language, requests for passwords/OTP/card numbers, generic greetings, link/text mismatch) + an AI review from Vyce (45s timeout — Vyce is slow, ~30s per call). |
| `GET /api/vault` | List saved Proof Vault entries. |
| `POST /api/dispute/draft` | Simulated dispute draft from a Proof Vault entry (labelled as a simulation). |

Two features are client-side (no server endpoint — they reuse the vault and the existing risk/cost/hold endpoints): **Compare 2 Products** (side-by-side risk + honest total + hold table) and **Monthly Budget** (a budget limit stored in the browser; the Proof Vault shows this month's spend vs the limit and the checkout warns when a purchase would exceed it).

PayPal integration (Day 1+): OAuth 2.0 Sandbox (`POST /v1/oauth2/token`),
Orders API v2 create / capture, Payments API v2 capture verification, and
Webhooks (`CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`,
`CUSTOMER.DISPUTE.CREATED`). The Disputes API is a stretch goal; if sandbox
dispute data is empty, the demo uses one clearly labelled simulated dispute.

## License

MIT License — see `LICENSE`. Copyright 2026 Fahriannor.
