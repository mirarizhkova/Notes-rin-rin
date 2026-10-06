function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "*";
  return {
    "access-control-allow-origin": allowed === "*" ? "*" : (origin === allowed ? origin : allowed),
    "access-control-allow-methods": "GET,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "Authorization,Content-Type,X-File-Name",
    "access-control-max-age": "86400",
  };
}

function isAuthorized(request, env) {
  const auth = request.headers.get("Authorization");
  return Boolean(env.AUTH_SECRET) && auth === `Bearer ${env.AUTH_SECRET}`;
}

function objectKeyFromPath(url) {
  const prefix = "/api/files/";
  if (!url.pathname.startsWith(prefix)) return null;
  const encoded = url.pathname.slice(prefix.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!url.pathname.startsWith("/api/")) {
      return json({ ok: true, service: "notes-rinrin-storage" }, 200, cors);
    }

    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized" }, 401, cors);
    }

    if (url.pathname === "/api/files" && request.method === "GET") {
      const prefix = url.searchParams.get("prefix") || "";
      const listed = await env.NOTES_BUCKET.list({ prefix, limit: 1000 });
      return json({
        objects: listed.objects.map(object => ({
          key: object.key,
          size: object.size,
          uploaded: object.uploaded,
          etag: object.etag,
        })),
        truncated: listed.truncated,
        cursor: listed.truncated ? listed.cursor : null,
      }, 200, cors);
    }

    const key = objectKeyFromPath(url);
    if (!key) return json({ error: "Missing file key" }, 400, cors);

    if (request.method === "PUT") {
      await env.NOTES_BUCKET.put(key, request.body, {
        httpMetadata: {
          contentType: request.headers.get("Content-Type") || "application/octet-stream",
        },
      });
      return json({ ok: true, key }, 201, cors);
    }

    if (request.method === "GET") {
      const object = await env.NOTES_BUCKET.get(key);
      if (!object) return json({ error: "Not found" }, 404, cors);

      const headers = new Headers(cors);
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "private, no-store");
      return new Response(object.body, { headers });
    }

    if (request.method === "DELETE") {
      await env.NOTES_BUCKET.delete(key);
      return json({ ok: true, key }, 200, cors);
    }

    return json({ error: "Method not allowed" }, 405, cors);
  },
};
