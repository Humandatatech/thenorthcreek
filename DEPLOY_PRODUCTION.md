# North Creek — Production Deploy to GoDaddy (thenorthcreek.com)

This is a static site (HTML + a little JS). No build step. You upload files into the
GoDaddy document root and the site is live.

---

## 0. One blocker to clear BEFORE launch

**Live Stripe links.** `config.js` ships with checkout **enabled** but every payment link
**blank** — so buttons safely fall back to normal on-page navigation and *cannot* reach
Stripe until you paste real links. See step 3. Nothing charges until then.

The photography (`image/` folder) **is present** and every image the pages reference exists
on disk — verified. One caveat: `image/North Creek Estate P1.mp4` (895 MB) is **not
referenced by any page**; skip it when uploading (it's git-ignored). Without it the `image/`
payload is ~119 MB.

---

## 1. What to upload (into the document root)

For a primary domain, GoDaddy's document root is usually `public_html/`. If thenorthcreek.com
is an **add-on / secondary** domain, it's the folder cPanel assigned to it (often
`public_html/thenorthcreek.com/`). Upload **into that folder** (not a subfolder):

**Upload these:**
- All `*.html` files
- `config.js`, `admin.js`, `nc-events.js`, `gallery.js`
- `.htaccess`   ← may be hidden; in cPanel File Manager enable *Settings → Show Hidden Files*
- `robots.txt`, `sitemap.xml`
- `404.html`
- `favicon.ico`, `apple-touch-icon.png`
- the `image/` folder — **except** `North Creek Estate P1.mp4` (895 MB, unreferenced; skip it)
  - includes `image/web/` — the web-optimized gallery thumbnails/large images (required for the venue carousels)

**Do NOT upload** (internal / unused — the `.htaccess` also blocks the notes if they slip through):
- `DEPLOY.txt`, `DEPLOY_STAGING.txt`, `DEPLOY_PRODUCTION.md`
- `NorthCreek_Email_Previews.html`
- `README.md`, `.gitignore`, `.git/`, `.DS_Store`
- `image/North Creek Estate P1.mp4`

---

## 2. Upload steps (cPanel File Manager)

1. GoDaddy → **My Products → Web Hosting → Manage → cPanel Admin**.
2. Open **File Manager**, go to the document root (see step 1).
3. **Settings → Show Hidden Files (dotfiles)** so `.htaccess` is visible.
4. Upload the files from step 1 (zip them, upload the zip, then **Extract** — fastest).
5. Confirm `index.html` sits directly in the document root (it's the home page).
6. Leave any existing `image/` folder in place if photos are already there — don't overwrite it.

(FTP/SFTP works too — same file set, same destination folder.)

---

## 3. Turn on live checkout (when Stripe is ready)

In `config.js`:

1. In `paymentLinks`, replace each `""` with the matching **LIVE** Payment Link
   (Stripe Dashboard → **Payments → Payment Links**; live URLs are `https://buy.stripe.com/…`
   and contain **no** `test_`).
2. Set `stripe.customerPortalUrl` to your live customer-portal link
   (`https://billing.stripe.com/p/login/…`) so "Manage membership" works.
3. Re-upload `config.js`. (It's set to a 10-minute cache, so changes propagate fast.)
4. Confirm the Supabase payment **webhook** is deployed and tested first — it's what records
   the payment, issues the pass, and sends the email after checkout.

Links you still owe for full go-live:
`estate-pass`, `founding-annual`, `founding-monthly`, `creek-pass`, `range-bucket`,
`ticket-gathering`, `ticket-tunnel-vision`, plus the customer-portal URL.

---

## 4. Post-upload smoke test

- [ ] `https://thenorthcreek.com` loads; hero image shows (not broken).
- [ ] `http://thenorthcreek.com` and `www.thenorthcreek.com` both **redirect to https + bare domain**.
- [ ] Click through the top nav — every page loads, no broken images.
- [ ] Visit a made-up URL (e.g. `/nope`) → branded **404** page appears.
- [ ] `https://thenorthcreek.com/robots.txt` and `/sitemap.xml` load.
- [ ] Favicon (green "NC" disc) shows in the browser tab.
- [ ] A pay button: before live links → goes to its pass/booking page (no Stripe). After
      live links → opens Stripe checkout in **live** mode.
- [ ] `/admin.html` shows the sign-in gate (staff-only; auth enforced by Supabase).

---

## Notes

- The `.htaccess` forces HTTPS, canonicalizes to the bare domain, sets caching + security
  headers, and blocks the internal notes above. If GoDaddy's SSL isn't active yet, the HTTPS
  redirect will loop — activate the free SSL cert in cPanel/GoDaddy first.
- SEO structured data and canonical URLs already point to `https://thenorthcreek.com`.
- `gatherings.html` is an intentional redirect stub to `seasonal-invitations.html`.
