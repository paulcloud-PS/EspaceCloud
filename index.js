const MAX_FILE_BYTES = 50 * 1024 * 1024;
const CATEGORIES = new Set(["Photos", "Musique", "Vidéos", "Documents"]);
const EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "mp3", "wav", "m4a", "ogg", "mp4", "mov", "webm", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"]);

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin === env.ALLOWED_ORIGIN ? origin : "null",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-File-Name",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
async function currentUser(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization }
  });
  if (!response.ok) return null;
  return response.json();
}
function userHeaders(env, token, extra = {}) {
  return { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...extra };
}
async function database(env, token, path, options = {}) {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: userHeaders(env, token, { ...(options.headers || {}) })
  });
}
function safeFileName(encoded) {
  let name;
  try { name = decodeURIComponent(encoded || ""); } catch { name = ""; }
  name = name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim().slice(0, 180);
  if (!name || name === "." || name === "..") return null;
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return EXTENSIONS.has(extension) ? name : null;
}
async function listFiles(env, token) {
  return database(env, token, "files?select=id,name,category,mime_type,size,created_at&order=created_at.desc");
}
async function findFile(env, token, id, userId) {
  const query = new URLSearchParams({ select: "id,user_id,storage_key,name,category,mime_type,size,created_at", id: `eq.${id}`, user_id: `eq.${userId}`, limit: "1" });
  const response = await database(env, token, `files?${query.toString()}`);
  if (!response.ok) throw new Error("Impossible de vérifier ce fichier.");
  const rows = await response.json();
  return rows[0] || null;
}
async function handle(request, env) {
  const headers = corsHeaders(request, env);
  const origin = request.headers.get("Origin");
  if (origin && origin !== env.ALLOWED_ORIGIN) return json({ error: "Origine non autorisée." }, 403, headers);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const user = await currentUser(request, env);
  if (!user?.id || !token) return json({ error: "Session invalide. Reconnecte-toi." }, 401, headers);

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/files") {
    const response = await listFiles(env, token);
    return new Response(response.body, { status: response.status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  if (request.method === "POST" && url.pathname === "/api/files/upload") {
    const name = safeFileName(request.headers.get("X-File-Name"));
    const category = url.searchParams.get("category");
    const contentType = (request.headers.get("Content-Type") || "application/octet-stream").split(";")[0].toLowerCase();
    if (!name) return json({ error: "Type de fichier non accepté. Choisis une image, musique, vidéo ou document courant." }, 415, headers);
    if (!CATEGORIES.has(category)) return json({ error: "Catégorie invalide." }, 400, headers);
    if (!request.body) return json({ error: "Fichier vide ou illisible." }, 400, headers);
    const declaredSize = Number(request.headers.get("Content-Length") || 0);
    if (declaredSize > MAX_FILE_BYTES) return json({ error: "Ce fichier dépasse la limite actuelle de 50 Mo." }, 413, headers);

    const key = `${user.id}/${crypto.randomUUID()}`;
    let size = 0;
    const bounded = request.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
        controller.enqueue(chunk);
      }
    }));
    try {
      await env.FILES.put(key, bounded, { httpMetadata: { contentType: "application/octet-stream" } });
    } catch (error) {
      if (size > MAX_FILE_BYTES || error?.message === "FILE_TOO_LARGE") return json({ error: "Ce fichier dépasse la limite actuelle de 50 Mo." }, 413, headers);
      return json({ error: "L’envoi du fichier a échoué." }, 502, headers);
    }

    const record = { user_id: user.id, storage_key: key, name, category, mime_type: contentType, size };
    const inserted = await database(env, token, "files", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(record)
    });
    if (!inserted.ok) {
      await env.FILES.delete(key);
      return json({ error: "Le fichier a été reçu, mais son enregistrement a échoué. Réessaie dans un instant." }, 502, headers);
    }
    return json({ message: "Fichier envoyé." }, 201, headers);
  }

  const fileRoute = url.pathname.match(/^\/api\/files\/([0-9a-f-]{36})(?:\/(download))?$/i);
  if (fileRoute) {
    const id = fileRoute[1];
    const row = await findFile(env, token, id, user.id);
    if (!row) return json({ error: "Fichier introuvable." }, 404, headers);
    if (request.method === "GET" && fileRoute[2] === "download") {
      const object = await env.FILES.get(row.storage_key);
      if (!object) return json({ error: "Le fichier n’est plus disponible." }, 404, headers);
      const dispositionName = encodeURIComponent(row.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(object.body, { status: 200, headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${dispositionName}`,
        "Cache-Control": "private, no-store"
      } });
    }
    if (request.method === "DELETE" && !fileRoute[2]) {
      await env.FILES.delete(row.storage_key);
      const deleted = await database(env, token, `files?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE" });
      if (!deleted.ok) return json({ error: "Le fichier a été supprimé du stockage, mais son entrée n’a pas pu être retirée." }, 502, headers);
      return new Response(null, { status: 204, headers });
    }
  }
  return json({ error: "Adresse ou action inconnue." }, 404, headers);
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch { return json({ error: "Le service a rencontré un problème. Réessaie plus tard." }, 500, corsHeaders(request, env)); }
  }
};
