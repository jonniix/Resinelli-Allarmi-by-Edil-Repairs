// src/index.js
// Proxy WHEP con CORS e Basic Auth lato server.
// Variabili richieste: 
//   - STREAM_ID (es: "72500366")
//   - STREAM_PASS (password stream)
//   - WHEP_BASE (es: "https://screenstream.io/whep")
//     oppure WHEP_URL completo (es: "https://screenstream.io/whep/72500366")

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Expose-Headers": "Location",
    ...extra,
  };
}

function basic(env) {
  const u = env.STREAM_ID || "";
  const p = env.STREAM_PASS || "";
  return "Basic " + btoa(`${u}:${p}`);
}

function upstreamUrl(env) {
  if (env.WHEP_URL) return env.WHEP_URL;
  if (env.WHEP_BASE && env.STREAM_ID) {
    const base = env.WHEP_BASE.replace(/\/+$/, "");
    return `${base}/${env.STREAM_ID}`;
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Endpoint WHEP
    if (url.pathname === "/whep") {
      // DELETE /whep?resource=<encoded_upstream_location>
      if (request.method === "DELETE") {
        const resource = url.searchParams.get("resource");
        if (!resource) {
          return new Response("Missing resource", { status: 400, headers: corsHeaders() });
        }
        const resp = await fetch(resource, {
          method: "DELETE",
          headers: { "Authorization": basic(env) },
        });
        return new Response(null, { status: resp.status, headers: corsHeaders() });
      }

      // POST SDP → upstream WHEP
      if (request.method === "POST") {
        const target = upstreamUrl(env);
        if (!target || !env.STREAM_ID || !env.STREAM_PASS) {
          return new Response(
            "Misconfigured. Set STREAM_ID, STREAM_PASS and WHEP_BASE or WHEP_URL.",
            { status: 500, headers: corsHeaders() }
          );
        }
        const offerSdp = await request.text();

        const upstream = await fetch(target, {
          method: "POST",
          headers: {
            "Content-Type": "application/sdp",
            "Authorization": basic(env),
          },
          body: offerSdp,
        });

        const answer = await upstream.text();
        const upstreamLoc = upstream.headers.get("Location") || "";

        // Riscrive Location in una URL del worker: DELETE /whep?resource=<url_upstream>
        const workerLoc = new URL("/whep", url);
        if (upstreamLoc) workerLoc.searchParams.set("resource", upstreamLoc);

        return new Response(answer, {
          status: upstream.status,
          headers: corsHeaders({
            "Content-Type": "application/sdp",
            ...(upstreamLoc ? { "Location": workerLoc.toString() } : {}),
          }),
        });
      }

      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    // Home diagnostica
    const lines = [
      "OK – WHEP proxy.",
      "Config:",
      `- WHEP_BASE=${env.WHEP_BASE || "(unset)"}`,
      `- WHEP_URL=${env.WHEP_URL || "(unset)"}`,
      `- STREAM_ID=${env.STREAM_ID ? "(set)" : "(unset)"}`,
      `- STREAM_PASS=${env.STREAM_PASS ? "(set)" : "(unset)"}`,
      "",
      "Usa POST /whep con Content-Type: application/sdp",
    ].join("\n");
    return new Response(lines, { headers: { "Content-Type": "text/plain", ...corsHeaders() } });
  },
};
