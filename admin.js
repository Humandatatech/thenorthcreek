(function(){
  // ---- theme (DRGx console dark/light) ----
  try{ var t=localStorage.getItem("nc-theme")||((window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"); document.documentElement.setAttribute("data-theme",t); }catch(e){ document.documentElement.setAttribute("data-theme","light"); }
  document.addEventListener("DOMContentLoaded",function(){
    var tt=document.getElementById("themeToggle"); if(!tt) return;
    function paint(){ var cur=document.documentElement.getAttribute("data-theme"); tt.textContent=cur==="light"?"DARK":"LIGHT"; }
    paint();
    tt.onclick=function(){ var cur=document.documentElement.getAttribute("data-theme")==="light"?"dark":"light"; document.documentElement.setAttribute("data-theme",cur); try{localStorage.setItem("nc-theme",cur);}catch(e){} paint(); };
  });
  var cfg=(window.NC_CONFIG&&NC_CONFIG.supabase)||{};
  var FUNCTIONS=(cfg.url||"").replace(".supabase.co",".functions.supabase.co");
  var sb=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,detectSessionInUrl:true}});
  var session=null, role="gate", booted=false;
  var PASSES_SEL="pass_id,user_id,email,name:holder_name,product,kind,status,single_use,redeemed_at,redeemed_by,event_name,quantity,created_at:issued_at";
  var MEMB_SEL="id,user_id,email,product,status,current_period_end,stripe_subscription_id,created_at:updated_at";
  var eventNames={}, eventById={};
  function $(id){return document.getElementById(id)}
  function esc(x){return (x==null?"":String(x)).replace(/[<>&]/g,function(c){return{"<":"&lt;",">":"&gt;","&":"&amp;"}[c]})}
  function fmt(d){return d? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):""}
  function show(id){["signin","denied","admin"].forEach(function(s){$(s).classList.toggle("hide",s!==id)})}
  function prod(p){var m={"founding-annual":"Founding Membership","founding-monthly":"Founding Membership","estate-pass":"Estate Pass","creek-pass":"Creek Pass","range-bucket":"Practice Range","ticket-gathering":"Signature Gathering","ticket-tunnel-vision":"Tunnel Vision","ticket-drone":"Drone Exhibition"};return m[p]||p||""}
  function initials(name,email){var s=(name||email||"?").trim();var p=s.split(/[\s@.]+/).filter(Boolean);return ((p[0]||"?")[0]+(p[1]?p[1][0]:"")).toUpperCase()}
  var ncPos=null;
  function startGeo(){ try{ if(navigator.geolocation){ navigator.geolocation.watchPosition(function(p){ ncPos={lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy}; }, function(){}, {enableHighAccuracy:true,maximumAge:60000,timeout:12000}); } }catch(e){} }
  async function audit(event_type,category,opts){
    opts=opts||{};
    try{ await sb.from("audit_log").insert({ actor_email:(session&&session.user&&session.user.email)||null, actor_role:role, event_type:event_type, category:category, severity:opts.severity||"info", compliance:opts.compliance||null, subject:opts.subject||null, detail:opts.detail||null, lat:ncPos?ncPos.lat:null, lng:ncPos?ncPos.lng:null }); }catch(e){}
  }
  async function logScan(query,verdict,subEmail,subName,holdings){
    var sev=verdict==="valid"?"info":(verdict==="not_found"?"notice":"warning");
    await audit("verify.scan","verification",{severity:sev,compliance:"access_control",subject:subName||subEmail||query,detail:{verdict:verdict,query:query,holdings:holdings}});
  }

  async function refresh(){
    var r=await sb.auth.getSession(); session=r.data.session;
    if(!session){ show("signin"); return; }
    var s=await sb.rpc("is_staff"); if(s.data!==true){ show("denied"); audit("authz.denied","security",{severity:"warning",subject:(session&&session.user&&session.user.email)||null}); return; }
    var rr=await sb.rpc("staff_role"); role=rr.data||"gate";
    $("whoami").textContent=session.user.email; $("roleTag").textContent=role;
    applyRoleGating(); show("admin"); audit("auth.signin","authentication",{severity:"notice"});
    if(!booted){ booted=true; startGeo(); switchView("more"); }
  }
  function applyRoleGating(){
    document.querySelectorAll('#moreMenu [data-role]').forEach(function(b){
      var need=b.getAttribute('data-role'); var ok=(need==="owner")?(role==="owner"):(role==="owner"||role==="manager");
      b.style.display=ok?"":"none";
    });
    $("eventsCms").style.display=(role==="owner"||role==="manager")?"":"none";
  }
  $("sendLink").onclick=async function(){
    var email=$("email").value.trim(); if(!email) return;
    this.disabled=true; $("signinMsg").textContent="Sending\u2026";
    var r=await sb.auth.signInWithOtp({email:email,options:{emailRedirectTo:location.href.split("#")[0]}});
    this.disabled=false;
    $("signinMsg").innerHTML=r.error?'<span style="color:var(--red)">'+esc(r.error.message)+'</span>':'<span style="color:var(--green)">Check your email for the sign-in link.</span>';
  };
  async function signout(){ await audit("auth.signout","authentication"); sb.auth.signOut().then(function(){location.reload()}); }
  $("signout1").onclick=signout; $("signout2").onclick=signout;

  function switchView(v){
    document.querySelectorAll('.tabbar button').forEach(function(b){b.classList.toggle('on',b.dataset.view===v)});
    ["verify","more"].forEach(function(x){$("view-"+x).classList.toggle("hide",x!==v)});
    if(v==="more"){ backToMenu(); }
  }
  document.querySelectorAll('.tabbar button').forEach(function(b){ b.onclick=function(){ switchView(b.dataset.view); }; });

  function backToMenu(){ $("moreMenu").classList.remove("hide"); document.querySelectorAll('.more-panel').forEach(function(p){p.classList.add("hide")}); }
  document.querySelectorAll('#moreMenu [data-more]').forEach(function(b){
    b.onclick=function(){
      $("moreMenu").classList.add("hide");
      document.querySelectorAll('.more-panel').forEach(function(p){p.classList.add("hide")});
      $("more-"+b.dataset.more).classList.remove("hide");
      if(b.dataset.more==="dash") loadDash();
      if(b.dataset.more==="members") loadMembers();
      if(b.dataset.more==="analytics") loadAnalytics();
      if(b.dataset.more==="roster") loadRoster();
      if(b.dataset.more==="plans") loadPlans();
      if(b.dataset.more==="checkin") loadEventPicker();
      if(b.dataset.more==="events") loadEventsAdmin();
      if(b.dataset.more==="bookings") loadBookings();
      if(b.dataset.more==="scanlog") loadScanLog();
      if(b.dataset.more==="staff") loadStaff();
    };
  });
  document.querySelectorAll('[data-back]').forEach(function(b){ b.onclick=backToMenu; });

  // ===== VERIFY =====
  async function authFetch(action,body){ var r=await fetch(FUNCTIONS+"/admin",{method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"Content-Type":"application/json"},body:JSON.stringify(Object.assign({action:action},body))}); return r.json(); }
  function payStatus(m){ if(!m.length) return null; if(m.some(function(x){return x.status==="active"})) return "paid"; if(m.some(function(x){return x.status==="past_due"})) return "past_due"; return "canceled"; }
  async function verify(query,doLog){
    var q=(query||"").trim(); if(!q) return;
    $("verifyHint").classList.add("hide");
    $("verdict").innerHTML='<div class="verdict"><div class="vmsg muted">Looking up\u2026</div></div>';
    var email=null, byPass=null;
    var pById=await sb.from("passes").select(PASSES_SEL).eq("pass_id",q).maybeSingle();
    if(pById.data){ byPass=pById.data; email=pById.data.email; }
    var memQ,passQ;
    if(email){ memQ=await sb.from("memberships").select(MEMB_SEL).eq("email",email); passQ=await sb.from("passes").select(PASSES_SEL).eq("email",email); }
    else{
      memQ=await sb.from("memberships").select(MEMB_SEL).ilike("email","%"+q+"%");
      passQ=await sb.from("passes").select(PASSES_SEL).or("email.ilike.%"+q+"%,holder_name.ilike.%"+q+"%");
      var first=(memQ.data&&memQ.data[0])||(passQ.data&&passQ.data[0]);
      if(first){ email=first.email; memQ=await sb.from("memberships").select(MEMB_SEL).eq("email",email); passQ=await sb.from("passes").select(PASSES_SEL).eq("email",email); }
    }
    var mem=memQ.data||[], pass=passQ.data||[];
    var bk=email? ((await sb.from("bookings").select("*").eq("email",email)).data||[]) : [];
    if(!mem.length && !pass.length && !bk.length){ renderNotFound(q); if(doLog) logScan(q,"not_found",null,null,null); return; }
    var name=(mem[0]&&mem[0].name)||(pass[0]&&pass[0].name)||(bk[0]&&bk[0].name)||email||q;
    var isValid=renderVerdict({email:email,name:name,memberships:mem,passes:pass,bookings:bk});
    if(doLog){ var hold=[]; if(mem.length)hold.push(mem.length+"m"); if(pass.length)hold.push(pass.length+"p"); if(bk.length)hold.push(bk.length+"b"); logScan(q,isValid?"valid":"invalid",email,name,hold.join(" ")); }
  }
  function renderNotFound(q){
    $("verdict").innerHTML='<div class="verdict"><div class="verdict__band no"><div class="mk">\u2717</div><div class="lbl">No match<small>Nothing on file</small></div></div>'
      +'<div class="vmsg muted">No membership, pass, or ticket found for \u201c'+esc(q)+'.\u201d Check the spelling, or try their email or pass code.</div></div>';
  }
  function renderVerdict(g){
    var pay=payStatus(g.memberships);
    var activeMem=g.memberships.filter(function(m){return m.status==="active"});
    var liveTicket=g.passes.filter(function(p){return !p.redeemed_at && p.status!=="canceled"});
    var bk=g.bookings||[]; var today=new Date().toISOString().slice(0,10);
    var liveBooking=bk.filter(function(b){return (b.status==="confirmed"||b.status==="completed")&&(!b.booking_date||b.booking_date>=today)});
    var isValid=activeMem.length>0||liveTicket.length>0||liveBooking.length>0;
    var tier=(activeMem[0]&&prod(activeMem[0].product))||(g.memberships[0]&&prod(g.memberships[0].product))||"Guest";
    var band=isValid
      ? '<div class="verdict__band ok"><div class="mk">\u2713</div><div class="lbl">Valid<small>Admit \u2014 '+esc(tier)+'</small></div></div>'
      : '<div class="verdict__band no"><div class="mk">\u2717</div><div class="lbl">Not valid<small>No active membership or ticket</small></div></div>';
    var payHtml=pay?'<div class="paystat '+pay+'">'+(pay==="paid"?"Paid \u2014 active":pay==="past_due"?"Payment past due":"Canceled")+'</div>':'';
    var holds="";
    g.memberships.forEach(function(m){ holds+='<div class="hold"><div class="h-l"><div class="h-t">'+esc(prod(m.product))+'</div><div class="h-s">Membership'+(m.current_period_end?" \u00b7 renews "+fmt(m.current_period_end):"")+'</div></div><span class="pill '+esc(m.status)+'">'+esc(m.status)+'</span></div>'; });
    g.passes.forEach(function(p){
      var used=!!p.redeemed_at, st=p.status==="canceled"?"canceled":(used?"redeemed":"active");
      var action=(!used&&p.status!=="canceled"&&p.single_use)?'<button class="mini" data-mark="'+esc(p.pass_id)+'">Mark used</button>':'<span class="pill '+st+'">'+st+'</span>';
      holds+='<div class="hold"><div class="h-l"><div class="h-t">'+esc(prod(p.product))+'</div><div class="h-s">'+(p.single_use?"Ticket / pass":"Pass")+' \u00b7 '+esc(p.pass_id||"")+(used?" \u00b7 used "+fmt(p.redeemed_at):"")+'</div></div>'+action+'</div>';
    });
    var manage=(role!=="gate"&&g.passes[0])?'<div class="hold" style="justify-content:flex-end;gap:8px"><button class="mini danger" data-revoke="'+esc(g.passes[0].pass_id)+'">Revoke</button><button class="mini" data-reissue="'+esc(g.passes[0].pass_id)+'">Reissue</button></div>':'';
    (g.bookings||[]).forEach(function(b){
      var st=b.status==="canceled"?"canceled":((b.status==="confirmed"||b.status==="completed")?"active":"");
      holds+='<div class="hold"><div class="h-l"><div class="h-t">'+esc(b.resource||bkLabel(b.kind))+'</div><div class="h-s">'+esc(bkLabel(b.kind))+' \u00b7 '+tlDate(b.booking_date)+(b.time_slot?" \u00b7 "+esc(b.time_slot):"")+'</div></div><span class="pill '+st+'">'+esc(b.status)+'</span></div>';
    });
    $("verdict").innerHTML='<div class="verdict">'+band
      +'<div class="verdict__id"><div class="avatar">'+esc(initials(g.name,g.email))+'</div>'
      +'<div><div class="nm">'+esc(g.name||g.email)+'</div><div class="sub">'+esc(g.email||"")+'</div>'+payHtml+'</div></div>'
      +'<div class="holds">'+(holds||'<div class="vmsg muted">No active holdings.</div>')+manage+'</div>'
      +'<div id="vmsg" class="vmsg"></div></div>';
    document.querySelectorAll('[data-mark]').forEach(function(b){ b.onclick=async function(){ b.disabled=true; b.textContent="\u2026"; await sb.from("passes").update({redeemed_at:new Date().toISOString(),redeemed_by:session.user.email||"gate"}).eq("pass_id",b.dataset.mark); audit("pass.redeem","verification",{compliance:"access_control",subject:b.dataset.mark}); verify(g.email); }; });
    var rv=document.querySelector('[data-revoke]'); if(rv) rv.onclick=async function(){ rv.disabled=true; await sb.from("passes").update({status:"canceled"}).eq("pass_id",rv.dataset.revoke); await sb.from("admin_log").insert({actor_email:session.user.email,action:"revoke",detail:{pass_id:rv.dataset.revoke}}); audit("pass.revoke","admin",{severity:"warning",compliance:"access_control",subject:rv.dataset.revoke}); verify(g.email); };
    var ri=document.querySelector('[data-reissue]'); if(ri) ri.onclick=async function(){ ri.disabled=true; $("vmsg").textContent="Reissuing\u2026"; var d=await authFetch("reissue",{pass_id:ri.dataset.reissue}); if(d.pass_id) audit("pass.reissue","admin",{compliance:"access_control",subject:ri.dataset.reissue}); $("vmsg").innerHTML=d.pass_id?'<span style="color:var(--green)">New pass '+esc(d.pass_id)+' issued.</span>':'<span style="color:var(--red)">'+esc(d.error||"Failed")+'</span>'; };
    return isValid;
  }
  $("qGo").onclick=function(){ verify($("q").value,true); };
  $("q").addEventListener("keydown",function(e){ if(e.key==="Enter") verify(this.value,true); });

  $("startCam").onclick=async function(){
    var v=$("video");
    if(!("BarcodeDetector" in window)){ $("verifyHint").classList.remove("hide"); $("verifyHint").innerHTML="Live camera scanning isn't supported on this device \u2014 type the name, email, or pass code above instead. (Android Chrome supports the camera.)"; return; }
    try{
      var stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
      v.srcObject=stream; v.style.display="block"; await v.play();
      var det=new window.BarcodeDetector({formats:["qr_code"]});
      (function loop(){
        if(v.style.display==="none") return;
        det.detect(v).then(function(codes){
          if(codes&&codes.length){ var raw=codes[0].rawValue||"";
            var code=raw; try{ var u=new URL(raw); code=u.searchParams.get("c")||u.searchParams.get("p")||raw.split("/").pop()||raw; }catch(e){}
            v.srcObject.getTracks().forEach(function(t){t.stop()}); v.style.display="none";
            $("q").value=code; verify(code,true); return;
          }
          requestAnimationFrame(loop);
        }).catch(function(){ requestAnimationFrame(loop); });
      })();
    }catch(e){ $("verifyHint").classList.remove("hide"); $("verifyHint").textContent="Couldn't open the camera. Type the code instead."; }
  };

  // ===== EVENTS =====
  async function loadEventPicker(){
    var r=await sb.from("events").select("id,title,event_date,time_label,location,category,label").order("event_date");
    eventNames={}; eventById={};
    (r.data||[]).forEach(function(e){ eventNames[e.id]=e.title; eventById[e.id]=e; });
    $("eventPick").innerHTML='<option value="">Choose an event\u2026</option>'+(r.data||[]).map(function(e){return '<option value="'+esc(e.id)+'">'+esc(e.title)+' \u00b7 '+fmt(e.event_date)+'</option>'}).join("");
    $("eventCount").innerHTML=""; $("eventList").innerHTML="";
  }
  $("eventLoad").onclick=loadEvent;
  if($("eventPick")) $("eventPick").onchange=loadEvent;
  async function loadEvent(){
    var id=$("eventPick").value;
    if(!id){ $("eventCount").innerHTML=""; $("eventList").innerHTML=""; return; }
    var ev=eventById[id]||{};
    var r=await sb.from("passes").select(PASSES_SEL).eq("event_name",eventNames[id]||id);
    var rows=r.data||[], used=rows.filter(function(p){return p.redeemed_at}).length;
    var meta=[fmt(ev.event_date), ev.time_label, ev.location].filter(Boolean).map(esc).join(" \u00b7 ");
    var lbl=ev.label?'<span class="pill" style="margin-top:9px;border-color:var(--accent);color:var(--accent)">'+esc(ev.label)+'</span>':"";
    $("eventCount").innerHTML='<div class="mdcard" style="text-align:left">'
      +'<div class="mdhead"><div class="k">Checking in to</div><div class="nm" style="margin-top:4px">'+esc(ev.title||eventNames[id]||"")+'</div>'+(meta?'<div class="sub">'+meta+'</div>':"")+lbl+'</div>'
      +'<div style="padding:18px 16px;text-align:center"><div class="verdictbig">'+used+'</div><div class="muted small mt">of '+rows.length+' checked in</div></div></div>';
    $("eventList").innerHTML=rows.length?'<table><thead><tr><th>Holder</th><th>Pass</th><th></th></tr></thead><tbody>'+rows.map(function(p){
      return '<tr><td>'+esc(p.name||p.email||"")+'</td><td class="small muted">'+esc(p.pass_id||"")+'</td><td>'+(p.redeemed_at?'<span class="pill redeemed">in</span>':'<button class="mini ci" data-id="'+esc(p.pass_id)+'">Check in</button>')+'</td></tr>';
    }).join("")+'</tbody></table>':'<div class="muted small center mt">No tickets issued for this event yet.</div>';
    document.querySelectorAll(".ci").forEach(function(b){ b.onclick=async function(){ b.disabled=true; await sb.from("passes").update({redeemed_at:new Date().toISOString(),redeemed_by:session.user.email||"gate"}).eq("pass_id",b.dataset.id); audit("pass.redeem","verification",{compliance:"access_control",subject:b.dataset.id,detail:{event:ev.title}}); loadEvent(); }; });
  }
  async function loadEventsAdmin(){
    var r=await sb.from("events").select("*").order("event_date"); var rows=r.data||[];
    $("eventsAdminList").innerHTML='<table><thead><tr><th>Event</th><th>Date</th><th>State</th><th></th></tr></thead><tbody>'+rows.map(function(e){
      return '<tr><td>'+esc(e.title)+'</td><td class="small">'+fmt(e.event_date)+'</td><td>'+(e.status==="published"?'<span class="pill active">live</span>':'<span class="pill">draft</span>')+'</td><td><button class="mini ev-edit" data-id="'+esc(e.id)+'">Edit</button></td></tr>';
    }).join("")+'</tbody></table>';
    document.querySelectorAll(".ev-edit").forEach(function(b){ b.onclick=function(){ openEvent(rows.find(function(x){return x.id===b.dataset.id})); }; });
  }
  function openEvent(e){
    e=e||{}; $("evEditor").classList.remove("hide");
    $("ev_id").value=e.id||""; $("ev_title").value=e.title||""; $("ev_date").value=e.event_date||""; $("ev_time").value=e.time_label||"";
    $("ev_loc").value=e.location||""; $("ev_category").value=e.category||"event"; $("ev_label").value=e.label||""; $("ev_blurb").value=e.blurb||"";
    $("ev_ticket").value=e.ticket_url||""; $("ev_featured").checked=!!e.featured; $("ev_published").checked=(e.status==="published");
    $("evMsg").textContent=""; $("evEditor").scrollIntoView({behavior:"smooth"});
  }
  async function uploadTo(fileInput){
    var f=fileInput.files&&fileInput.files[0]; if(!f) return null;
    var path=Date.now()+"_"+f.name.replace(/[^a-z0-9.]+/gi,"_");
    var up=await sb.storage.from("event-media").upload(path,f,{upsert:true}); if(up.error) throw up.error;
    return sb.storage.from("event-media").getPublicUrl(path).data.publicUrl;
  }
  $("evNew").onclick=function(){ openEvent({}); };
  $("evCancel").onclick=function(){ $("evEditor").classList.add("hide"); };
  $("evSave").onclick=async function(){
    $("evMsg").textContent="Saving\u2026";
    try{
      var row={title:$("ev_title").value.trim(),event_date:$("ev_date").value||null,time_label:$("ev_time").value||null,location:$("ev_loc").value||null,category:$("ev_category").value,label:$("ev_label").value||null,blurb:$("ev_blurb").value||null,ticket_url:$("ev_ticket").value||null,featured:$("ev_featured").checked,status:$("ev_published").checked?"published":"draft"};
      var hero=await uploadTo($("ev_hero")); if(hero) row.hero_url=hero;
      var fly=await uploadTo($("ev_flyer")); if(fly) row.flyer_url=fly;
      var id=$("ev_id").value;
      var res=id? await sb.from("events").update(row).eq("id",id) : await sb.from("events").insert(row);
      if(res.error) throw res.error;
      $("evMsg").innerHTML='<span style="color:var(--green)">Saved.</span>'; $("evEditor").classList.add("hide"); loadEventsAdmin();
    }catch(e){ $("evMsg").innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>'; }
  };
  $("evDelete").onclick=async function(){ var id=$("ev_id").value; if(!id) return; await sb.from("events").delete().eq("id",id); $("evEditor").classList.add("hide"); loadEventsAdmin(); };

  // ===== DASHBOARD =====
  async function loadDash(){
    var pl=await sb.from("plans").select("key,price_cents,interval"); var price={};
    (pl.data||[]).forEach(function(p){price[p.key]={c:p.price_cents,i:p.interval}});
    var mem=await sb.from("memberships").select("product,status");
    var passes=await sb.from("passes").select("pass_id,redeemed_at,single_use");
    var mrows=mem.data||[], prows=passes.data||[];
    $("mActive").textContent=mrows.filter(function(m){return m.status==="active"}).length;
    $("mPasses").textContent=prows.length;
    $("mCheckins").textContent=prows.filter(function(p){return p.single_use&&p.redeemed_at}).length;
    var mrr=0; mrows.filter(function(m){return m.status==="active"}).forEach(function(m){var p=price[m.product];if(p&&p.c)mrr+=p.i==="year"?p.c/12:p.i==="month"?p.c:0});
    $("mMRR").textContent="$"+Math.round(mrr/100).toLocaleString();
    var by={}; mrows.forEach(function(m){by[m.product]=by[m.product]||{a:0,c:0};if(m.status==="active")by[m.product].a++;else by[m.product].c++});
    var keys=Object.keys(by).sort();
    $("dashByProduct").innerHTML=keys.length?keys.map(function(k){return '<tr><td>'+esc(prod(k))+'</td><td>'+by[k].a+'</td><td class="muted">'+by[k].c+'</td></tr>'}).join(""):'<tr><td colspan="3" class="muted small">No memberships yet.</td></tr>';
  }

  // ===== ROSTER =====
  async function loadRoster(){
    var q=$("rosterQ").value.trim();
    var query=sb.from("passes").select("name:holder_name,email,product,status,issued_at").limit(100).order("issued_at",{ascending:false});
    if(q) query=query.or("email.ilike.%"+q+"%,holder_name.ilike.%"+q+"%");
    var r=await query;
    $("rosterBody").innerHTML=(r.data&&r.data.length)?r.data.map(function(p){return '<tr><td>'+esc(p.name||p.email||"")+'</td><td class="small">'+esc(prod(p.product))+'</td><td><span class="pill '+esc(p.status)+'">'+esc(p.status)+'</span></td></tr>'}).join(""):'<tr><td colspan="3" class="muted small">No results.</td></tr>';
  }
  $("rosterRefresh").onclick=loadRoster;
  $("rosterQ").addEventListener("keydown",function(e){if(e.key==="Enter")loadRoster()});

  // ===== PLANS =====
  async function authFetchFn(fn,body){ var r=await fetch(FUNCTIONS+"/"+fn,{method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"Content-Type":"application/json"},body:JSON.stringify(body)}); return r.json(); }
  var planRows=[], plansHaveImageCol=false;
  function planImg(p){
    if(p&&p.image_url) return p.image_url;
    var k=((p&&(p.key||p.name))||"").toLowerCase();
    if(/range|bucket|practice|driv/.test(k)) return "image/DrivingRangeBallPerspective.jpg";
    if(/creek/.test(k)) return "image/Clubhouse-CreekView.png";
    if(/estate/.test(k)) return "image/Grand_3734-HDR.jpg";
    if(/found|member|parlour|circle/.test(k)) return "image/ParlourView_3639-HDR.jpg";
    if(/reserve/.test(k)) return "image/TheReserve_3534-HDR.jpg";
    if(/grand/.test(k)) return "image/TheGrand_3719-HDR.jpg";
    if(/gather|ticket|event|tunnel|drone|gallery/.test(k)) return "image/TheGallery_3524-HDR.jpg";
    return "image/Hero1_Clubhouse_AerialView.png";
  }
  async function loadPlans(){
    try{ var t=await sb.from("plans").select("image_url").limit(1); plansHaveImageCol=!t.error; }catch(e){ plansHaveImageCol=false; }
    if($("pl_image_wrap")) $("pl_image_wrap").style.display=plansHaveImageCol?"":"none";
    var r=await sb.from("plans").select("*").order("sort"); planRows=r.data||[];
    $("plansBody").innerHTML=planRows.length?planRows.map(function(p){return '<tr><td><div style="display:flex;align-items:center;gap:11px"><img class="plan-thumb" src="'+esc(planImg(p))+'" alt="" loading="lazy"><div><div style="font-family:\'Newsreader\',Georgia,serif;font-size:15px">'+esc(p.name)+'</div><div class="small muted">'+esc(p.key)+'</div></div></div></td><td>$'+(p.price_cents/100).toLocaleString()+'</td><td>'+(p.stripe_price_id?'<span class="pill active">synced</span>':'<span class="pill">\u2014</span>')+'</td><td><button class="mini pl-edit" data-id="'+esc(p.id)+'">Edit</button></td></tr>'}).join(""):'<tr><td colspan="4" class="muted small">No plans.</td></tr>';
    document.querySelectorAll(".pl-edit").forEach(function(b){ b.onclick=function(){ openPlan(planRows.find(function(x){return x.id===b.dataset.id})); }; });
  }
  function openPlan(p){ $("planEditor").classList.remove("hide"); $("pl_id").value=p.id; $("pl_name").value=p.name||""; $("pl_key").value=p.key||""; $("pl_desc").value=p.description||""; $("pl_price").value=(p.price_cents/100).toFixed(2); $("pl_interval").value=p.interval||"month"; $("pl_kind").value=p.kind||"membership"; $("pl_active").checked=!!p.active; if($("pl_image")) $("pl_image").value=p.image_url||""; if($("pl_thumb")) $("pl_thumb").src=planImg(p); $("planMsg").textContent=""; $("planEditor").scrollIntoView({behavior:"smooth"}); }
  async function savePlan(){ var row={name:$("pl_name").value.trim(),description:$("pl_desc").value||null,price_cents:Math.round(parseFloat($("pl_price").value||"0")*100),interval:$("pl_interval").value,kind:$("pl_kind").value,active:$("pl_active").checked,updated_at:new Date().toISOString()}; if(plansHaveImageCol&&$("pl_image")) row.image_url=$("pl_image").value||null; var res=await sb.from("plans").update(row).eq("id",$("pl_id").value); if(res.error) throw res.error; await sb.from("admin_log").insert({actor_email:session.user.email,action:"plan_update",detail:row}); await audit("admin.plan_update","financial",{severity:"notice",compliance:"financial",subject:row.name,detail:{price_cents:row.price_cents}}); }
  $("planSave").onclick=async function(){ $("planMsg").textContent="Saving\u2026"; try{ await savePlan(); $("planMsg").innerHTML='<span style="color:var(--green)">Saved.</span>'; loadPlans(); }catch(e){ $("planMsg").innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>'; } };
  $("planSync").onclick=async function(){ $("planMsg").textContent="Saving + syncing\u2026"; try{ await savePlan(); var d=await authFetchFn("plans-sync",{plan_id:$("pl_id").value}); $("planMsg").innerHTML=d.ok?'<span style="color:var(--green)">Synced to Stripe.</span>':'<span style="color:var(--red)">'+esc(d.error||"sync failed")+'</span>'; loadPlans(); }catch(e){ $("planMsg").innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>'; } };
  $("planCancel").onclick=function(){ $("planEditor").classList.add("hide"); };

  // ===== STAFF =====
  async function sendInvite(email,role){
    // server-side invite (service role) — works even when public sign-ups are disabled
    try{
      var res=await fetch(FUNCTIONS+"/invite",{method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"Content-Type":"application/json"},body:JSON.stringify({email:email,role:role||"gate",redirect:location.href.split("#")[0].split("?")[0]})});
      var d=await res.json().catch(function(){return{}});
      if(res.ok&&d.ok) return {error:null,note:d.note};
      if(d&&d.error) return {error:{message:d.error}};
    }catch(e){}
    // fallback: client OTP (creates the user only if public sign-ups are enabled)
    var redirect=location.href.split("#")[0].split("?")[0];
    var tmp=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    return await tmp.auth.signInWithOtp({email:email,options:{shouldCreateUser:true,emailRedirectTo:redirect}});
  }
  async function loadStaff(){
    var r=await sb.from("staff").select("*").order("role"); var rows=r.data||[];
    $("staffBody").innerHTML=rows.map(function(s){var you=s.email.toLowerCase()===session.user.email.toLowerCase();return '<tr><td>'+esc(s.email)+'</td><td><span class="pill '+(s.role==="owner"?"active":"")+'">'+esc(s.role)+'</span></td><td style="white-space:nowrap"><button class="mini st-invite" data-email="'+esc(s.email)+'" data-role="'+esc(s.role)+'">Send link</button>'+(you?'':' <button class="mini danger st-del" data-email="'+esc(s.email)+'">Remove</button>')+'</td></tr>'}).join("");
    document.querySelectorAll(".st-del").forEach(function(b){ b.onclick=async function(){ await sb.from("staff").delete().eq("email",b.dataset.email); await sb.from("admin_log").insert({actor_email:session.user.email,action:"staff_remove",detail:{email:b.dataset.email}}); await audit("admin.staff_remove","admin",{severity:"warning",compliance:"access_control",subject:b.dataset.email}); loadStaff(); }; });
    document.querySelectorAll(".st-invite").forEach(function(b){ b.onclick=async function(){ b.disabled=true; var t=b.textContent; b.textContent="\u2026"; try{ var r=await sendInvite(b.dataset.email,b.dataset.role); $("stMsg").innerHTML=r.error?'<span style="color:var(--red)">'+esc(r.error.message)+'</span>':'<span style="color:var(--green)">'+esc(r.note||"Login link sent to "+b.dataset.email)+'.</span>'; }catch(e){ $("stMsg").innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>'; } b.disabled=false; b.textContent=t; }; });
  }
  $("stAdd").onclick=async function(){
    var email=$("st_email").value.trim().toLowerCase(); if(!email) return;
    var role=$("st_role").value; $("stMsg").textContent="Creating\u2026";
    var res=await sb.from("staff").upsert({email:email,role:role},{onConflict:"email"});
    if(res.error){ $("stMsg").innerHTML='<span style="color:var(--red)">'+esc(res.error.message)+'</span>'; return; }
    var invited=false, note="";
    if($("st_invite").checked){ try{ var r=await sendInvite(email,role); invited=!r.error; note=r.error?r.error.message:(r.note||""); }catch(e){ note=e.message; } }
    await sb.from("admin_log").insert({actor_email:session.user.email,action:"staff_add",detail:{email:email,role:role,invited:invited}}); await audit("admin.staff_add","admin",{severity:"notice",compliance:"access_control",subject:email,detail:{role:role,invited:invited}});
    $("st_email").value="";
    $("stMsg").innerHTML=invited?'<span style="color:var(--green)">Created '+esc(email)+' ('+esc(role)+') and sent a login link.</span>':'<span style="color:var(--green)">Added '+esc(email)+' ('+esc(role)+').</span>'+(note?' <span class="muted small">Invite: '+esc(note)+'</span>':'');
    loadStaff();
  };

  // ===== BACK OFFICE: shared =====
  async function officeFetch(action,body){ var r=await fetch(FUNCTIONS+"/office",{method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"Content-Type":"application/json"},body:JSON.stringify(Object.assign({action:action},body||{}))}); return r.json(); }
  function money(c){ return "$"+Math.round((c||0)/100).toLocaleString(); }
  function ymd(d){ return d? new Date(d).toISOString().slice(0,10):""; }
  function tlDate(d){ return d? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):""; }

  // ===== MEMBERS =====
  function memberBack(){ $("memberDetail").classList.add("hide"); $("memberList").classList.remove("hide"); }
  async function loadMembers(){
    memberBack();
    var q=$("memQ").value.trim();
    var mem=(await sb.from("memberships").select("*")).data||[];
    var pass=(await sb.from("passes").select("email,name:holder_name,product")).data||[];
    var by={};
    mem.forEach(function(m){ var e=m.email; if(!e)return; by[e]=by[e]||{email:e,name:m.name,holds:[],status:"guest"}; by[e].holds.push(prod(m.product)); if(m.status==="active")by[e].status="active"; else if(by[e].status!=="active")by[e].status=m.status; });
    pass.forEach(function(p){ var e=p.email; if(!e)return; by[e]=by[e]||{email:e,name:p.name,holds:[],status:"guest"}; if(!by[e].name)by[e].name=p.name; if(by[e].holds.indexOf(prod(p.product))<0)by[e].holds.push(prod(p.product)); });
    var list=Object.values(by);
    if(q){ var ql=q.toLowerCase(); list=list.filter(function(m){return (m.email||"").toLowerCase().indexOf(ql)>=0||(m.name||"").toLowerCase().indexOf(ql)>=0}); }
    list.sort(function(a,b){return (a.name||a.email||"").localeCompare(b.name||b.email||"")});
    $("memBody").innerHTML=list.length?list.slice(0,200).map(function(m){
      return '<tr style="cursor:pointer" data-mem="'+esc(m.email)+'"><td><b>'+esc(m.name||m.email)+'</b><div class="small muted">'+esc(m.email)+'</div></td><td class="small">'+esc(m.holds.join(", ")||"—")+'</td><td><span class="pill '+esc(m.status)+'">'+esc(m.status)+'</span></td></tr>';
    }).join(""):'<tr><td colspan="3" class="muted small">No members found.</td></tr>';
    document.querySelectorAll('[data-mem]').forEach(function(r){ r.onclick=function(){ openMember(r.dataset.mem); }; });
  }
  $("memSearch").onclick=loadMembers;
  $("memQ").addEventListener("keydown",function(e){if(e.key==="Enter")loadMembers()});

  async function openMember(email){
    audit("data.member_view","data_access",{compliance:"pii",subject:email});
    $("memberList").classList.add("hide");
    var d=$("memberDetail"); d.classList.remove("hide"); d.innerHTML='<div class="card"><span class="muted small">Loading member\u2026</span></div>';
    var mem=(await sb.from("memberships").select(MEMB_SEL).eq("email",email)).data||[];
    var pass=(await sb.from("passes").select(PASSES_SEL).eq("email",email)).data||[];
    var office=await officeFetch("member",{email:email}).catch(function(){return{}});
    var bk=(await sb.from("bookings").select("*").eq("email",email)).data||[];
    var name=(mem[0]&&mem[0].name)||(pass[0]&&pass[0].name)||email;
    var activeMem=mem.filter(function(m){return m.status==="active"});
    var tier=(activeMem[0]&&prod(activeMem[0].product))||(mem[0]&&prod(mem[0].product))||"Guest";
    var payLine=office&&office.subscription? (office.subscription.status==="active"?"Paid \u00b7 "+money(office.subscription.monthly_cents)+"/mo equiv":office.subscription.status) : "";
    // timeline
    var ev=[];
    mem.forEach(function(m){ if(m.created_at) ev.push({t:m.created_at,tt:"Joined \u2014 "+prod(m.product),td:"Membership \u00b7 "+m.status}); });
    pass.forEach(function(p){ if(p.created_at) ev.push({t:p.created_at,tt:"Issued \u2014 "+prod(p.product),td:(p.single_use?"Ticket/pass":"Pass")+(p.pass_id?" \u00b7 "+p.pass_id:"")}); if(p.redeemed_at) ev.push({t:p.redeemed_at,tt:"Checked in \u2014 "+prod(p.product),td:"by "+(p.redeemed_by||"gate")}); });
    if(office&&office.payments) office.payments.forEach(function(p){ ev.push({t:new Date(p.created*1000).toISOString(),tt:(p.status==="succeeded"?"Payment":"Payment "+p.status)+" \u2014 "+money(p.amount),td:p.desc||"Stripe"}); });
    if(office&&office.since) ev.push({t:new Date(office.since*1000).toISOString(),tt:"Customer since",td:"Stripe account created"});
    bk.forEach(function(b){ if(b.booking_date) ev.push({t:b.booking_date,tt:bkLabel(b.kind)+" \u2014 "+(b.resource||""),td:b.status+(b.time_slot?" \u00b7 "+b.time_slot:"")}); });
    ev.sort(function(a,b){return new Date(b.t)-new Date(a.t)});
    var tl=ev.length?ev.map(function(e){return '<div class="tl"><div class="tt">'+esc(e.tt)+'</div><div class="td">'+tlDate(e.t)+(e.td?" \u00b7 "+esc(e.td):"")+'</div></div>'}).join(""):'<div class="muted small">No recorded activity yet.</div>';
    var holds=mem.map(function(m){return '<div class="hold"><div class="h-l"><div class="h-t">'+esc(prod(m.product))+'</div><div class="h-s">Membership'+(m.current_period_end?" \u00b7 renews "+tlDate(m.current_period_end):"")+'</div></div><span class="pill '+esc(m.status)+'">'+esc(m.status)+'</span></div>'}).join("")
      +pass.map(function(p){var used=!!p.redeemed_at,st=p.status==="canceled"?"canceled":(used?"redeemed":"active");return '<div class="hold"><div class="h-l"><div class="h-t">'+esc(prod(p.product))+'</div><div class="h-s">'+esc(p.pass_id||"")+'</div></div><span class="pill '+st+'">'+st+'</span></div>'}).join("");
    d.innerHTML='<button class="backbtn mt" id="memBack">\u2039 All members</button>'
      +'<div class="mdcard mt"><div class="mdhead"><div class="nm">'+esc(name)+'</div><div class="sub">'+esc(email)+(payLine?" \u00b7 "+esc(payLine):"")+'</div></div>'
      +'<div style="padding:16px"><div class="eyebrow">Current standing</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:22px;color:var(--deep);margin:2px 0 8px">'+esc(tier)+'</div>'
      +'<div class="holds" style="border-top:1px solid var(--line)">'+(holds||'<div class="vmsg muted">No holdings.</div>')+'</div></div></div>'
      +'<div class="card mt"><h4>Timeline</h4><div class="timeline">'+tl+'</div></div>';
    $("memBack").onclick=function(){ $("memberDetail").classList.add("hide"); $("memberList").classList.remove("hide"); };
  }

  // ===== ANALYTICS =====
  async function loadAnalytics(){
    $("anStats").innerHTML='<div class="stat"><div class="k">Loading live financials\u2026</div></div>';
    var o=await officeFetch("overview").catch(function(){return{error:"unreachable"}});
    if(o&&!o.error){
      $("anStats").innerHTML=
        '<div class="stat"><div class="k">Monthly recurring</div><div class="v">'+money(o.mrr_cents)+'</div></div>'
       +'<div class="stat"><div class="k">Active subscriptions</div><div class="v">'+(o.active_subscriptions||0)+'</div></div>'
       +'<div class="stat"><div class="k">Revenue · 30 days</div><div class="v">'+money(o.revenue_30d_cents)+'</div></div>'
       +'<div class="stat"><div class="k">Failed charges · 30d</div><div class="v" style="color:'+(o.failed_charges_30d?"var(--red)":"var(--deep)")+'">'+(o.failed_charges_30d||0)+'</div></div>';
      $("anPayments").innerHTML=(o.recent_payments&&o.recent_payments.length)?'<table><thead><tr><th>Date</th><th>Who</th><th>Amount</th><th>Status</th></tr></thead><tbody>'+o.recent_payments.map(function(p){return '<tr><td class="small">'+tlDate(new Date(p.created*1000))+'</td><td class="small">'+esc(p.email||"")+'</td><td>'+money(p.amount)+'</td><td>'+(p.status==="succeeded"?'<span class="pill active">paid</span>':'<span class="pill past_due">'+esc(p.status)+'</span>')+'</td></tr>'}).join("")+'</tbody></table>':'<span class="muted small">No recent payments.</span>';
    } else {
      $("anStats").innerHTML='<div class="stat"><div class="k">Live financials unavailable</div><div class="small muted" style="margin-top:6px">Deploy the <b>office</b> function to enable Stripe revenue. Operational metrics below still work.</div></div>';
      $("anPayments").innerHTML='<span class="muted small">Requires the office function.</span>';
    }
    // DB-based: growth, churn, product, events
    var mem=(await sb.from("memberships").select("product,status,created_at:updated_at")).data||[];
    var byMonth={}; mem.forEach(function(m){ if(!m.created_at)return; var k=String(m.created_at).slice(0,7); byMonth[k]=(byMonth[k]||0)+1; });
    var months=Object.keys(byMonth).sort(); var max=Math.max(1,...months.map(function(k){return byMonth[k]}));
    $("anGrowth").innerHTML=months.length?months.map(function(k){var w=Math.round(byMonth[k]/max*100);return '<div class="bar"><span class="bl">'+k+'</span><span class="bt" style="width:'+w+'%"></span><span class="bv">'+byMonth[k]+'</span></div>'}).join(""):'<span class="muted small">No membership history yet.</span>';
    var act=mem.filter(function(m){return m.status==="active"}).length, can=mem.filter(function(m){return m.status==="canceled"}).length, pd=mem.filter(function(m){return m.status==="past_due"}).length;
    var churn=(act+can)?Math.round(can/(act+can)*100):0;
    $("anChurn").innerHTML='<div class="row" style="gap:20px"><div><div class="v" style="font-family:\'Cormorant Garamond\',serif;font-size:2rem;color:var(--deep)">'+act+'</div><div class="small muted">active</div></div><div><div class="v" style="font-family:\'Cormorant Garamond\',serif;font-size:2rem;color:var(--red)">'+can+'</div><div class="small muted">canceled</div></div><div><div class="v" style="font-family:\'Cormorant Garamond\',serif;font-size:2rem;color:var(--amber)">'+pd+'</div><div class="small muted">past due</div></div></div><div class="small muted mt">Lifetime churn: '+churn+'%</div>';
    var by={}; mem.forEach(function(m){by[m.product]=by[m.product]||{a:0,c:0};if(m.status==="active")by[m.product].a++;else by[m.product].c++});
    var keys=Object.keys(by).sort();
    $("anProduct").innerHTML=keys.length?'<table><thead><tr><th>Product</th><th>Active</th><th>Inactive</th></tr></thead><tbody>'+keys.map(function(k){return '<tr><td>'+esc(prod(k))+'</td><td>'+by[k].a+'</td><td class="muted">'+by[k].c+'</td></tr>'}).join("")+'</tbody></table>':'<span class="muted small">No data.</span>';
    // events perf
    var evs=(await sb.from("events").select("id,title,event_date")).data||[];
    var passes=(await sb.from("passes").select("event_name,redeemed_at")).data||[];
    var perf=evs.map(function(e){var ps=passes.filter(function(p){return p.event_name===e.title});var used=ps.filter(function(p){return p.redeemed_at}).length;return {t:e.title,d:e.event_date,sold:ps.length,used:used}}).filter(function(x){return x.sold>0});
    $("anEvents").innerHTML=perf.length?'<table><thead><tr><th>Event</th><th>Sold</th><th>Attended</th><th>Rate</th></tr></thead><tbody>'+perf.map(function(x){return '<tr><td>'+esc(x.t)+'</td><td>'+x.sold+'</td><td>'+x.used+'</td><td>'+Math.round(x.used/x.sold*100)+'%</td></tr>'}).join("")+'</tbody></table>':'<span class="muted small">No ticketed events yet.</span>';
  }

  // ===== EXPORTS =====
  function download(name,text){ var mt=/\.html$/.test(name)?"text/html":"text/csv;charset=utf-8"; var b=new Blob([text],{type:mt}); var u=URL.createObjectURL(b); var a=document.createElement("a"); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); }
  function toCSV(rows,cols){ var esc2=function(v){v=(v==null?"":String(v));return '"'+v.replace(/"/g,'""')+'"'}; return cols.join(",")+"\n"+rows.map(function(r){return cols.map(function(c){return esc2(r[c])}).join(",")}).join("\n"); }
  async function expTable(table,selectStr,outCols,fname){ var r=await sb.from(table).select(selectStr).limit(5000); if(r.error){ alert("Export failed: "+r.error.message); return; } download(fname,toCSV(r.data||[],outCols)); audit("data.export","data_access",{severity:"notice",compliance:"pii",subject:fname}); }
  var eM=$("expMembers"); if(eM) eM.onclick=function(){ expTable("memberships","email,product,status,current_period_end,created_at:updated_at",["email","product","status","current_period_end","created_at"],"north-creek-members.csv"); };
  var eP=$("expPasses"); if(eP) eP.onclick=function(){ expTable("passes","name:holder_name,email,product,pass_id,status,single_use,created_at:issued_at",["name","email","product","pass_id","status","single_use","created_at"],"north-creek-passes.csv"); };
  var eC=$("expCheckins"); if(eC) eC.onclick=async function(){ var r=await sb.from("passes").select("name:holder_name,email,product,pass_id,redeemed_at,redeemed_by").not("redeemed_at","is",null).limit(5000); download("north-creek-checkins.csv",toCSV(r.data||[],["name","email","product","pass_id","redeemed_at","redeemed_by"])); };
  var eE=$("expEvents"); if(eE) eE.onclick=function(){ expTable("events","title,event_date,time_label,location,category,label,status",["title","event_date","time_label","location","category","label","status"],"north-creek-events.csv"); };

  var gR=$("genReport"); if(gR) gR.onclick=async function(){
    gR.disabled=true; gR.textContent="Building\u2026";
    var o=await officeFetch("overview").catch(function(){return{}});
    var mem=(await sb.from("memberships").select("product,status")).data||[];
    var act=mem.filter(function(m){return m.status==="active"}).length, can=mem.filter(function(m){return m.status==="canceled"}).length;
    var passes=(await sb.from("passes").select("pass_id,redeemed_at,single_use")).data||[];
    var checkins=passes.filter(function(p){return p.single_use&&p.redeemed_at}).length;
    var d=new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
    var mrr=(o.mrr_cents!=null?money(o.mrr_cents):"\u2014"), r30=(o.revenue_30d_cents!=null?money(o.revenue_30d_cents):"\u2014"), fc=(o.failed_charges_30d!=null?o.failed_charges_30d:"\u2014");
    var H=[];
    H.push("<!doctype html><html><head><meta charset=utf-8><title>North Creek Board Report</title>");
    H.push("<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;color:#111;padding:0 20px}");
    H.push("h1{color:#004400;font-size:30px;margin:0}.eb{letter-spacing:.2em;text-transform:uppercase;font-size:11px;color:#C5A258;font-weight:bold}");
    H.push(".g{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:24px 0}.s{border:1px solid #e3ddce;border-left:3px solid #C5A258;padding:14px 16px}");
    H.push(".s .k{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#666}.s .v{font-size:30px;color:#004400}");
    H.push(".foot{border-top:1px solid #C5A258;margin-top:30px;padding-top:12px;color:#888;font-size:12px}</style></head><body>");
    H.push('<div class=eb>The North Creek Estate</div><h1>Board Report</h1><div style="color:#666;margin-top:4px">'+d+"</div>");
    H.push("<div class=g>");
    H.push('<div class=s><div class=k>Monthly recurring revenue</div><div class=v>'+mrr+"</div></div>");
    H.push('<div class=s><div class=k>Revenue - last 30 days</div><div class=v>'+r30+"</div></div>");
    H.push('<div class=s><div class=k>Active members</div><div class=v>'+act+"</div></div>");
    H.push('<div class=s><div class=k>Canceled (lifetime)</div><div class=v>'+can+"</div></div>");
    H.push('<div class=s><div class=k>Event check-ins</div><div class=v>'+checkins+"</div></div>");
    H.push('<div class=s><div class=k>Failed charges - 30d</div><div class=v>'+fc+"</div></div>");
    H.push("</div><p style=\"color:#444\">Prepared automatically from live estate operations and Stripe.</p>");
    H.push('<div class=foot>The North Creek Estate - Southaven, Mississippi - Generated '+d+" - Confidential</div>");
    H.push("</body></html>");
    download("north-creek-board-report.html", H.join("\n"));
    gR.disabled=false; gR.textContent="Generate board report";
  }

  // ===== BOOKINGS =====
  function bkLabel(k){return {range:"Range bay",space:"Venue space",tour:"Tour"}[k]||k}
  async function loadBookings(){
    var kind=$("bkKind").value, st=$("bkStatus").value;
    var q=sb.from("bookings").select("*").order("booking_date",{ascending:false}).limit(500);
    if(kind) q=q.eq("kind",kind); if(st) q=q.eq("status",st);
    var r=await q; var rows=r.data||[];
    $("bkBody").innerHTML=rows.length?rows.map(function(b){
      return '<tr><td class="small">'+tlDate(b.booking_date)+'<div class="muted" style="font-size:11px">'+esc(b.time_slot||"")+'</div></td>'
        +'<td>'+esc(b.resource||bkLabel(b.kind))+'<div class="small muted">'+esc(bkLabel(b.kind))+(b.party_size?" · "+b.party_size+" guests":"")+'</div></td>'
        +'<td class="small">'+esc(b.name||b.email||"")+'</td>'
        +'<td><span class="pill '+(b.status==="confirmed"||b.status==="completed"?"active":b.status==="canceled"?"canceled":"")+'">'+esc(b.status)+'</span></td>'
        +'<td><button class="mini bk-edit" data-id="'+esc(b.id)+'">Open</button></td></tr>';
    }).join(""):'<tr><td colspan="5" class="muted small">No bookings.</td></tr>';
    var map={}; rows.forEach(function(b){map[b.id]=b});
    document.querySelectorAll(".bk-edit").forEach(function(x){ x.onclick=function(){ openBooking(map[x.dataset.id]); }; });
  }
  function openBooking(b){
    b=b||{}; $("bkEditor").classList.remove("hide"); $("bkEditTitle").textContent=b.id?"Edit booking":"New booking";
    $("bk_id").value=b.id||""; $("bk_kind").value=b.kind||"range"; $("bk_resource").value=b.resource||""; $("bk_name").value=b.name||""; $("bk_email").value=b.email||"";
    $("bk_date").value=b.booking_date||""; $("bk_time").value=b.time_slot||""; $("bk_party").value=b.party_size||""; $("bk_amount").value=b.amount_cents?(b.amount_cents/100).toFixed(2):""; $("bk_status").value=b.status||"requested"; $("bk_notes").value=b.notes||"";
    $("bkMsg").textContent=""; $("bkEditor").scrollIntoView({behavior:"smooth"});
  }
  $("bkRefresh").onclick=loadBookings;
  $("bkKind").onchange=loadBookings; $("bkStatus").onchange=loadBookings;
  $("bkNew").onclick=function(){ openBooking({}); };
  $("bkCancel").onclick=function(){ $("bkEditor").classList.add("hide"); };
  $("bkSave").onclick=async function(){
    $("bkMsg").textContent="Saving\u2026";
    var row={kind:$("bk_kind").value,resource:$("bk_resource").value||null,name:$("bk_name").value||null,email:($("bk_email").value||"").toLowerCase()||null,
      booking_date:$("bk_date").value||null,time_slot:$("bk_time").value||null,party_size:parseInt($("bk_party").value||"0")||null,
      amount_cents:Math.round(parseFloat($("bk_amount").value||"0")*100),status:$("bk_status").value,notes:$("bk_notes").value||null};
    var id=$("bk_id").value;
    var res=id? await sb.from("bookings").update(row).eq("id",id) : await sb.from("bookings").insert(row);
    if(res.error){ $("bkMsg").innerHTML='<span style="color:var(--red)">'+esc(res.error.message)+'</span>'; return; }
    await sb.from("admin_log").insert({actor_email:session.user.email,action:id?"booking_update":"booking_create",detail:row});
    $("bkMsg").innerHTML='<span style="color:var(--green)">Saved.</span>'; $("bkEditor").classList.add("hide"); loadBookings();
  };
  $("bkDelete").onclick=async function(){ var id=$("bk_id").value; if(!id) return; await sb.from("bookings").delete().eq("id",id); $("bkEditor").classList.add("hide"); loadBookings(); };

  // ===== SECURITY & AUDIT (tamper-evident, hash-chained) =====
  function sevPill(s){ var c=s==="critical"||s==="warning"?"canceled":(s==="notice"?"":"active"); return '<span class="pill '+c+'">'+esc(s||"info")+'</span>'; }
  function evLabel(t){ return (t||"").replace(/[._]/g," "); }
  async function loadScanLog(){
    var cat=$("auCat")?$("auCat").value:"", sev=$("auSev")?$("auSev").value:"";
    var q=sb.from("audit_log").select("*").order("id",{ascending:false}).limit(400);
    if(cat) q=q.eq("category",cat); if(sev) q=q.eq("severity",sev);
    var r=await q; var rows=r.data||[];
    $("scanBody").innerHTML=rows.length?rows.map(function(s){
      var loc=(s.lat!=null&&s.lng!=null)?'<a href="https://maps.google.com/?q='+s.lat+','+s.lng+'" target="_blank" rel="noopener">'+Number(s.lat).toFixed(3)+', '+Number(s.lng).toFixed(3)+'</a>':'<span class="muted">\u2014</span>';
      var when=new Date(s.ts); var wl=when.toLocaleDateString("en-US",{month:"short",day:"numeric"})+" "+when.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
      var ev=evLabel(s.event_type)+(s.compliance?' <span class="pill" style="border-color:var(--purple);color:var(--purple)">'+esc(s.compliance)+'</span>':'');
      return '<tr><td class="small">'+wl+'</td><td class="small">'+ev+'</td><td>'+sevPill(s.severity)+'</td><td class="small">'+esc(s.actor_email||"")+'</td><td class="small">'+esc(s.subject||"\u2014")+'</td><td class="small">'+loc+'</td></tr>';
    }).join(""):'<tr><td colspan="6" class="muted small">No audit entries yet. Security events will appear here.</td></tr>';
  }
  var sr=$("scanRefresh"); if(sr) sr.onclick=loadScanLog;
  var acf=$("auCat"); if(acf) acf.onchange=loadScanLog;
  var asf=$("auSev"); if(asf) asf.onchange=loadScanLog;
  var iv=$("intVerify"); if(iv) iv.onclick=async function(){
    iv.disabled=true; var st=$("intStatus"); st.textContent="Verifying\u2026"; st.style.color="var(--muted)";
    try{
      var r=await sb.rpc("verify_audit_chain"); var d=(r.data&&r.data[0])||r.data||{};
      if(r.error) throw r.error;
      if(d.intact){ st.innerHTML='\u2713 Chain intact \u2014 '+d.entries+' entries verified'; st.style.color="var(--green)"; }
      else { st.innerHTML='\u2717 Chain BROKEN at entry #'+d.broken_at+' \u2014 tampering detected'; st.style.color="var(--red)"; }
    }catch(e){ st.textContent="Verification unavailable: "+(e.message||e); st.style.color="var(--red)"; }
    iv.disabled=false;
  };

  sb.auth.onAuthStateChange(function(){ refresh(); });
  refresh();
})();
