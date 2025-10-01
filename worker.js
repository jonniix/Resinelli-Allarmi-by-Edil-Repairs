// Cloudflare Worker (Modules) – proxy WHEP con Basic Auth + CORS
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return preflight(request);
    }

    // accettiamo solo /whep (puoi cambiare il prefisso se vuoi)
    if (!url.pathname.startsWith("/whep")) {
      return withCORS(new Response("OK"), request);
    }

    // base upstream es. https://screenstream.io
    const upstreamBase = env.UPSTREAM || "https://screenstream.io";

    // mappa /whep/... -> https://screenstream.io/...
    const upstreamPath = url.pathname.replace(/^\/whep/, "") || "/";
    const target = new URL(upstreamPath, upstreamBase);
    target.search = url.search; // passa le query

    // clona la richiesta
    const headers = new Headers(request.headers);
    // pulizie utili
    headers.delete("cookie");
    headers.delete("Cookie");
    headers.delete("Host");

    // aggiungi Basic Auth dalle env (o in fallback da query ?u=&p=)
    const u = url.searchParams.get("u") ?? env.STREAM_USER ?? "";
    const p = url.searchParams.get("p") ?? env.STREAM_PASS ?? "";
    if (u || p) {
      const token = btoa(`${u}:${p}`);
      headers.set("Authorization", `Basic ${token}`);
    }

    // per negoziazione SDP alcuni server vogliono questi header
    if (request.method === "POST") {
      if (!headers.has("Accept")) headers.set("Accept", "application/sdp, */*;q=0.1");
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/sdp");
    }

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    // copia il body solo se serve
    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = await request.arrayBuffer();
    }

    // inoltra verso l’upstream
    const upstreamRes = await fetch(target, init);

    // rispondi mantenendo lo stream e aggiungendo CORS
    const resp = new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: upstreamRes.headers,
    });
    return withCORS(resp, request);
  },
};

// --- Helpers CORS ---
function preflight(request) {
  const h = new Headers();
  const origin = request.headers.get("Origin") || "*";
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Credentials", "true");
  h.set("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
  const reqHdr = request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept, Authorization";
  h.set("Access-Control-Allow-Headers", reqHdr);
  h.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers: h });
}

function withCORS(response, request) {
  const h = new Headers(response.headers);
  const origin = request.headers.get("Origin") || "*";
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Credentials", "true");
  // esponi tutti gli header al browser (utile per Location ecc.)
  h.set("Access-Control-Expose-Headers", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: h,
  });
}
