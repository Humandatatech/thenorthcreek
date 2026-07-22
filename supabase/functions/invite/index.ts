// invite — owner-only: CREATE a staff user + GRANT access + email a working sign-in link.
// Self-contained: creates a confirmed account via the service role (works with public sign-ups
// disabled), sets the staff role, generates a magic-link, and emails it directly via Resend.
// Deploy: supabase functions deploy invite --no-verify-jwt
// Secrets used: RESEND_API_KEY, PUBLIC_SITE (+ auto SUPABASE_*)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL_=Deno.env.get("SUPABASE_URL")!, SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON=Deno.env.get("SUPABASE_ANON_KEY")??"";
const RESEND=Deno.env.get("RESEND_API_KEY")??"";
const SITE=(Deno.env.get("PUBLIC_SITE")??"").replace(/\/$/,"");
const FROM="The North Creek Estate <events@thenorthcreek.com>";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const j=(o:unknown,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,"content-type":"application/json"}});
const svc=createClient(URL_,SERVICE);

async function mail(to:string,subject:string,html:string){
  if(!RESEND) return false;
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND}`,"Content-Type":"application/json"},body:JSON.stringify({from:FROM,to,subject,html})});
  return r.ok;
}

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  // caller must be an owner
  const asUser=createClient(URL_,ANON,{global:{headers:{Authorization:req.headers.get("Authorization")??""}}});
  const { data:owner }=await asUser.rpc("is_owner");
  if(owner!==true) return j({error:"owners only"},403);

  const { email, role, redirect }=await req.json().catch(()=>({}));
  const e=(email||"").toLowerCase().trim();
  if(!e) return j({error:"email required"},400);
  const r=(role||"gate");
  const redirectTo = redirect || (SITE ? SITE+"/admin" : undefined);

  // 1) authorization: set the staff role (service role bypasses RLS)
  const up=await svc.from("staff").upsert({email:e,role:r},{onConflict:"email"});
  if(up.error) return j({error:"staff: "+up.error.message},400);

  // 2) account: create a confirmed user so they can sign in (skip if already exists)
  let created=false;
  const cu=await svc.auth.admin.createUser({ email:e, email_confirm:true });
  if(!cu.error) created=true;
  else if(!/already|registered|exists/i.test(cu.error.message)) return j({error:"create: "+cu.error.message},400);

  // 3) access: generate a real magic-link and email it via Resend
  const link=await svc.auth.admin.generateLink({ type:"magiclink", email:e, options:{ redirectTo } });
  const action=(link.data as any)?.properties?.action_link;
  let emailed=false;
  if(action){
    const html=`<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1c1c19">
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#9c7a28">The North Creek Estate</div>
      <h1 style="font-size:24px;color:#004400;margin:6px 0 0">Estate Operations Console</h1>
      <p style="color:#333;line-height:1.6">You've been granted <b>${r}</b> access to the North Creek operations console. Use the button below to sign in. This link is single-use and expires shortly.</p>
      <p style="margin:26px 0"><a href="${action}" style="background:#2f8560;color:#fff;padding:13px 22px;text-decoration:none;font-family:monospace;letter-spacing:.06em;text-transform:uppercase;font-size:13px">Sign in to the console</a></p>
      <p style="color:#888;font-size:12px">If the button doesn't work, copy this link into your browser:<br>${action}</p>
    </div>`;
    emailed=await mail(e,"Your North Creek console access",html);
  }

  return j({ ok:true, created, emailed, note: emailed ? (created?"user created; sign-in link sent":"access granted; sign-in link sent") : (created?"user created; email not sent":"access set; email not sent") });
});
