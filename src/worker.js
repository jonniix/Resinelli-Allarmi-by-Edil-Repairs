export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    // Home diagnostica
    if (url.pathname === "/" || url.pathname === "/health") {
      const body = [
        "OK – WHEP proxy.",
        "Config:",
        `- WHEP_BASE=${env.WHEP_BASE || "(unset)"}`,
        `- WHEP_URL=${env.WHEP_URL || "(unset)"}`,
        `- STREAM_ID=${env.STREAM_ID ? "(set)" : "(unset)"}`,
        `- STREAM_PASS=${env.STREAM_PASS ? "(set)" : "(unset)"}`,
        "",
        "Usa POST /whep con Content-Type: application/sdp"
      ].join("\n");
      return new Response(body, { headers: corsHeadersText() });
    }

    // Endpoint WHEP
    if (url.pathname === "/whep") {
      if (req.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: corsHeaders()
        });
      }

      // corpo SDP dall’offer del browser
      const sdpOffer = await req.text();
      if (!sdpOffer || !/v=0/.test(sdpOffer)) {
        return new Response("Bad SDP", { status: 400, headers: corsHeaders() });
      }

      // 1) Determina endpoint upstream
      //    Preferisci WHEP_URL (es. https://screenstream.io/whep/72500366).
      let upstream = env.WHEP_URL;
      if (!upstream) {
        if (!env.WHEP_BASE || !env.STREAM_ID) {
          return new Response("Misconfig: WHEP_URL o (WHEP_BASE + STREAM_ID) richiesti", {
            status: 500,
            headers: corsHeaders()
          });
        }
        upstream = `${trimSlash(env.WHEP_BASE)}/${encodeURIComponent(env.STREAM_ID)}`;
      }

      // 2) Prepara Authorization: Basic
      //    - se il client manda Authorization, usala (override)
      //    - altrimenti usa le secret STREAM_ID/STREAM_PASS
      const clientAuth = req.headers.get("authorization");
      const basic = clientAuth || basicFrom(env.STREAM_ID, env.STREAM_PASS);

      // 3) Per WAF pignoli: scrivi anche user:pass nell’URL
      try {
        const u = new URL(upstream);
        if (!clientAuth && env.STREAM_ID) u.username = env.STREAM_ID;
        if (!clientAuth && env.STREAM_PASS) u.password = env.STREAM_PASS;
        upstream = u.toString();
      } catch (_) { /* lascia com’è */ }

      // 4) Header per upstream
      const fHeaders = new Headers({
        "Content-Type": "application/sdp",
        "Accept": "application/sdp",
        "User-Agent": "ResinelliWHEP/1.0"
      });
      // Propaga Origin del client (alcuni server lo guardano)
      const origin = req.headers.get("origin");
      if (origin) fHeaders.set("Origin", origin);
      if (basic) fHeaders.set("Authorization", basic);

      // 5) Chiama l’upstream WHEP
      let up;
      try {
        up = await fetch(upstream, {
          method: "POST",
          headers: fHeaders,
          body: sdpOffer
        });
      } catch (e) {
        return new Response("Upstream non raggiungibile", {
          status: 502,
          headers: corsHeaders()
        });
      }

      // 6) Se 4xx, logga un estratto utile
      if (!up.ok) {
        let snippet = "";
        try { snippet = (await up.text() || "").slice(0, 200); } catch {}
        const msg = `WHEP upstream error: ${up.status} ${up.statusText}${snippet ? " – " + snippet : ""}`;
        // log server-side
        console.warn(msg);
        return new Response(msg, {
          status: up.status,
          headers: corsHeaders()
        });
      }

      // 7) Passa giù l’answer SDP + Location (se presente)
      const answer = await up.text();
      const resHeaders = corsHeaders();
      resHeaders.set("Content-Type", "application/sdp");

      // molti server WHEP rispondono 201 e mettono Location alla risorsa
      const loc = up.headers.get("Location");
      if (loc) resHeaders.set("Location", loc);

      // Mantieni 200 (ok) o 201 (created) dell’upstream
      const status = up.status === 201 ? 201 : 200;
      return new Response(answer, { status, headers: resHeaders });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  }
};

// Helpers
function corsHeaders() {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Expose-Headers": "Location",
    "Cache-Control": "no-store"
  });
}
function corsHeadersText() {
  const h = corsHeaders();
  h.set("Content-Type", "text/plain; charset=utf-8");
  return h;
}
function basicFrom(user, pass) {
  if (!user && !pass) return "";
  const token = btoa(`${user || ""}:${pass || ""}`);
  return `Basic ${token}`;
}
function trimSlash(s) {
  return s.replace(/\/+$/, "");
}
