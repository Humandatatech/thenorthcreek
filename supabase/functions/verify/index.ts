// supabase/functions/verify/index.ts  — the QR scan target (v6.21+)
// GET  /verify?p=&s=            -> gate page: big VALID/INVALID + identity + live status
// GET  /verify?p=&s=&img=1      -> QR PNG of this pass (self-hosted; used in emails)
// GET  /verify?setgate=TOKEN    -> one-time staff device setup (stores gate token locally)
// POST /verify {p,s,gate}       -> mark a single-use ticket redeemed (staff only)
//
// Deploy:  supabase functions deploy verify --no-verify-jwt
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PASS_SIGNING_SECRET,
//          GATE_TOKEN, PUBLIC_SITE
// One-of-one: the signature is an HMAC only this server can produce, and the
// status is read live — a forged code fails, a canceled pass shows INVALID,
// and a single-use ticket flips to REDEEMED on first gate scan.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.3";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SIGN_SECRET = Deno.env.get("PASS_SIGNING_SECRET")!;
const GATE_TOKEN  = Deno.env.get("GATE_TOKEN")!;
const SITE        = Deno.env.get("PUBLIC_SITE") ?? "https://thenorthcreek.com";

const C = { green:"#1F5A36", deep:"#004400", ivory:"#F5F0E6", gold:"#C5A258", ink:"#111", red:"#7a1f1f", muted:"#5a5a52", line:"#e3ddce" };

async function sign(passId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIGN_SECRET),
    { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(passId));
  return [...new Uint8Array(mac)].map((b)=>b.toString(16).padStart(2,"0")).join("").slice(0,16);
}
function safeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0; for (let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function esc(x: string){ return (x||"").replace(/[<>&]/g,(c)=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]!)); }
function fmt(iso: string|null){ return iso ? new Date(iso).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : ""; }

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ---- staff device setup: store the gate token locally, once ----
  if (url.searchParams.has("setgate")) {
    const t = url.searchParams.get("setgate") || "";
    const ok = safeEq(t, GATE_TOKEN);
    return html(page(`<div style="text-align:center">
      <div style="font-size:34px;color:${ok?C.green:C.red}">${ok?"Gate device ready":"Wrong gate code"}</div>
      <p style="color:${C.muted}">${ok?"This phone can now mark tickets used when you scan them.":"Check the code and try again."}</p>
      ${ok?`<script>try{localStorage.setItem('nc_gate',${JSON.stringify(t)})}catch(e){}</script>`:""}
    </div>`), ok?200:403);
  }

  const p = url.searchParams.get("p") || "";
  const s = url.searchParams.get("s") || "";

  // ---- redeem (staff only) ----
  if (req.method === "POST") {
    let bp="", bs="", bg="", by="gate";
    try { const j = await req.json(); bp=j.p||""; bs=j.s||""; bg=j.gate||""; by=j.by||"gate"; } catch {}
    if (!safeEq(bg, GATE_TOKEN)) return json({ ok:false, error:"not authorized" }, 403);
    if (!safeEq(bs, await sign(bp))) return json({ ok:false, error:"bad signature" }, 400);
    const { data: pass } = await supabase.from("passes").select("*").eq("pass_id", bp).maybeSingle();
    if (!pass) return json({ ok:false, error:"not found" }, 404);
    if (pass.status !== "active") return json({ ok:false, error:`pass ${pass.status}` }, 409);
    if (pass.single_use && pass.redeemed_at) return json({ ok:false, error:"already redeemed", redeemed_at: pass.redeemed_at }, 409);
    if (pass.single_use) {
      await supabase.from("passes").update({ redeemed_at: new Date().toISOString(), redeemed_by: by }).eq("pass_id", bp);
    }
    return json({ ok:true, redeemed: pass.single_use, name: pass.holder_name, product: pass.product });
  }

  // ---- signature check (applies to img + gate view) ----
  const good = p && safeEq(s, await sign(p));

  // ---- QR PNG (used in emails) ----
  if (url.searchParams.has("img")) {
    if (!good) return new Response("bad signature", { status: 400 });
    const target = `${verifyBase(url)}?p=${encodeURIComponent(p)}&s=${s}`;
    const dataUrl: string = await QRCode.toDataURL(target, { margin:1, width:512, color:{ dark:C.deep, light:C.ivory } });
    const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c)=>c.charCodeAt(0));
    return new Response(bytes, { headers:{ "content-type":"image/png", "cache-control":"public,max-age=86400" } });
  }

  // ---- gate view ----
  if (!good) {
    return html(result(false, "INVALID PASS", "This code could not be verified. It may be forged, altered, or mistyped.", "", ""), 200);
  }
  const { data: pass } = await supabase.from("passes").select("*").eq("pass_id", p).maybeSingle();
  if (!pass) return html(result(false, "NOT FOUND", "No pass matches this code.", "", ""), 200);

  const who = esc(pass.holder_name || pass.email || "North Creek guest");
  const label = productLabel(pass.product);

  if (pass.status !== "active")
    return html(result(false, pass.status.toUpperCase(), `${label} — no longer valid.`, who, ""), 200);

  if (pass.single_use && pass.redeemed_at)
    return html(result(false, "ALREADY USED", `${label} — redeemed ${fmt(pass.redeemed_at)}.`, who, ""), 200);

  // VALID
  const sub = pass.single_use
    ? `${label} — admits one. Not yet redeemed.`
    : `${label} — active credential.`;
  const redeemUi = pass.single_use ? redeemButton(p, s) : "";
  return html(result(true, "VALID", sub, who, redeemUi), 200);
});

