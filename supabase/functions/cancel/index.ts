// cancel — self-service membership/Estate Pass cancellation (email-verified).
// Two steps so no one can cancel someone else's plan from just an email:
//   POST {email}            -> if an active membership exists, email a signed confirm link
//   GET  ?c=<email>&s=<sig> -> verify sig, cancel Stripe sub at period end, email confirmation
// Deploy: supabase functions deploy cancel --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, RESEND_API_KEY, PASS_SIGNING_SECRET, PUBLIC_SITE (+ auto SUPABASE_*)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@16?target=deno";

const URL_=Deno.env.get("SUPABASE_URL")!, SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const stripe=new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!,{apiVersion:"2024-06-20"});
const RESEND=Deno.env.get("RESEND_API_KEY")!, SECRET=Deno.env.get("PASS_SIGNING_SECRET")!;
const SITE=Deno.env.get("PUBLIC_SITE")??"https://thenorthcreek.com";
const FROM="The North Creek Estate <events@thenorthcreek.com>";
const svc=createClient(URL_,SERVICE);

async function sign(v:string){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const m=await crypto.subtle.sign("HMAC",k,new TextEncoder().encode("cancel:"+v.toLowerCase()));return [...new Uint8Array(m)].map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,20);}
async function email(to:string,subject:string,html:string){await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND}`,"Content-Type":"application/json"},body:JSON.stringify({from:FROM,to,subject,html})});}
const page=(t:string,b:string)=>`<!doctype html><meta charset=utf-8><title>${t}</title><body style="font-family:Georgia,serif;background:#F5F0E6;color:#111;max-width:560px;margin:60px auto;padding:0 20px"><h1 style="color:#004400">${t}</h1>${b}</body>`;

Deno.serve(async (req)=>{
  const url=new URL(req.url);

  // STEP 2 — confirm link clicked
  if(req.method==="GET" && url.searchParams.has("c")){
    const em=(url.searchParams.get("c")||"").toLowerCase(), sig=url.searchParams.get("s")||"";
    if(sig!==await sign(em)) return new Response(page("Link invalid","<p>This cancellation link is invalid or expired. Please start again from the site.</p>"),{status:400,headers:{"content-type":"text/html"}});
    const { data:mem }=await svc.from("memberships").select("*").eq("email",em).eq("status","active");
    let n=0;
    for(const m of (mem||[])){
      if(m.stripe_subscription_id){ try{ await stripe.subscriptions.update(m.stripe_subscription_id,{cancel_at_period_end:true}); }catch{} }
      await svc.from("memberships").update({status:"canceled"}).eq("id",m.id); n++;
    }
    await svc.from("admin_log").insert({actor_email:em,action:"self_cancel",detail:{count:n}});
    await email(em,"Your North Creek cancellation is confirmed",
      `<p>Your membership/Estate Pass has been set to cancel at the end of the current billing period. You'll retain access until then. We'd be glad to welcome you back anytime.</p><p>— The North Creek Estate</p>`);
    return new Response(page("Cancellation confirmed",`<p>Done. ${n} active plan(s) will end at the close of the current billing period, and a confirmation is on its way to your inbox. You keep access until then.</p><p><a href="${SITE}" style="color:#1F5A36">Return to the estate</a></p>`),{headers:{"content-type":"text/html"}});
  }

  // STEP 1 — request (POST {email})
  if(req.method==="POST"){
    const {email:em}=await req.json().catch(()=>({email:""}));
    const e=(em||"").toLowerCase().trim();
    const cors={"content-type":"application/json","Access-Control-Allow-Origin":"*"};
    if(!e) return new Response(JSON.stringify({error:"email required"}),{status:400,headers:cors});
    const { data:mem }=await svc.from("memberships").select("id").eq("email",e).eq("status","active");
    // always respond the same (don't reveal whether an account exists)
    if(mem && mem.length){
      const link=`${SITE.replace("thenorthcreek.com","essciypxrnfzqzsfyole.functions.supabase.co")}/cancel?c=${encodeURIComponent(e)}&s=${await sign(e)}`;
      await email(e,"Confirm your North Creek cancellation",
        `<p>We received a request to cancel your membership or Estate Pass. If this was you, confirm below and it will end at the close of your current billing period:</p><p><a href="${link}" style="background:#004400;color:#F5F0E6;padding:10px 18px;text-decoration:none">Confirm cancellation</a></p><p style="color:#666;font-size:13px">If you didn't request this, ignore this email — nothing changes.</p>`);
    }
    return new Response(JSON.stringify({ok:true}),{headers:cors});
  }
  return new Response("ok");
});
