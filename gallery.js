/* THE NORTH CREEK — gallery lightbox / carousel
 * Any element with class "thumbs" becomes a gallery. Each child ".plate" that has a
 * data-full attribute becomes a slide (data-full = large image, data-alt = caption).
 * Clicking a plate opens a full-screen carousel starting on that image.
 * Controls: ← / → arrows, Esc to close, backdrop click, dots, touch swipe.
 * Self-contained: injects its own CSS, no dependencies.
 */
(function () {
  "use strict";
  if (window.__ncGallery) return; window.__ncGallery = true;

  var CSS = ""
    + ".thumbs .plate{cursor:pointer}"
    + ".thumbs .plate img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;transition:transform .6s cubic-bezier(.4,0,.2,1)}"
    + ".thumbs .plate:hover img{transform:scale(1.05)}"
    + ".thumbs .plate:after{content:'';position:absolute;inset:0;background:linear-gradient(to top,rgba(10,36,23,.35),transparent 45%);opacity:0;transition:opacity .3s;pointer-events:none}"
    + ".thumbs .plate:hover:after{opacity:1}"
    + ".thumbs .plate__tag{z-index:2;text-shadow:0 1px 8px rgba(0,0,0,.5)}"
    + ".nclb{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;"
    +   "background:rgba(8,28,18,.95);opacity:0;visibility:hidden;transition:opacity .3s ease;"
    +   "-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}"
    + ".nclb.open{opacity:1;visibility:visible}"
    + ".nclb__stage{position:relative;max-width:94vw;max-height:86vh;display:flex;align-items:center;justify-content:center}"
    + ".nclb__img{max-width:94vw;max-height:80vh;object-fit:contain;box-shadow:0 24px 70px rgba(0,0,0,.5);"
    +   "opacity:0;transition:opacity .35s ease;background:#0a2417}"
    + ".nclb__img.show{opacity:1}"
    + ".nclb__cap{position:absolute;left:0;right:0;bottom:-2.4rem;text-align:center;color:rgba(245,240,230,.85);"
    +   "font-family:Georgia,serif;font-size:.9rem;letter-spacing:.02em}"
    + ".nclb__btn{position:absolute;top:50%;transform:translateY(-50%);width:52px;height:52px;border-radius:50%;"
    +   "border:1px solid rgba(197,162,88,.6);background:rgba(10,36,23,.4);color:#F5F0E6;font-size:22px;line-height:1;"
    +   "cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .25s,border-color .25s;z-index:2}"
    + ".nclb__btn:hover{background:#C5A258;border-color:#C5A258;color:#0a2417}"
    + ".nclb__prev{left:1.2rem}.nclb__next{right:1.2rem}"
    + ".nclb__close{position:fixed;top:1.2rem;right:1.4rem;width:46px;height:46px;border-radius:50%;border:1px solid rgba(245,240,230,.35);"
    +   "background:none;color:#F5F0E6;font-size:24px;cursor:pointer;z-index:3;transition:background .25s,color .25s}"
    + ".nclb__close:hover{background:#C5A258;color:#0a2417;border-color:#C5A258}"
    + ".nclb__count{position:fixed;top:1.5rem;left:1.6rem;color:rgba(245,240,230,.7);font-family:Georgia,serif;"
    +   "font-size:.85rem;letter-spacing:.14em;z-index:3}"
    + ".nclb__dots{position:fixed;left:0;right:0;bottom:1.3rem;display:flex;gap:.55rem;justify-content:center;z-index:3}"
    + ".nclb__dot{width:8px;height:8px;border-radius:50%;border:1px solid rgba(197,162,88,.7);background:none;padding:0;cursor:pointer}"
    + ".nclb__dot.on{background:#C5A258;border-color:#C5A258}"
    + "@media(max-width:600px){.nclb__btn{width:42px;height:42px;font-size:18px}.nclb__prev{left:.5rem}.nclb__next{right:.5rem}}"
    + "@media(prefers-reduced-motion:reduce){.nclb,.nclb__img,.thumbs .plate img{transition:none}}";

  function injectCSS() {
    var st = document.createElement("style"); st.id = "nc-gallery-css";
    st.textContent = CSS; document.head.appendChild(st);
  }

  var box, imgEl, capEl, countEl, dotsWrap, list = [], idx = 0, lastFocus = null;

  function buildBox() {
    box = document.createElement("div");
    box.className = "nclb"; box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Image gallery");
    box.innerHTML =
      '<div class="nclb__count" aria-live="polite"></div>' +
      '<button class="nclb__close" aria-label="Close gallery">&times;</button>' +
      '<button class="nclb__btn nclb__prev" aria-label="Previous image">&#8249;</button>' +
      '<div class="nclb__stage"><img class="nclb__img" alt=""><span class="nclb__cap"></span></div>' +
      '<button class="nclb__btn nclb__next" aria-label="Next image">&#8250;</button>' +
      '<div class="nclb__dots"></div>';
    document.body.appendChild(box);
    imgEl = box.querySelector(".nclb__img");
    capEl = box.querySelector(".nclb__cap");
    countEl = box.querySelector(".nclb__count");
    dotsWrap = box.querySelector(".nclb__dots");
    box.querySelector(".nclb__close").addEventListener("click", close);
    box.querySelector(".nclb__prev").addEventListener("click", function (e) { e.stopPropagation(); go(-1); });
    box.querySelector(".nclb__next").addEventListener("click", function (e) { e.stopPropagation(); go(1); });
    box.addEventListener("click", function (e) { if (e.target === box || e.target.classList.contains("nclb__stage")) close(); });
    // swipe
    var x0 = null;
    box.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1);
      x0 = null;
    }, { passive: true });
  }

  function preload(i) { if (list[i]) { var im = new Image(); im.src = list[i].full; } }

  function show() {
    var item = list[idx];
    imgEl.classList.remove("show");
    var next = new Image();
    next.onload = function () { imgEl.src = item.full; imgEl.alt = item.alt || ""; imgEl.classList.add("show"); };
    next.src = item.full;
    if (item.full === imgEl.currentSrc || imgEl.complete) { imgEl.src = item.full; imgEl.alt = item.alt || ""; requestAnimationFrame(function(){ imgEl.classList.add("show"); }); }
    capEl.textContent = item.alt || "";
    countEl.textContent = (idx + 1) + " / " + list.length;
    Array.prototype.forEach.call(dotsWrap.children, function (d, i) { d.classList.toggle("on", i === idx); });
    preload(idx + 1); preload(idx - 1);
  }

  function go(step) { idx = (idx + step + list.length) % list.length; show(); }

  function open(items, start) {
    list = items; idx = start || 0;
    dotsWrap.innerHTML = "";
    list.forEach(function (_, i) {
      var d = document.createElement("button");
      d.className = "nclb__dot" + (i === idx ? " on" : "");
      d.setAttribute("aria-label", "Go to image " + (i + 1));
      d.addEventListener("click", function (e) { e.stopPropagation(); idx = i; show(); });
      dotsWrap.appendChild(d);
    });
    lastFocus = document.activeElement;
    box.classList.add("open");
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    show();
    box.querySelector(".nclb__next").focus();
  }

  function close() {
    box.classList.remove("open");
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  }

  function wire() {
    injectCSS();
    buildBox();
    document.querySelectorAll(".thumbs").forEach(function (group) {
      var plates = Array.prototype.filter.call(group.querySelectorAll(".plate"), function (p) { return p.getAttribute("data-full"); });
      if (!plates.length) return;
      var items = plates.map(function (p) { return { full: p.getAttribute("data-full"), alt: p.getAttribute("data-alt") || "" }; });
      plates.forEach(function (p, i) {
        p.setAttribute("role", "button");
        p.setAttribute("tabindex", "0");
        p.setAttribute("aria-label", "Open image" + (items[i].alt ? ": " + items[i].alt : ""));
        p.addEventListener("click", function () { open(items, i); });
        p.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(items, i); } });
      });
    });
  }

  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire);
})();
