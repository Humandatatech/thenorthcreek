/* nc-events.js — renders live events/promos from Supabase into the marketing pages.
 * Home + Seasonal Invitations both include this. If Supabase is unreachable, the
 * server-rendered fallback already in the container stays put (graceful degradation).
 *
 * Usage on a page:
 *   <div data-nc-events="upcoming" data-featured="1" data-limit="2"> ...static fallback... </div>
 *   <div data-nc-events="seasonal"> ...static fallback... </div>
 *   <script src="nc-events.js" defer></script>
 */
(function () {
  var cfg = (window.NC_CONFIG && NC_CONFIG.supabase) || {};
  if (!cfg.url || !cfg.anonKey || !window.supabase) return; // no config/lib -> keep fallback

  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  function esc(x){return (x==null?"":String(x)).replace(/[<>&"]/g,function(c){return{"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]})}
  function monShort(d){return d?new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short"}):""}
  function dayNum(d){return d?String(new Date(d+"T12:00:00").getDate()):""}
  function longDate(d){return d?new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}):""}

  function icsHref(ev){
    if(!ev.event_date) return null;
    var dt=ev.event_date.replace(/-/g,"");
    var body=["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:"+dt,"SUMMARY:"+(ev.title||"North Creek"),
      "LOCATION:"+((ev.location||"")+" — The North Creek Estate"),
      "DESCRIPTION:"+((ev.blurb||"").replace(/\n/g," ")),"END:VEVENT","END:VCALENDAR"].join("\r\n");
    return "data:text/calendar;charset=utf8,"+encodeURIComponent(body);
  }

  // Home-style compact row
  function upcomingCard(ev){
    var ics=icsHref(ev);
    var meta=[ev.time_label,ev.location,ev.price_label].filter(Boolean).join(" \u00b7 ");
    var cta = ev.ticket_url ? '<a class="lk" href="'+esc(ev.ticket_url)+'">Get tickets <span class="arr">&rarr;</span></a>'
                            : '<a class="lk" href="seasonal-invitations.html">Details <span class="arr">&rarr;</span></a>';
    return '<article class="event"><div class="event__date"><div class="mo">'+esc(monShort(ev.event_date))+'</div><div class="day">'+esc(dayNum(ev.event_date))+'</div></div>'
      +'<div><h3>'+esc(ev.title)+'</h3><p>'+esc(ev.blurb||"")+'</p>'
      +'<div class="event__meta">'+esc(meta)+'</div>'+cta
      +(ics?' &nbsp; <a class="lk" href="'+ics+'" download="'+esc(ev.title)+'.ics">+ Add to calendar</a>':'')
      +'</div></article>';
  }

  // Seasonal-style richer card (flyer + ticket + calendar)
  function seasonalCard(ev){
    var ics=icsHref(ev);
    var img = ev.hero_url||ev.flyer_url;
    var when = ev.event_date ? longDate(ev.event_date) : (ev.time_label||"");
    var meta=[ (ev.event_date?ev.time_label:""), ev.location, ev.price_label ].filter(Boolean).join(" \u00b7 ");
    return '<article class="inv-card">'
      + (img?'<a href="'+esc(ev.flyer_url||img)+'" target="_blank" rel="noopener"><img class="inv-card__img" src="'+esc(img)+'" alt="'+esc(ev.title)+'"></a>':'')
      + '<div class="inv-card__b">'
      + (ev.label?'<span class="inv-label">'+esc(ev.label)+'</span>':'')
      + '<span class="k">'+esc(ev.category==="promo"?"Seasonal offer":when)+'</span>'
      + '<h3>'+esc(ev.title)+'</h3><p>'+esc(ev.blurb||"")+'</p>'
      + (meta?'<div class="inv-card__meta">'+esc(meta)+'</div>':'')
      + '<div class="inv-card__cta">'
      + (ev.ticket_url?'<a class="btn btn--outline" href="'+esc(ev.ticket_url)+'">Get Tickets <span class="arr">&rarr;</span></a>':'')
      + (ev.flyer_url?'<a class="lk" href="'+esc(ev.flyer_url)+'" target="_blank" rel="noopener">Flyer</a>':'')
      + (ics?'<a class="lk" href="'+ics+'" download="'+esc(ev.title)+'.ics">+ Calendar</a>':'')
      + '</div></div></article>';
  }

  async function fill(el){
    var mode=el.getAttribute("data-nc-events");
    var featured=el.getAttribute("data-featured")==="1";
    var limit=parseInt(el.getAttribute("data-limit")||"0",10);
    var q=sb.from("events").select("*").eq("status","published");
    if(featured) q=q.eq("featured",true);
    // order: dated first (soonest), then undated promos
    var r=await q;
    if(r.error||!r.data){ return; } // keep fallback
    var rows=r.data.slice().sort(function(a,b){
      if(a.event_date&&b.event_date) return a.event_date<b.event_date?-1:1;
      if(a.event_date) return -1; if(b.event_date) return 1; return (a.sort||0)-(b.sort||0);
    });
    if(limit>0) rows=rows.slice(0,limit);
    if(!rows.length) return; // nothing published -> keep fallback
    el.innerHTML = rows.map(mode==="upcoming"?upcomingCard:seasonalCard).join("");
  }

  document.querySelectorAll("[data-nc-events]").forEach(fill);
})();
