/* THE NORTH CREEK ESTATE — front-end config
 * Public values only. Never put Stripe secret keys or the Supabase service-role key here.
 * Fill in the blanks below with values from your Stripe and Supabase dashboards.
 */
window.NC_CONFIG = {
  supabase: {
    url:     "https://essciypxrnfzqzsfyole.supabase.co",
    anonKey: "sb_publishable_VMPDSJ0aTjzR30QJu1F7xA_nQPY3jTb"   // publishable anon key — safe in the browser
  },
  stripe: {
    // Billing > Customer portal link, used by "Manage membership"
    customerPortalUrl: ""
  },

  /* GO-LIVE SWITCH for checkout.
   * false = pay buttons do NOT reach Stripe; clicking shows a polite "opens soon" notice.
   *         Use this while the Supabase webhook (records payment + issues pass + emails)
   *         is not yet deployed, so no money is taken with nothing behind it.
   * true  = pay buttons become live Stripe Payment Links (normal behavior).
   * Flip to true ONLY after the webhook is deployed and smoke-tested. */
  checkoutEnabled: true,   // TEST BUILD — staging only
  checkoutComingSoonMsg: "Enrollment opens shortly. Email events@thenorthcreek.com to be invited first.",
  /* Stripe Dashboard > Payments > Payment Links. Paste each URL here.
     Recurring links (memberships) create a Subscription; one-time links create a Charge. */
  paymentLinks: {
    "estate-pass":          "https://buy.stripe.com/test_bJe14n2cc4kmbWR9aggQE00",  // Estate Pass — $100/mo (recurring)
    "founding-annual":      "https://buy.stripe.com/test_bJe4gz6ss5oq2mhcmsgQE01",  // Founding Membership — $3,000/yr (recurring)
    "founding-monthly":     "https://buy.stripe.com/test_28EdR9eYYcQS3ql5Y4gQE02",  // Founding Membership — $250/mo (recurring)
    "creek-pass":           "https://buy.stripe.com/test_aFaeVd6ssaIKbWRfyEgQE03",  // Creek Pass — $40/mo standalone (recurring)
    "range-bucket":         "https://buy.stripe.com/test_dRm3cvbMMcQSd0V4U0gQE04",  // Practice Range — $12 prepaid bucket (adjustable quantity)
    "ticket-gathering":     "https://buy.stripe.com/test_cNi6oHeYY2ce6Cx1HOgQE05",  // Signature Gathering — $100/guest
    "ticket-tunnel-vision": "https://buy.stripe.com/test_6oU28r5oo2cef934U0gQE06"   // Tunnel Vision — $60
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
