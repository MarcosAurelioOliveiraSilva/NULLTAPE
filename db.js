/* ============================================================
   MΛLΛK — db.js
   Camada de dados no navegador. Guarda playlists, faixas e os
   arquivos que você envia pelo site (capas e áudios).

   Tenta usar IndexedDB (persiste entre recarregamentos). Se o
   ambiente bloquear IndexedDB — como acontece em alguns preview
   embutidos (ex: painel "Live Preview" do VS Code) — cai
   automaticamente para um modo em memória, para o site nunca
   travar com a tela em branco. Nesse modo de reserva os dados
   somem ao recarregar a página; abra o site numa aba normal do
   navegador para ter salvamento permanente.

   IMPORTANTE: mesmo com IndexedDB funcionando, isso fica salvo
   só neste navegador/computador — não é um servidor. Veja o
   README para publicar faixas que todo visitante vai ouvir.
   ============================================================ */
const MalakDB = (() => {
  const DB_NAME = "malak-db";
  const DB_VERSION = 1;
  const STORES = ["playlists", "tracks", "files", "meta"];

  let backend = null;       // "idb" | "memory"
  let backendReady = null;  // Promise<void>
  let idbHandle = null;
  const mem = { playlists: new Map(), tracks: new Map(), files: new Map(), meta: new Map() };
  let usedFallbackNotice = false;

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tryOpenIndexedDB(timeoutMs = 1500) {
    return new Promise((resolve) => {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, timeoutMs);
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("playlists")) db.createObjectStore("playlists", { keyPath: "id" });
          if (!db.objectStoreNames.contains("tracks")) {
            const s = db.createObjectStore("tracks", { keyPath: "id" });
            s.createIndex("byPlaylist", "playlistId");
          }
          if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        };
        req.onsuccess = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(req.result); } };
        req.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } };
        req.onblocked = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } };
      } catch (err) {
        if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
      }
    });
  }

  function ensureReady() {
    if (backendReady) return backendReady;
    backendReady = tryOpenIndexedDB().then((db) => {
      if (db) {
        backend = "idb";
        idbHandle = db;
      } else {
        backend = "memory";
        if (!usedFallbackNotice) {
          usedFallbackNotice = true;
          console.warn(
            "[MΛLΛK] IndexedDB indisponível neste ambiente — usando armazenamento em memória. " +
            "Os dados não vão persistir ao recarregar a página. Abra o site em uma aba normal do navegador " +
            "(fora de previews embutidos) para salvar de verdade."
          );
        }
      }
    });
    return backendReady;
  }

  /* ---------------- generic store primitives ---------------- */
  function idbTx(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = idbHandle.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      let result;
      Promise.resolve(fn(store)).then(r => { result = r; }).catch(reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function dbGet(store, key) {
    await ensureReady();
    if (backend === "idb") {
      return idbTx(store, "readonly", (s) => reqToPromise(s.get(key)));
    }
    return mem[store].get(key) || null;
  }
  async function dbGetAll(store) {
    await ensureReady();
    if (backend === "idb") {
      return idbTx(store, "readonly", (s) => reqToPromise(s.getAll()));
    }
    return Array.from(mem[store].values());
  }
  async function dbGetAllByPlaylist(store, playlistId) {
    await ensureReady();
    if (backend === "idb") {
      return idbTx(store, "readonly", (s) => reqToPromise(s.index("byPlaylist").getAll(playlistId)));
    }
    return Array.from(mem[store].values()).filter(v => v.playlistId === playlistId);
  }
  async function dbPut(store, obj) {
    await ensureReady();
    if (backend === "idb") {
      return idbTx(store, "readwrite", (s) => reqToPromise(s.put(obj)));
    }
    mem[store].set(obj.id ?? obj.key, obj);
    return obj;
  }
  async function dbDelete(store, key) {
    await ensureReady();
    if (backend === "idb") {
      return idbTx(store, "readwrite", (s) => reqToPromise(s.delete(key)));
    }
    mem[store].delete(key);
  }

  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ---------------- meta ---------------- */
  async function getMeta(key) {
    const r = await dbGet("meta", key);
    return r ? r.value : undefined;
  }
  async function setMeta(key, value) {
    return dbPut("meta", { key, value });
  }

  /* ---------------- files (blobs) ---------------- */
  async function putFile(blob) {
    const id = uid("file");
    await dbPut("files", { id, blob, mime: blob.type });
    return id;
  }
  async function getFileBlob(id) {
    if (!id) return null;
    const r = await dbGet("files", id);
    return r ? r.blob : null;
  }
  async function deleteFile(id) {
    if (!id) return;
    return dbDelete("files", id);
  }

  /* ---------------- playlists ---------------- */
  async function getAllPlaylists() {
    const all = await dbGetAll("playlists");
    return all.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }
  async function getPlaylist(id) {
    return dbGet("playlists", id);
  }
  async function createPlaylist({ title, owner, coverTone }) {
    const pl = {
      id: uid("pl"),
      title: title || "Nova playlist",
      owner: owner || "",
      coverTone: coverTone || (Math.random() > 0.5 ? "amber" : "mono"),
      coverFileId: null,
      createdAt: Date.now(),
    };
    await dbPut("playlists", pl);
    return pl;
  }
  async function updatePlaylist(id, patch) {
    const existing = await dbGet("playlists", id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await dbPut("playlists", updated);
    return updated;
  }
  async function deletePlaylist(id) {
    const tracks = await getTracksByPlaylist(id);
    for (const t of tracks) {
      if (t.fileId) await deleteFile(t.fileId);
      await dbDelete("tracks", t.id);
    }
    const pl = await getPlaylist(id);
    if (pl && pl.coverFileId) await deleteFile(pl.coverFileId);
    return dbDelete("playlists", id);
  }
  async function setPlaylistCover(id, file) {
    const pl = await getPlaylist(id);
    if (pl && pl.coverFileId) await deleteFile(pl.coverFileId);
    const fileId = await putFile(file);
    return updatePlaylist(id, { coverFileId: fileId });
  }
  async function clearPlaylistCover(id) {
    const pl = await getPlaylist(id);
    if (pl && pl.coverFileId) await deleteFile(pl.coverFileId);
    return updatePlaylist(id, { coverFileId: null });
  }

  /* ---------------- tracks ---------------- */
  async function getTracksByPlaylist(playlistId) {
    const all = await dbGetAllByPlaylist("tracks", playlistId);
    return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  async function addTrackPlaceholder(playlistId, { title, date, order }) {
    const track = {
      id: uid("tr"),
      playlistId,
      title: title || "Faixa sem título",
      date: date || "",
      fileId: null,
      urlSrc: null,
      public: false,
      description: "",
      bpm: null,
      key: null,
      order: order ?? Date.now(),
    };
    await dbPut("tracks", track);
    return track;
  }
  async function addTrackFromFile(playlistId, file, order) {
    const fileId = await putFile(file);
    const title = file.name.replace(/\.[^/.]+$/, "");
    const track = {
      id: uid("tr"),
      playlistId,
      title,
      date: new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      fileId,
      urlSrc: null,
      public: false,
      description: "",
      bpm: null,
      key: null,
      order: order ?? Date.now(),
    };
    await dbPut("tracks", track);
    return track;
  }
  async function attachFileToTrack(trackId, file) {
    const t = await dbGet("tracks", trackId);
    if (!t) return null;
    if (t.fileId) await deleteFile(t.fileId);
    const fileId = await putFile(file);
    const updated = { ...t, fileId, urlSrc: null, bpm: null, key: null };
    await dbPut("tracks", updated);
    return updated;
  }
  async function updateTrack(id, patch) {
    const existing = await dbGet("tracks", id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await dbPut("tracks", updated);
    return updated;
  }
  async function deleteTrack(id) {
    const t = await dbGet("tracks", id);
    if (t && t.fileId) await deleteFile(t.fileId);
    return dbDelete("tracks", id);
  }

  /* ---------------- seeding on first run ---------------- */
  async function seedIfEmpty(SITE, SEED_PLAYLISTS) {
    const seeded = await getMeta("seeded");
    if (seeded) return;
    const existing = await getAllPlaylists();
    if (existing.length === 0 && Array.isArray(SEED_PLAYLISTS)) {
      for (const pl of SEED_PLAYLISTS) {
        const created = await createPlaylist({ title: pl.title, owner: pl.owner, coverTone: pl.coverTone });
        let i = 0;
        for (const t of pl.tracks || []) {
          i++;
          const track = await addTrackPlaceholder(created.id, { title: t.title, date: t.date, order: i });
          if (t.src) await updateTrack(track.id, { urlSrc: t.src, public: !!t.public });
        }
      }
    }
    await setMeta("seeded", true);
  }

  async function getBackendName() {
    await ensureReady();
    return backend;
  }

  return {
    getAllPlaylists, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist,
    setPlaylistCover, clearPlaylistCover,
    getTracksByPlaylist, addTrackPlaceholder, addTrackFromFile, attachFileToTrack,
    updateTrack, deleteTrack,
    getFileBlob, putFile, deleteFile,
    getMeta, setMeta,
    seedIfEmpty,
    getBackendName,
  };
})();
