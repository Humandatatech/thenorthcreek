// ics — serves a calendar file for an estate event so "+ Calendar" works on
// every platform (iOS opens the native Calendar sheet; desktop downloads).
// GET /functions/v1/ics?t=<title>&d=<YYYY-MM-DD>&l=<location>&x=<description>
// Public endpoint; emits only what the caller passes in (no data access).
Deno.serve((req) => {
  const p = new URL(req.url).searchParams;
  const title = (p.get("t") || "North Creek Estate Event").slice(0, 140);
  const date = p.get("d") || "";
  const loc = (p.get("l") || "").slice(0, 140);
  const desc = (p.get("x") || "").slice(0, 500);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response("bad date", { status: 400 });
  }
  const dt = date.replace(/-/g, "");
  // RFC 5545: escape commas/semicolons/newlines in text values
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const uid = `${dt}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}@thenorthcreek.com`;

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The North Creek Estate//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${dt}`,
    `SUMMARY:${esc(title)}`,
    loc ? `LOCATION:${esc(loc + " — The North Creek Estate")}` : "LOCATION:The North Creek Estate",
    desc ? `DESCRIPTION:${esc(desc)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");

  const fname = title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "event";
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${fname}.ics"`,
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
