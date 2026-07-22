// supabase/functions/stripe-webhook/index.ts  — v2 (v6.21+)
// Receives Stripe events. On completed checkout: records the purchase,
// issues a signed one-of-one PASS (QR), and sends the matching branded
// email via Resend. Also handles renewals, failed payments, cancellations.
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
//          SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, PASS_SIGNING_SECRET,
//          PUBLIC_SITE (e.g. https://thenorthcreek.com),
//          VERIFY_BASE (e.g. https://<ref>.functions.supabase.co/verify)
// Then register the function URL as a Stripe webhook endpoint for:
//   checkout.session.completed, invoice.payment_succeeded,
//   invoice.payment_failed, customer.subscription.deleted,
//   customer.subscription.updated

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,   // service role → bypasses RLS
);

const RESEND_KEY     = Deno.env.get("RESEND_API_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SIGN_SECRET    = Deno.env.get("PASS_SIGNING_SECRET")!;
const SITE           = Deno.env.get("PUBLIC_SITE")  ?? "https://thenorthcreek.com";
const VERIFY_BASE    = Deno.env.get("VERIFY_BASE")  ?? `${SITE}/verify`;
const FROM           = "The North Creek Estate <events@thenorthcreek.com>";

// ---- product catalog: label, kind, single-use, which email --------------
type Kind = "membership" | "pass" | "ticket";
const CATALOG: Record<string, { label: string; kind: Kind; single: boolean; email: string; event?: string }> = {
  "founding-annual":       { label: "Founding Membership", kind: "membership", single: false, email: "founding" },
  "founding-monthly":      { label: "Founding Membership", kind: "membership", single: false, email: "founding" },
  "estate-pass":           { label: "Estate Pass",         kind: "membership", single: false, email: "estate-pass" },
  "creek-pass":            { label: "Creek Pass",          kind: "pass",       single: false, email: "creek-pass" },
  "range-bucket":          { label: "Practice Range",      kind: "pass",       single: false, email: "range" },
  "ticket-gathering":      { label: "Signature Gathering", kind: "ticket",     single: true,  email: "ticket", event: "Signature Gathering" },
  "ticket-tunnel-vision":  { label: "Tunnel Vision",       kind: "ticket",     single: true,  email: "ticket", event: "Tunnel Vision" },
  "ticket-drone":          { label: "Drone Exhibition",    kind: "ticket",     single: true,  email: "ticket", event: "Drone Exhibition" },
};

// ---- signing + pass ids -------------------------------------------------
async function sign(passId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SIGN_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(passId));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
function newPassId(): string {
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford-ish, no ambiguous chars
  const b = crypto.getRandomValues(new Uint8Array(8));
  const c = [...b].map((x) => A[x % 32]).join("");
  return `NC-${c.slice(0, 4)}-${c.slice(4, 8)}`;
}
async function passUrl(passId: string): Promise<string> {
  return `${VERIFY_BASE}?p=${encodeURIComponent(passId)}&s=${await sign(passId)}`;
}
async function qrImg(passId: string): Promise<string> {
  return `${VERIFY_BASE}?p=${encodeURIComponent(passId)}&s=${await sign(passId)}&img=1`;
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (err) {
    console.error("Signature verification failed:", err);
    return new Response("Bad signature", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") await onCheckout(event.data.object as Stripe.Checkout.Session);
    else if (event.type === "invoice.payment_succeeded") await onInvoicePaid(event.data.object as Stripe.Invoice);
    else if (event.type === "invoice.payment_failed")    await onInvoiceFailed(event.data.object as Stripe.Invoice);
    else if (event.type === "customer.subscription.deleted") await onCanceled(event.data.object as Stripe.Subscription);
    else if (event.type === "customer.subscription.updated") await onSubUpdated(event.data.object as Stripe.Subscription);
  } catch (err) {
    console.error("Handler error:", err);
    return new Response("handler error", { status: 500 });
  }
  return new Response("ok", { status: 200 });
});

// ---- new purchase -------------------------------------------------------
async function onCheckout(s: Stripe.Checkout.Session) {
  const userId  = s.client_reference_id ?? null;
  const email   = s.customer_details?.email ?? "";
  const name    = s.customer_details?.name ?? "";
  const product = (s.metadata?.product as string) ?? "unknown";
  const cat = CATALOG[product];
  if (!cat) { console.warn("Unknown product:", product); return; }

  // period end for subscriptions
  let periodEnd: string | null = null;
  if (s.mode === "subscription" && s.subscription) {
    const sub = await stripe.subscriptions.retrieve(s.subscription as string);
    periodEnd = new Date(sub.current_period_end * 1000).toISOString();
  }

  // record the membership row (for recurring products) — one per (user, product)
  if (cat.kind === "membership" || product === "creek-pass") {
    await supabase.from("memberships").upsert({
      user_id: userId, email, product, status: "active",
      stripe_customer_id: (s.customer as string) ?? null,
      stripe_subscription_id: (s.subscription as string) ?? null,
      current_period_end: periodEnd, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,product" });
  }

  // ISSUE THE PASS (every purchase gets a verifiable QR)
  const passId = newPassId();
  await supabase.from("passes").insert({
    pass_id: passId, user_id: userId, email, holder_name: name,
    product, kind: cat.kind, single_use: cat.single, status: "active",
    event_name: cat.event ?? null, quantity: (s.metadata?.qty ? Number(s.metadata.qty) : 1),
    stripe_session_id: s.id, expires_at: periodEnd,
  });

  const url = await passUrl(passId);
  const img = await qrImg(passId);
  await send(email, name, cat, { passId, url, img, periodEnd, product });
}

// ---- API-version tolerance ---------------------------------------------
// Older API versions expose invoice.subscription; 2025+ ("basil"/"clover")
// moved it to invoice.parent.subscription_details.subscription. Same idea for
// subscription.current_period_end, which moved onto subscription items.
function invSubId(inv: Stripe.Invoice): string | undefined {
  const raw = (inv as any).parent?.subscription_details?.subscription ?? (inv as any).subscription;
  return typeof raw === "string" ? raw : raw?.id;
}
function subPeriodEnd(sub: Stripe.Subscription): number | undefined {
  return (sub as any).current_period_end ?? (sub as any).items?.data?.[0]?.current_period_end;
}

// ---- renewal (subscription_cycle only — not the first invoice) ----------
async function onInvoicePaid(inv: Stripe.Invoice) {
  if (inv.billing_reason !== "subscription_cycle") return; // signup handled by checkout
  const subId = invSubId(inv) as string;
  const email = inv.customer_email ?? "";
  const { data } = await supabase.from("memberships").select("product,current_period_end")
    .eq("stripe_subscription_id", subId).maybeSingle();
  const product = data?.product ?? "membership";
  const cat = CATALOG[product];
  const sub = await stripe.subscriptions.retrieve(subId);
  const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
  await supabase.from("memberships").update({ status: "active", current_period_end: periodEnd, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subId);
  await sendRenewal(email, cat?.label ?? "membership", periodEnd);
}

async function onInvoiceFailed(inv: Stripe.Invoice) {
  const subId = invSubId(inv) as string;
  const email = inv.customer_email ?? "";
  await supabase.from("memberships").update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subId);
  const { data } = await supabase.from("memberships").select("product").eq("stripe_subscription_id", subId).maybeSingle();
  await sendPaymentFailed(email, CATALOG[data?.product ?? ""]?.label ?? "membership");
}

async function onCanceled(sub: Stripe.Subscription) {
  await supabase.from("memberships").update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", sub.id);
  await supabase.from("passes").update({ status: "canceled" }).eq("stripe_session_id", sub.id);
  const { data } = await supabase.from("memberships").select("email,product").eq("stripe_subscription_id", sub.id).maybeSingle();
  if (data?.email) await sendCanceled(data.email, CATALOG[data.product ?? ""]?.label ?? "membership");
}

async function onSubUpdated(sub: Stripe.Subscription) {
  let cpe = subPeriodEnd(sub);
  if (!cpe) {  // last resort: re-fetch on our pinned API version, which has it top-level
    try { cpe = (await stripe.subscriptions.retrieve(sub.id)).current_period_end; } catch (_) { /* keep undefined */ }
  }
  const patch: Record<string, unknown> = { status: sub.status, updated_at: new Date().toISOString() };
  if (cpe) patch.current_period_end = new Date(cpe * 1000).toISOString();
  await supabase.from("memberships").update(patch).eq("stripe_subscription_id", sub.id);
}

// ========================================================================
// EMAIL — one branded shell, per-product body. Copy approved in the deck.
// ========================================================================
const C = { green: "#1F5A36", deep: "#004400", ivory: "#F5F0E6", gold: "#C5A258", ink: "#111", muted: "#5a5a52", line: "#e3ddce" };

function shell(title: string, inner: string, preheader: string) {
  return `<!doctype html><html><body style="margin:0;background:${C.ivory};">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.ivory};padding:32px 16px">
   <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid ${C.line}">
      <tr><td style="background:${C.deep};padding:22px 32px">
        <div style="letter-spacing:.28em;text-transform:uppercase;font-size:11px;color:${C.gold};font-family:Arial,sans-serif">The North Creek Estate</div>
      </td></tr>
      <tr><td style="padding:34px 32px 12px">
        <h1 style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:26px;color:${C.deep};line-height:1.2">${title}</h1>
      </td></tr>
      <tr><td style="padding:0 32px 30px;font-family:Georgia,serif;color:${C.ink};font-size:16px;line-height:1.62">${inner}</td></tr>
      <tr><td style="border-top:1px solid ${C.line};padding:18px 32px;font-family:Arial,sans-serif;font-size:12px;color:${C.muted}">
        The North Creek Estate &middot; 8770 North Creek Blvd, Southaven, MS &middot; (662) 404-1772<br>
        <a href="${SITE}" style="color:${C.green}">thenorthcreek.com</a>
      </td></tr>
    </table>
   </td></tr>
  </table></body></html>`;
}
function passBlock(url: string, img: string, caption: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0">
   <tr><td align="center" style="border:1px solid ${C.line};background:${C.ivory};padding:20px">
     <a href="${url}"><img src="${img}" width="200" height="200" alt="Your North Creek pass" style="display:block;border:0"></a>
     <div style="font-family:Arial,sans-serif;font-size:12px;color:${C.muted};margin-top:12px;max-width:320px">${caption}</div>
   </td></tr></table>`;
}
function btn(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="border:1px solid ${C.green}">
    <a href="${href}" style="display:inline-block;padding:11px 22px;font-family:Arial,sans-serif;font-size:14px;color:${C.green};text-decoration:none;letter-spacing:.02em">${label} &rarr;</a>
  </td></tr></table>`;
}
function esc(x: string) { return (x || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!)); }
function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

async function post(to: string, subject: string, html: string) {
  if (!to) return;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!r.ok) console.error("Resend error:", await r.text());
}

// ---- purchase routing ---------------------------------------------------
async function send(email: string, name: string, cat: { label: string; email: string; event?: string },
                    p: { passId: string; url: string; img: string; periodEnd: string | null; product: string }) {
  const first = esc((name || "").split(" ")[0] || "there");
  const pass = passBlock(p.url, p.img,
    "Show this at the gate, the range, and Signature Gatherings. Scanning it verifies your pass against our records — it is one of one.");

  if (cat.email === "founding") {
    const rate = p.product === "founding-monthly" ? "$250/month" : "$3,000/year";
    const inner = `
      <p>Welcome, ${first}. You are a Founding Member of The North Creek. Your rate &mdash; ${rate} &mdash; is locked for life. It does not move.</p>
      <p><b>What comes with it:</b></p>
      <ul style="padding-left:18px;margin:0 0 8px">
        <li>Two guest passes at each Quarterly Signature Gathering &mdash; eight a year</li>
        <li>An Estate Pass &mdash; includes four Practice Range buckets a month and your weekly Creek Pass for fishing</li>
        <li>Preferred pricing on every Space, event, and Mercantile order</li>
        <li>Access to The Parlour, your members&rsquo; lounge</li>
        <li>Founding recognition, held for as long as you&rsquo;re with us</li>
      </ul>
      <p>This is your Founding Circle pass. Keep it close.</p>
      ${pass}${btn(SITE + "/account.html", "Open your account")}`;
    return post(email, "Your place is set — welcome to the Founding Circle", shell("Welcome to the Founding Circle.", inner, "Your pass is inside. Your rate is locked for life."));
  }

  if (cat.email === "estate-pass") {
    const inner = `
      <p>Welcome, ${first}. Your Estate Pass is active &mdash; you are welcome to return.</p>
      <p><b>Included:</b> four Practice Range buckets a month, and your weekly Creek Pass for fishing, during normal business hours.</p>
      <p>Enjoy preferred rates on venue rental in any of our distinct Spaces, and on select items in the Mercantile.</p>
      <p>Here is your pass. It is required to access your estate privileges.</p>
      ${pass}${btn(SITE + "/account.html", "Open your account")}`;
    return post(email, "Your Estate Pass is active", shell("Your invitation to return.", inner, "Estate Pass active — come out and play."));
  }

  if (cat.email === "creek-pass") {
    const inner = `
      <p>Welcome, ${first}. Your Creek Pass is active. You have access to find your peace on the water.</p>
      <p>Recreational fishing throughout the estate&rsquo;s designated waterways, during estate hours. Show this pass at the water&rsquo;s edge.</p>
      ${pass}${btn(SITE + "/creek-pass.html", "About the Creek Pass")}`;
    return post(email, "Your Creek Pass is active — the water's waiting", shell("Find your peace on the water.", inner, "Creek Pass active — your pass is inside."));
  }

  if (cat.email === "range") {
    const inner = `
      <p>You&rsquo;re set, ${first}. Your Practice Range bucket is ready &mdash; ten open-air bays under an open sky.</p>
      <p>Bring this pass to the range.</p>
      <p>Wednesdays and Thursdays, <b>Run It Back</b>: buy one bucket, the second one is on us.</p>
      ${pass}${btn(SITE + "/range.html", "Range details & hours")}`;
    return post(email, "Your range bucket is ready", shell("Ten bays. Open sky.", inner, "Your range pass is inside."));
  }

  // ticket
  const ev = esc(cat.event ?? "the gathering");
  const inner = `
    <p>You&rsquo;re on the list, ${first}. Your ticket to <b>${ev}</b> is confirmed.</p>
    <p>This QR code is your admission. Present it at the gate &mdash; it&rsquo;s scanned once, and it&rsquo;s one of one. Please don&rsquo;t share it; a screenshot used twice won&rsquo;t pass.</p>
    ${passBlock(p.url, p.img, `Admission to ${ev}. Scanned at the gate; valid for one entry.`)}
    ${btn(SITE + "/gatherings.html", "See the full calendar")}`;
  return post(email, `You're on the list — ${cat.event}`, shell(`${ev}.`, inner, `Your ticket to ${ev} is inside.`));
}

async function sendRenewal(email: string, label: string, periodEnd: string) {
  const inner = `
    <p>Your ${esc(label)} renewed today &mdash; no action is required.</p>
    <p>You&rsquo;re active through <b>${fmtDate(periodEnd)}</b>. Your pass in your account stays current automatically.</p>
    ${btn(SITE + "/account.html", "Open your account")}`;
  return post(email, `Your ${label} renewed — nothing to do`, shell("Renewed. Carry on.", inner, `Active through ${fmtDate(periodEnd)}.`));
}
async function sendPaymentFailed(email: string, label: string) {
  const inner = `
    <p>We couldn&rsquo;t process the latest payment for your ${esc(label)}. It happens &mdash; usually an expired card.</p>
    <p>Update your payment method and everything picks right back up, uninterrupted. We&rsquo;ll try again automatically in the meantime.</p>
    ${btn(SITE + "/account.html", "Update payment")}`;
  return post(email, "A small hiccup with your payment", shell("Let&rsquo;s keep you in.", inner, "Update your card to stay active."));
}
async function sendCanceled(email: string, label: string) {
  const inner = `
    <p>Your ${esc(label)} has ended, and your access is now closed.</p>
    <p>Please reach out if you suspect there was an error in our accounting.</p>
    <p>You are welcome to return &mdash; the land has more stories to tell.</p>
    ${btn(SITE + "/membership.html", "Return when you&rsquo;re ready")}`;
  return post(email, "Your membership has ended", shell("Until next time.", inner, "Thank you for being a member of the North Creek."));
}