// ---------- helpers ----------
function verifyBase(url: URL){ return `${url.protocol}//${url.host}${url.pathname}`; }
function productLabel(prod: string){
  const m: Record<string,string> = {
    "founding-annual":"Founding Membership","founding-monthly":"Founding Membership","estate-pass":"Estate Pass",
    "creek-pass":"Creek Pass","range-bucket":"Practice Range","ticket-tunnel-vision":"Tunnel Vision",
    "ticket-gathering":"Signature Gathering","ticket-drone":"Drone Exhibition" };
  return m[prod] ?? prod;
}
function json(o: unknown, status=200){ return new Response(JSON.stringify(o), { status, headers:{ "content-type":"application/json" } }); }
function html(body: string, status=200){ return new Response(body, { status, headers:{ "content-type":"text/html; charset=utf-8" } }); }

function page(inner: string){
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Verify — The North Creek Estate</title>
  <style>body{margin:0;background:${C.ivory};font-family:Georgia,serif;color:${C.ink};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border:1px solid ${C.line};max-width:420px;width:100%;padding:30px}
  .ey{letter-spacing:.28em;text-transform:uppercase;font-size:11px;color:${C.gold};font-family:Arial,sans-serif;text-align:center}
  .btn{display:inline-block;border:1px solid ${C.green};color:${C.green};text-decoration:none;padding:11px 20px;font-family:Arial,sans-serif;font-size:14px;cursor:pointer;background:#fff}
  </style></head><body><div class="card"><div class="ey">The North Creek Estate</div>${inner}</div></body></html>`;
}
function result(ok: boolean, verdict: string, sub: string, who: string, redeemUi: string){
  const color = ok ? C.green : C.red;
  const mark  = ok ? "&#10003;" : "&#10007;";
  return page(`<div style="text-align:center;margin-top:14px">
    <div style="width:96px;height:96px;border:3px solid ${color};color:${color};font-size:52px;line-height:92px;margin:0 auto 14px">${mark}</div>
    <div style="font-family:Arial,sans-serif;letter-spacing:.16em;font-size:22px;font-weight:600;color:${color}">${verdict}</div>
    ${who?`<div style="font-family:Georgia,serif;font-size:22px;color:${C.deep};margin-top:12px">${who}</div>`:""}
    <div style="color:${C.muted};font-size:15px;margin-top:6px">${sub}</div>
    ${redeemUi}
    <div style="margin-top:20px;font-family:Arial,sans-serif;font-size:11px;color:${C.muted}">Verified live &middot; ${new Date().toLocaleString("en-US")}</div>
  </div>`);
}
function redeemButton(p: string, s: string){
  return `<div id="rz" style="margin-top:18px">
    <button class="btn" id="rb">Mark as used</button>
    <div id="rmsg" style="font-family:Arial,sans-serif;font-size:12px;color:${C.muted};margin-top:8px"></div>
  </div>
  <script>
  (function(){
    var g=null; try{g=localStorage.getItem('nc_gate')}catch(e){}
    var rz=document.getElementById('rz'), rb=document.getElementById('rb'), m=document.getElementById('rmsg');
    if(!g){ rz.style.display='none'; return; }  // only staff devices see this
    rb.onclick=function(){
      rb.disabled=true; m.textContent='Marking…';
      fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({p:${JSON.stringify(p)},s:${JSON.stringify(s)},gate:g,by:'gate'})})
      .then(function(r){return r.json()}).then(function(d){
        if(d.ok){ m.style.color=${JSON.stringify(C.green)}; m.textContent='Admitted. Ticket now used.'; rb.style.display='none'; }
        else { m.style.color=${JSON.stringify(C.red)}; m.textContent=d.error||'Could not redeem'; rb.disabled=false; }
      }).catch(function(){ m.textContent='Network error'; rb.disabled=false; });
    };
  })();
  </script>`;
}
