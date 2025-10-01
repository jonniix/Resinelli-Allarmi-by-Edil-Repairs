// src/index.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      // Pagina di salute/miniguida
      return new Response(
        `OK – WHEP proxy.
Config:
- WHEP_BASE=${env.WHEP_BASE || "(unset)"}
- WHEP_URL=${env.WHEP_URL || "(unset)"}
- STREAM_ID=${env.STREAM_ID ? "(set)" : "(unset)"}
- STREAM_PASS=${env.STREAM_PASS ? "(set)" : "(unset)"}

Usa POST /whep con Content-Type: application/sdp`,
        { headers: corsHeaders(request) }
      );
    }

    if (url.pathname === "/whep") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request, true) });
      }

      if (request.method !== "POST") {
        return new Response("Not Found", { status: 404, headers: corsHeaders(request) });
      }

      // --- Costruisci URL WHEP finale ---
      const base = env.WHEP_BASE || "https://screenstream.io/whep";
      const final = env.WHEP_URL || `${base.replace(/\/$/, "")}/${env.STREAM_ID || ""}`;

      if (!final || /\/$/.test(final)) {
        return new Response("WHEP_URL non configurato", { status: 500, headers: corsHeaders(request) });
      }

      // Header Authorization: usa prima ENV, altrimenti passa l’Authorization del client se presente
      let authHeader = null;
      if (env.STREAM_ID || env.STREAM_PASS) {
        const token = btoa(`${env.STREAM_ID || ""}:${env.STREAM_PASS || ""}`);
        authHeader = `Basic ${token}`;
      } else {
        const h = request.headers.get("Authorization");
        if (h && /^Basic\s+/i.test(h)) authHeader = h;
      }

      const upstream = await fetch(final, {
        method: "POST",
        body: await request.text(),
        headers: {
          "Content-Type": "application/sdp",
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
      });

      // Propaga la Location se presente (per DELETE successivo)
      const headers = corsHeaders(request);
      const loc = upstream.headers.get("Location");
      if (loc) headers.set("Location", loc);

      return new Response(await upstream.text(), {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    if (url.pathname.startsWith("/whep/") && request.method === "DELETE") {
      // Forward DELETE al resource URL (quando il browser chiude)
      const target = url.toString().replace(request.url, request.url); // no-op, ma lasciamo lo scheletro
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders(request) });
  },
};

function corsHeaders(request, preflight = false) {
  const origin = request.headers.get("Origin") || "*";
  // Autorizza esplicitamente la tua pagina GitHub Pages (va bene anche "*", ma mettiamo l’origin per sicurezza)
  const allowOrigin = /^https:\/\/jonniix\.github\.io$/.test(origin) ? origin : "*";

  const h = new Headers();
  h.set("Access-Control-Allow-Origin", allowOrigin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (preflight) h.set("Access-Control-Max-Age", "86400");
  return h;
}
