// plans-sync — push a plan from our DB to Stripe (create/update product + price).
// Our DB is the source of truth; Stripe follows. Manager/owner only.
// Deploy: supabase functions deploy plans-sync --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY (+ auto SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
//
// POST { plan_id }  Authorization: Bearer <staff access token>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@16?target=deno";

const URL_=Deno.env.get("SUPABASE_URL")!, SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON=Deno.env.get("SUPABASE_ANON_KEY")??"";
const stripe=new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!,{apiVersion:"2024-06-20"});
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  const j=(o:unknown,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,"content-type":"application/json"}});

  // caller must be manager/owner
  const asUser=createClient(URL_,ANON,{global:{headers:{Authorization:req.headers.get("Authorization")??""}}});
  const { data:mgr }=await asUser.rpc("is_manager");
  if(mgr!==true) return j({error:"managers only"},403);

  const { plan_id }=await req.json().catch(()=>({}));
  const svc=createClient(URL_,SERVICE);
  const { data:plan }=await svc.from("plans").select("*").eq("id",plan_id).maybeSingle();
  if(!plan) return j({error:"plan not found"},404);

  // 1. product (create or update)
  let productId=plan.stripe_product_id;
  if(productId){ await stripe.products.update(productId,{name:plan.name,description:plan.description??undefined,active:plan.active}); }
  else { const p=await stripe.products.create({name:plan.name,description:plan.description??undefined}); productId=p.id; }

  // 2. price — Stripe prices are immutable; if amount/interval changed, create a new price
  let priceId=plan.stripe_price_id;
  const recurring = plan.interval==="one_time" ? undefined : { interval: plan.interval as "month"|"year" };
  let needNew=!priceId;
  if(priceId){
    try{ const cur=await stripe.prices.retrieve(priceId);
      if(cur.unit_amount!==plan.price_cents || (cur.recurring?.interval)!==(recurring?.interval)) needNew=true;
    }catch{ needNew=true; }
  }
  if(needNew){
    const price=await stripe.prices.create({product:productId,unit_amount:plan.price_cents,currency:plan.currency||"usd",...(recurring?{recurring}:{}) });
    priceId=price.id;
    // deactivate the old price so only the current one is live
    if(plan.stripe_price_id && plan.stripe_price_id!==priceId){ try{ await stripe.prices.update(plan.stripe_price_id,{active:false}); }catch{} }
  }

  // 3. write IDs back
  await svc.from("plans").update({stripe_product_id:productId,stripe_price_id:priceId,updated_at:new Date().toISOString()}).eq("id",plan_id);
  await svc.from("admin_log").insert({actor_email:(await asUser.auth.getUser()).data.user?.email,action:"plan_sync",detail:{plan:plan.key,productId,priceId,price_cents:plan.price_cents}});

  return j({ ok:true, stripe_product_id:productId, stripe_price_id:priceId });
});
