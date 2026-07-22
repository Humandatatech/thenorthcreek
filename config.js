/* THE NORTH CREEK ESTATE — front-end config  (PRODUCTION — thenorthcreek.com)
 * Public values only. Never put Stripe secret keys or the Supabase service-role key here.
 *
 * STATUS: LIVE — all 7 payment links below are live-mode (buy.stripe.com, no test_),
 * verified against Stripe on 2026-07-21 (account acct_1TBnsxDgZdINFZy5).
 * Each link redirects to /account.html after purchase.
 * Still pending: customerPortalUrl (dashboard > Settings > Billing > Customer portal).
 */
window.NC_CONFIG = {
  supabase: {
    url:     "https://essciypxrnfzqzsfyole.supabase.co",
    anonKey: "sb_publishable_VMPDSJ0aTjzR30QJu1F7xA_nQPY3jTb"   // publishable anon key — safe in the browser
  },
  stripe: {
    // Billing > Customer portal link, used by "Manage membership".
    // Paste the LIVE customer portal link (https://billing.stripe.com/p/login/…).
    customerPortalUrl: ""
  },

  /* GO-LIVE SWITCH for checkout.
   * false = pay buttons do NOT reach Stripe; clicking shows a polite "opens soon" notice.
   * true  = pay buttons become live Stripe Payment Links (normal behavior).
   * Keep true for production. Buttons with an unfilled link below still fall back safely
   * to their on-page navigation, so it is safe to be live before every link is pasted. */
  checkoutEnabled: true,
  checkoutComingSoonMsg: "Enrollment opens shortly. Email events@thenorthcreek.com to be invited first.",

  /* Stripe Dashboard > Payments > Payment Links — paste each LIVE URL here.
     Recurring links (memberships) create a Subscription; one-time links create a Charge. */
  paymentLinks: {
    "estate-pass":          "https://buy.stripe.com/00weVd15L68kg1dgey43S00",  // LIVE — Estate Pass — $100/mo (recurring)
    "founding-annual":      "https://buy.stripe.com/3cI00j8yd40ccP10fA43S01",  // LIVE — Founding Membership — $3,000/yr (recurring)
    "founding-monthly":     "https://buy.stripe.com/28E9ATdSxcwI3er1jE43S02",  // LIVE — Founding Membership — $250/mo (recurring)
    "creek-pass":           "https://buy.stripe.com/5kQ00j9ChaoA6qD6DY43S03",  // LIVE — Creek Pass — $40/mo standalone (recurring)
    "range-bucket":         "https://buy.stripe.com/14AfZh4hX2W85mz1jE43S04",  // LIVE — Practice Range — $12 prepaid bucket (adjustable quantity)
    "ticket-gathering":     "https://buy.stripe.com/6oUeVd7u9bsE7uHbYi43S05",  // LIVE — Signature Gathering — $100/guest
    "ticket-tunnel-vision": "https://buy.stripe.com/aFabJ1g0F54gg1d8M643S06"   // LIVE — Tunnel Vision — $60
  }
};

/* Runtime: any element with data-pay="KEY" becomes its Payment Link.
 * The signed-in member's id rides along as client_reference_id (and email is prefilled),
 * so the Stripe webhook can tie the completed payment back to the user row in Supabase.
 * Until a link is filled in, the element keeps its existing href/behavior and is marked
 * data-unconfigured="1" so you can spot what still needs a link. */
(function () {
  function member() { return window.NC_MEMBER || null; }         // set after sign-in
  function build(url) {
    if (!url) return null;
    var m = member(), u;
    try { u = new URL(url); } catch (e) { return url; }
    if (m && m.id)    u.searchParams.set("client_reference_id", m.id);
    if (m && m.email) u.searchParams.set("prefilled_email", m.email);
    return u.toString();
  }
  function enabled() { return !!(window.NC_CONFIG && NC_CONFIG.checkoutEnabled); }
  function toast(msg) {
    var t = document.getElementById("nc-toast");
    if (!t) {
      t = document.createElement("div"); t.id = "nc-toast";
      t.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:90%;"
        + "background:#004400;color:#F5F0E6;font-family:Georgia,serif;font-size:15px;line-height:1.5;"
        + "padding:14px 20px;border:1px solid #C5A258;z-index:9999;box-shadow:0 6px 30px rgba(0,0,0,.25);"
        + "opacity:0;transition:opacity .25s";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(function(){ t.style.opacity = "1"; });
    clearTimeout(t._h); t._h = setTimeout(function(){ t.style.opacity = "0"; }, 4200);
  }
  function upgrade() {
    var links = (window.NC_CONFIG && NC_CONFIG.paymentLinks) || {};
    var live = enabled();
    document.querySelectorAll("[data-pay]").forEach(function (el) {
      var url = live ? build(links[el.getAttribute("data-pay")]) : null;
      if (url) { el.setAttribute("href", url); el.removeAttribute("data-unconfigured"); el.removeAttribute("data-gated"); }
      else if (!live) { el.setAttribute("data-gated", "1"); }        // checkout switched off
      else { el.setAttribute("data-unconfigured", "1"); }            // live, but no link yet
    });
  }
  // While checkout is off, intercept clicks on pay buttons so none reach Stripe.
  document.addEventListener("click", function (e) {
    if (enabled()) return;
    var el = e.target.closest && e.target.closest("[data-pay]");
    if (!el) return;
    e.preventDefault();
    toast((window.NC_CONFIG && NC_CONFIG.checkoutComingSoonMsg) || "Enrollment opens shortly.");
  }, true);
  if (document.readyState !== "loading") upgrade();
  else document.addEventListener("DOMContentLoaded", upgrade);
  window.NC = { upgradePayLinks: upgrade, buildPayUrl: build };
})();
