// office — back-office metrics + per-member financial history, Stripe-backed.
// Manager/owner only. Deploy: supabase functions deploy office --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY (+ auto SUPABASE_*)
//
// POST { action:"overview" }        -> MRR, active subs, 30d revenue, failed charges, recent payments, growth
// POST { action:"member", email }   -> that member's Stripe subscription + payments + invoices

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@16?target=deno";

const URL_=Deno.env.get("SUPABASE_URL")!, SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON=Deno.env.get("SUPABASE_ANON_KEY")??"";
const stripe=new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!,{apiVersion:"2024-06-20"});
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const j=(o:unknown,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,"content-type":"application/json"}});

function monthlyEquiv(sub:Stripe.Subscription){
  let cents=0;
  for(const it of sub.items.data){
    const amt=it.price.unit_amount??0, qty=it.quantity??1;
    const iv=it.price.recurring?.interval;
    cents += iv==="year" ? (amt*qty)/12 : iv==="month" ? amt*qty : iv==="week" ? amt*qty*4.33 : 0;
  }
  return cents;
}

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  const asUser=createClient(URL_,ANON,{global:{headers:{Authorization:req.headers.get("Authorization")??""}}});
  const { data:mgr }=await asUser.rpc("is_manager");
  if(mgr!==true) return j({error:"managers only"},403);

  const { action, email }=await req.json().catch(()=>({action:""}));

  if(action==="overview"){
    // active subscriptions -> MRR
    let mrr=0, activeSubs=0;
    for await (const sub of stripe.subscriptions.list({status:"active",limit:100,expand:["data.items.data.price"]})){
      mrr += monthlyEquiv(sub); activeSubs++;
    }
    // charges in last 30d
    const since=Math.floor(Date.now()/1000)-30*86400;
    let rev30=0, failed=0; const recent:any[]=[];
    for await (const ch of stripe.charges.list({created:{gte:since},limit:100})){
      if(ch.paid && ch.status==="succeeded"){ rev30+=ch.amount; }
      if(ch.status==="failed"){ failed++; }
      if(recent.length<12) recent.push({amount:ch.amount,status:ch.status,email:ch.billing_details?.email||ch.receipt_email||"",created:ch.created,desc:ch.description||""});
    }
    return j({ mrr_cents:Math.round(mrr), active_subscriptions:activeSubs, revenue_30d_cents:rev30, failed_charges_30d:failed, recent_payments:recent });
  }

  if(action==="member"){
    if(!email) return j({error:"email required"},400);
    const custs=await stripe.customers.list({email:String(email).toLowerCase(),limit:1});
    if(!custs.data.length) return j({ found:false, payments:[], invoices:[], subscription:null });
    const cust=custs.data[0];
    const subs=await stripe.subscriptions.list({customer:cust.id,status:"all",limit:5,expand:["data.items.data.price"]});
    const charges=await stripe.charges.list({customer:cust.id,limit:50});
    const invoices=await stripe.invoices.list({customer:cust.id,limit:50});
    return j({
      found:true, customer_id:cust.id, since:cust.created,
      subscription: subs.data[0] ? { status:subs.data[0].status, monthly_cents:Math.round(monthlyEquiv(subs.data[0])), current_period_end:subs.data[0].current_period_end, cancel_at_period_end:subs.data[0].cancel_at_period_end } : null,
      payments: charges.data.map(c=>({amount:c.amount,status:c.status,created:c.created,desc:c.description||""})),
      invoices: invoices.data.map(i=>({amount:i.amount_paid,status:i.status,created:i.created,number:i.number,hosted:i.hosted_invoice_url}))
    });
  }

  return j({error:"unknown action"},400);
});
