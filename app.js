(() => {
  const config = window.ESPACE_CLOUD_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const sessionKey = "espacecloud.session.v1";
  const categories = ["Photos", "Musique", "Vidéos", "Documents"];
  const maxFileSize = 50 * 1024 * 1024;
  let session = null;
  let allFiles = [];
  let creatingAccount = false;

  try { session = JSON.parse(localStorage.getItem(sessionKey) || "null"); } catch { session = null; }
  const configured = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && config.WORKER_URL);
  if (!configured) {
    $("authSubmit").disabled = true;
    $("authSubmit").textContent = "Configuration requise";
    $("authNotice").textContent = "Le site est en ligne, mais ses services cloud ne sont pas encore reliés. Consulte le guide README du dépôt pour terminer la configuration.";
    $("authNotice").classList.remove("hidden");
    $("configHint").textContent = "Il faut configurer Supabase et Cloudflare avant de créer un compte.";
  }
  const supabaseUrl = String(config.SUPABASE_URL || "").replace(/\/$/, "");
  const workerUrl = String(config.WORKER_URL || "").replace(/\/$/, "");

  function message(id, text, type = "") {
    const el = $(id); el.textContent = text; el.className = `notice${type ? ` ${type}` : ""}`;
  }
  function hideMessage(id) { $(id).classList.add("hidden"); }
  function saveSession(value) { session = value; localStorage.setItem(sessionKey, JSON.stringify(value)); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  async function authRequest(path, body) {
    const response = await fetch(`${supabaseUrl}/auth/v1/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: config.SUPABASE_ANON_KEY }, body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || "La demande a échoué.");
    return data;
  }
  async function refreshSession() {
    if (!session?.refresh_token) throw new Error("Reconnecte-toi pour continuer.");
    const fresh = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
    saveSession(fresh); return fresh;
  }
  async function api(path, options = {}, retry = true) {
    if (!session?.access_token) throw new Error("Reconnecte-toi pour continuer.");
    const response = await fetch(`${workerUrl}${path}`, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${session.access_token}` } });
    if (response.status === 401 && retry) { await refreshSession(); return api(path, options, false); }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || data.message || `Erreur du service (${response.status}).`);
    }
    if (response.status === 204) return null;
    return response;
  }
  function showApp() {
    $("authScreen").classList.add("hidden"); $("app").classList.remove("hidden");
    const email = session?.user?.email || "Mon compte"; $("userEmail").textContent = email; $("avatar").textContent = email.charAt(0).toUpperCase();
    loadFiles();
  }
  function fileCategory(file) {
    const type = (file.mime_type || "").toLowerCase();
    if (type.startsWith("image/")) return "Photos";
    if (type.startsWith("audio/")) return "Musique";
    if (type.startsWith("video/")) return "Vidéos";
    return "Documents";
  }
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} octet${bytes > 1 ? "s" : ""}`;
    const units = ["Ko", "Mo", "Go", "To"]; let size = bytes / 1024, i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(size)} ${units[i]}`;
  }
  function renderFiles() {
    const filter = $("filter").value;
    const files = allFiles.filter(file => !filter || file.category === filter);
    $("count").textContent = allFiles.length;
    $("used").textContent = formatSize(allFiles.reduce((sum, file) => sum + Number(file.size || 0), 0));
    $("rows").innerHTML = files.map(file => {
      const icon = ({Photos:"▧",Musique:"♫",Vidéos:"▶",Documents:"▤"})[file.category] || "▤";
      const date = file.created_at ? new Date(file.created_at).toLocaleDateString("fr-FR") : "—";
      return `<tr><td><div class="filecell"><span class="fileicon">${icon}</span><span class="filename" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span></div></td><td class="categorycol"><span class="category">${escapeHtml(file.category)}</span></td><td class="amount">${formatSize(Number(file.size || 0))}</td><td class="amount">${date}</td><td><button class="action" data-download="${escapeHtml(file.id)}">Télécharger</button><button class="action delete" data-delete="${escapeHtml(file.id)}">Supprimer</button></td></tr>`;
    }).join("");
    $("empty").classList.toggle("hidden", files.length > 0);
  }
  async function loadFiles() {
    hideMessage("appNotice"); $("refresh").disabled = true;
    try { const response = await api("/api/files"); allFiles = await response.json(); renderFiles(); }
    catch (error) { message("appNotice", error.message, "error"); }
    finally { $("refresh").disabled = false; }
  }
  $("switchMode").addEventListener("click", () => {
    creatingAccount = !creatingAccount;
    $("authTitle").textContent = creatingAccount ? "Créer un compte" : "Connexion";
    $("authSub").textContent = creatingAccount ? "Inscris-toi pour ouvrir ton espace." : "Connecte-toi pour retrouver tes fichiers.";
    $("authSubmit").textContent = creatingAccount ? "Créer mon compte" : "Se connecter";
    $("switchText").textContent = creatingAccount ? "Déjà inscrit ?" : "Nouveau ici ?";
    $("switchMode").textContent = creatingAccount ? "Se connecter" : "Créer un compte";
    $("password").autocomplete = creatingAccount ? "new-password" : "current-password";
    hideMessage("authNotice");
  });
  $("authForm").addEventListener("submit", async event => {
    event.preventDefault(); if (!configured) return;
    $("authSubmit").disabled = true; hideMessage("authNotice");
    try {
      const email = $("email").value.trim(), password = $("password").value;
      if (creatingAccount) {
        const redirect = `${location.origin}${location.pathname}`;
        const created = await authRequest(`signup?redirect_to=${encodeURIComponent(redirect)}`, { email, password });
        if (created.access_token) { saveSession(created); showApp(); }
        else message("authNotice", "Compte créé. Vérifie ton e-mail pour confirmer l’inscription, puis connecte-toi.", "success");
      } else { saveSession(await authRequest("token?grant_type=password", { email, password })); showApp(); }
    } catch (error) { message("authNotice", error.message, "error"); }
    finally { $("authSubmit").disabled = false; }
  });
  $("signout").addEventListener("click", async () => {
    try { if (session?.access_token && configured) await fetch(`${supabaseUrl}/auth/v1/logout`, { method:"POST", headers:{apikey:config.SUPABASE_ANON_KEY, Authorization:`Bearer ${session.access_token}`} }); } catch {}
    localStorage.removeItem(sessionKey); session = null; $("app").classList.add("hidden"); $("authScreen").classList.remove("hidden");
  });
  $("fileInput").addEventListener("change", async event => {
    const file = event.target.files?.[0]; if (!file) return; event.target.value = "";
    if (file.size > maxFileSize) { message("appNotice", "Ce fichier dépasse la limite actuelle de 50 Mo.", "error"); return; }
    hideMessage("appNotice"); $("uploadButton").classList.add("loading"); $("uploadLabel").textContent = "Envoi en cours…";
    try {
      const category = file.type.startsWith("image/") ? "Photos" : file.type.startsWith("audio/") ? "Musique" : file.type.startsWith("video/") ? "Vidéos" : "Documents";
      await api(`/api/files/upload?category=${encodeURIComponent(category)}`, { method:"POST", headers:{"Content-Type":file.type || "application/octet-stream", "X-File-Name":encodeURIComponent(file.name)}, body:file });
      message("appNotice", "Fichier envoyé.", "success"); await loadFiles();
    } catch (error) { message("appNotice", error.message, "error"); }
    finally { $("uploadButton").classList.remove("loading"); $("uploadLabel").textContent = "＋ Ajouter un fichier"; }
  });
  $("rows").addEventListener("click", async event => {
    const download = event.target.closest("[data-download]")?.dataset.download;
    const remove = event.target.closest("[data-delete]")?.dataset.delete;
    try {
      if (download) { const response = await api(`/api/files/${encodeURIComponent(download)}/download`); const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = allFiles.find(file => file.id === download)?.name || "fichier"; a.click(); URL.revokeObjectURL(url); }
      if (remove) { if (!confirm("Supprimer ce fichier ?")) return; await api(`/api/files/${encodeURIComponent(remove)}`, {method:"DELETE"}); await loadFiles(); }
    } catch (error) { message("appNotice", error.message, "error"); }
  });
  $("filter").addEventListener("change", renderFiles); $("refresh").addEventListener("click", loadFiles);
  document.querySelectorAll("[data-filter]").forEach(link => link.addEventListener("click", () => { $("filter").value = link.dataset.filter; renderFiles(); }));
  if (session?.access_token && configured) showApp();
})();
