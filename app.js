/* ============================================================
   MΛLΛK — app.js
   Toda a edição (capas, faixas, nomes) acontece pelo site.
   Os dados ficam salvos no navegador via IndexedDB (db.js).
   ============================================================ */
(() => {
  "use strict";

  const state = {
    theme: localStorage.getItem("malak-theme") || "industrial",
    currentPlaylistId: null,
    queue: [],          // array of track objects currently playing
    queuePlaylistId: null,
    queueIndex: -1,
    isPlaying: false,
    isShuffled: false,
    loopMode: "off",
    expandedTrackIds: new Set(), // which "..." panels are open (survives re-renders)
    analyzingIds: new Set(),     // tracks currently being analyzed for BPM/tom
  };

  const els = {};
  document.querySelectorAll("[id]").forEach(el => { els[el.id] = el; });
  const audio = els.audio;

  const objectUrlCache = new Map(); // fileId -> object URL (avoid re-creating repeatedly)

  /* ============================================================
     Grain overlay
     ============================================================ */
  function initGrain() {
    const canvas = els.grain;
    const ctx = canvas.getContext("2d");
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener("resize", resize);
    function draw() {
      const w = canvas.width, h = canvas.height;
      const imgData = ctx.createImageData(w, h);
      const buffer = new Uint32Array(imgData.data.buffer);
      for (let i = 0; i < buffer.length; i++) {
        const v = (Math.random() * 255) | 0;
        buffer[i] = (255 << 24) | (v << 16) | (v << 8) | v;
      }
      ctx.putImageData(imgData, 0, 0);
    }
    let last = 0;
    function loop(t) { if (t - last > 90) { draw(); last = t; } requestAnimationFrame(loop); }
    requestAnimationFrame(loop);
  }

  /* ============================================================
     Procedural cover art (fallback when no image was uploaded)
     ============================================================ */
  function seededRandom(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  function paintCover(canvas, seed, tone = "mono") {
    const size = 320;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    const rnd = seededRandom(seed);

    const grad = ctx.createRadialGradient(
      size * (0.3 + rnd() * 0.4), size * (0.25 + rnd() * 0.3), size * 0.05,
      size * 0.5, size * 0.5, size * 0.75
    );
    if (tone === "amber") {
      grad.addColorStop(0, "#3a1204"); grad.addColorStop(0.45, "#160500"); grad.addColorStop(1, "#050100");
    } else {
      grad.addColorStop(0, "#2c2c2c"); grad.addColorStop(0.5, "#0e0e0e"); grad.addColorStop(1, "#000000");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 26; i++) {
      const y = rnd() * size;
      const h = 1 + rnd() * 3;
      ctx.fillStyle = tone === "amber"
        ? `rgba(255, ${120 + Math.floor(rnd() * 90)}, ${20 + Math.floor(rnd() * 40)}, ${0.04 + rnd() * 0.1})`
        : `rgba(255,255,255,${0.03 + rnd() * 0.08})`;
      ctx.fillRect(0, y, size, h);
    }
    ctx.restore();

    const imgData = ctx.getImageData(0, 0, size, size);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 40;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.save();
    const vg = ctx.createRadialGradient(size/2, size/2, size*0.35, size/2, size/2, size*0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = tone === "amber" ? 0.14 : 0.1;
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${size * 0.32}px Oswald, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Λ", size / 2, size / 2 + size * 0.02);
    ctx.restore();
  }

  async function getCoverUrl(playlist) {
    if (playlist.coverFileId) {
      if (objectUrlCache.has(playlist.coverFileId)) return objectUrlCache.get(playlist.coverFileId);
      const blob = await MalakDB.getFileBlob(playlist.coverFileId);
      if (blob) {
        const url = URL.createObjectURL(blob);
        objectUrlCache.set(playlist.coverFileId, url);
        return url;
      }
    }
    return null;
  }

  /* mounts a cover into `container`, with a hover-to-edit overlay.
     onPick(file) is called when the user chooses a new image. */
  async function mountCoverEditable(container, playlist, onPick, onClear) {
    container.innerHTML = "";
    const url = await getCoverUrl(playlist);
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;";
      container.appendChild(img);
    } else {
      const canvas = document.createElement("canvas");
      container.appendChild(canvas);
      paintCover(canvas, playlist.id, playlist.coverTone || "mono");
    }

    const overlay = document.createElement("div");
    overlay.className = "cover-edit";
    overlay.innerHTML = `
      <button class="cover-edit__btn" type="button" title="Trocar capa" aria-label="Trocar capa">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
      </button>
      ${url ? `<button class="cover-edit__btn" type="button" title="Remover capa" aria-label="Remover capa" data-clear="1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
      </button>` : ""}
      <span class="cover-edit__hint">Clique para trocar</span>
    `;
    overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.closest("[data-clear]")) { onClear && onClear(); return; }
      pickFile(els.coverFileInput, "image/*", false).then(files => {
        if (files && files[0]) onPick(files[0]);
      });
    });
    container.style.position = "relative";
    container.appendChild(overlay);
  }

  /* non-editable cover mount (used in the sticky player) */
  async function mountCoverStatic(container, playlist) {
    container.innerHTML = "";
    const url = playlist ? await getCoverUrl(playlist) : null;
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;";
      container.appendChild(img);
    } else {
      const canvas = document.createElement("canvas");
      container.appendChild(canvas);
      paintCover(canvas, playlist ? playlist.id : "default", playlist ? playlist.coverTone : "mono");
    }
  }

  function pickFile(inputEl, accept, multiple) {
    return new Promise((resolve) => {
      inputEl.value = "";
      inputEl.multiple = !!multiple;
      const handler = () => {
        inputEl.removeEventListener("change", handler);
        resolve(inputEl.files && inputEl.files.length ? Array.from(inputEl.files) : null);
      };
      inputEl.addEventListener("change", handler);
      inputEl.click();
    });
  }

  /* ============================================================
     Waveform
     ============================================================ */
  let currentWavePeaks = [];
  function generatePeaks(seed, count = 90) {
    const rnd = seededRandom(seed);
    const peaks = [];
    let v = 0.4;
    for (let i = 0; i < count; i++) { v += (rnd() - 0.5) * 0.5; v = Math.max(0.12, Math.min(1, v)); peaks.push(v); }
    return peaks;
  }
  function drawWave() {
    const canvas = els.waveCanvas;
    const rect = els.waveScrub.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const peaks = currentWavePeaks.length ? currentWavePeaks : new Array(90).fill(0.15);
    const gap = 2;
    const barW = Math.max(1.5, rect.width / peaks.length - gap);
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    const styles = getComputedStyle(document.documentElement);
    const unplayed = styles.getPropertyValue("--panel-border").trim() || "rgba(255,255,255,0.15)";
    const playedChrome = styles.getPropertyValue("--chrome-hi").trim() || "#eee";
    peaks.forEach((p, i) => {
      const x = i * (barW + gap);
      const h = Math.max(2, p * rect.height);
      const y = (rect.height - h) / 2;
      const isPast = i / peaks.length <= progress;
      ctx.fillStyle = isPast ? playedChrome : unplayed;
      ctx.fillRect(x, y, barW, h);
    });
  }

  /* ============================================================
     Theme
     ============================================================ */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
    els.themeLabel.textContent = state.theme === "industrial" ? "Industrial" : "Chrome";
    drawWave();
  }
  els.themeToggle.addEventListener("click", () => {
    state.theme = state.theme === "industrial" ? "chrome" : "industrial";
    localStorage.setItem("malak-theme", state.theme);
    applyTheme();
  });

  /* ============================================================
     Site meta
     ============================================================ */
  function mountSiteMeta() {
    if (typeof SITE === "undefined") return;
    els.brandMark.textContent = SITE.platform || SITE.artist || "NULLTAPE";
    els.brandTag.textContent = SITE.artist ? `${SITE.artist} — ${SITE.tagline || ""}`.trim().replace(/—\s*$/, "").trim() : (SITE.tagline || "");
    els.footerBrand.textContent = SITE.platform || SITE.artist || "NULLTAPE";
    els.playerArtist.textContent = SITE.artist || "MΛLΛK";
    els.dashSub.textContent = SITE.artist ? `${SITE.artist} — ${SITE.tagline || ""}`.trim().replace(/—\s*$/, "").trim() : els.dashSub.textContent;

    const iconMap = {
      instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>`,
      youtube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>`,
      soundcloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 15v3M6 13v5M9 11v7M12 9v9M15 12a4 4 0 014-4h1a3 3 0 013 3v.2a3 3 0 01-3 2.8H15v-2z"/></svg>`,
    };
    els.footerSocials.innerHTML = (SITE.socials || []).map(s => `
      <a class="icon-btn" href="${s.url}" target="_blank" rel="noopener" aria-label="${s.label}" title="${s.label}">${iconMap[s.icon] || iconMap.instagram}</a>
    `).join("");
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }

  /* ============================================================
     Modal (used for "new playlist")
     ============================================================ */
  function openModal({ title, fields, submitLabel = "Salvar" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3>${escapeHtml(title)}</h3>
          ${fields.map((f, i) => `
            <label for="modalField${i}">${escapeHtml(f.label)}</label>
            <input type="text" id="modalField${i}" value="${escapeHtml(f.value || "")}" placeholder="${escapeHtml(f.placeholder || "")}" />
          `).join("")}
          <div class="modal__actions">
            <button type="button" class="btn-cancel">Cancelar</button>
            <button type="button" class="btn-save">${escapeHtml(submitLabel)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("is-open"));

      function close(result) {
        overlay.classList.remove("is-open");
        setTimeout(() => overlay.remove(), 200);
        resolve(result);
      }
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
      overlay.querySelector(".btn-cancel").addEventListener("click", () => close(null));
      overlay.querySelector(".btn-save").addEventListener("click", submit);
      overlay.querySelectorAll("input").forEach(inp => {
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") close(null); });
      });
      const firstInput = overlay.querySelector("input");
      setTimeout(() => firstInput && firstInput.focus(), 50);

      function submit() {
        const values = fields.map((f, i) => overlay.querySelector(`#modalField${i}`).value.trim());
        close(values);
      }
    });
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("is-visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
  }

  /* ============================================================
     Dashboard
     ============================================================ */
  async function mountDashboard() {
    const playlists = await MalakDB.getAllPlaylists();
    els.playlistGrid.innerHTML = "";

    for (const pl of playlists) {
      const tracks = await MalakDB.getTracksByPlaylist(pl.id);
      const wrap = document.createElement("div");
      wrap.className = "card__wrap";
      wrap.innerHTML = `
        <button class="card__delete" title="Excluir playlist" aria-label="Excluir playlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <button class="card" aria-label="Abrir ${escapeHtml(pl.title)}">
          <div class="card__art"><div class="card__canvas-slot"></div>
            <div class="card__play" role="presentation"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
          </div>
          <div class="card__title">${escapeHtml(pl.title)}</div>
          <div class="card__meta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V8a5 5 0 0110 0v3"/></svg>
            ${escapeHtml(pl.owner || "")} · ${tracks.length} faixa${tracks.length === 1 ? "" : "s"}
          </div>
        </button>
      `;
      const slot = wrap.querySelector(".card__canvas-slot");
      await mountCoverEditable(
        slot, pl,
        async (file) => { await MalakDB.setPlaylistCover(pl.id, file); objectUrlCache.delete(pl.coverFileId); mountDashboard(); if (state.currentPlaylistId === pl.id) openPlaylist(pl.id); },
        async () => { await MalakDB.clearPlaylistCover(pl.id); mountDashboard(); if (state.currentPlaylistId === pl.id) openPlaylist(pl.id); }
      );
      wrap.querySelector(".card__play").addEventListener("click", (e) => { e.stopPropagation(); openPlaylist(pl.id, { autoplayFirst: true }); });
      wrap.querySelector(".card").addEventListener("click", () => openPlaylist(pl.id));
      wrap.querySelector(".card__delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm(`Excluir a playlist "${pl.title}"? Isso apaga todas as faixas dela.`)) {
          await MalakDB.deletePlaylist(pl.id);
          mountDashboard();
        }
      });
      els.playlistGrid.appendChild(wrap);
    }

    // "+ nova playlist" tile
    const addTile = document.createElement("button");
    addTile.className = "card card--add";
    addTile.innerHTML = `
      <div class="card__art">
        <div class="plus-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></div>
        <span class="label">Nova playlist</span>
      </div>
    `;
    addTile.addEventListener("click", async () => {
      const result = await openModal({
        title: "Nova playlist",
        fields: [{ label: "Nome", placeholder: "Ex: MALAK — Beats 2026" }, { label: "Autor(a)", placeholder: "MALAKSAMPS", value: "MALAKSAMPS" }],
        submitLabel: "Criar",
      });
      if (!result || !result[0]) return;
      const pl = await MalakDB.createPlaylist({ title: result[0], owner: result[1] });
      mountDashboard();
      openPlaylist(pl.id);
    });
    els.playlistGrid.appendChild(addTile);
  }

  /* ============================================================
     Playlist detail view
     ============================================================ */
  function updateVinylState() {
    if (!els.vinylDisc) return;
    const playingHere = state.queuePlaylistId && state.currentPlaylistId === state.queuePlaylistId
      && state.queue[state.queueIndex] && audio.src && !audio.paused;
    els.vinylDisc.classList.toggle("is-playing", !!playingHere);
  }

  async function openPlaylist(id, opts = {}) {
    const pl = await MalakDB.getPlaylist(id);
    if (!pl) return;
    state.currentPlaylistId = id;

    els.viewDashboard.hidden = true;
    els.viewDetail.hidden = false;
    window.scrollTo({ top: 0 });

    els.detailTitle.textContent = pl.title;
    const tracks = await MalakDB.getTracksByPlaylist(id);
    els.detailSub.innerHTML = `<b>${escapeHtml(pl.owner || "")}</b> · ${tracks.length} faixa${tracks.length === 1 ? "" : "s"}`;

    await mountCoverEditable(
      els.detailArt, pl,
      async (file) => { await MalakDB.setPlaylistCover(pl.id, file); objectUrlCache.delete(pl.coverFileId); openPlaylist(id); },
      async () => { await MalakDB.clearPlaylistCover(pl.id); openPlaylist(id); }
    );

    await renderTrackList(pl, tracks);
    updateVinylState();
  }

  async function reRenderTracks() {
    if (!state.currentPlaylistId) return;
    const pl = await MalakDB.getPlaylist(state.currentPlaylistId);
    if (!pl) return;
    const tracks = await MalakDB.getTracksByPlaylist(pl.id);
    await renderTrackList(pl, tracks);
  }

  async function renderTrackList(pl, tracks) {
    els.trackList.innerHTML = "";
    if (!tracks.length) {
      els.trackList.innerHTML = `<div class="empty">Essa playlist ainda não tem faixas.<br>Clique em "Adicionar faixas" abaixo para subir seus áudios.</div>`;
      return;
    }
    tracks.forEach((track, i) => {
      const hasAudio = !!(track.fileId || track.urlSrc);
      const isAnalyzing = state.analyzingIds.has(track.id);
      const isOpen = state.expandedTrackIds.has(track.id);

      const item = document.createElement("div");
      item.className = "track-item" + (isOpen ? " is-open" : "");
      item.dataset.trackId = track.id;

      const row = document.createElement("div");
      row.className = "track-row" + (hasAudio ? "" : " is-missing");
      row.dataset.trackId = track.id;

      const submeta = isAnalyzing
        ? `<div class="track-row__submeta is-analyzing">Analisando tom &amp; BPM…</div>`
        : (track.bpm || track.key)
          ? `<div class="track-row__submeta">${track.bpm ? `${track.bpm} BPM` : ""}${track.bpm && track.key ? " · " : ""}${track.key ? escapeHtml(track.key) : ""}</div>`
          : "";

      row.innerHTML = `
        <div class="track-row__index">
          <span class="num">${i + 1}</span>
          <span class="eq"><span></span><span></span><span></span></span>
        </div>
        <div class="track-row__main">
          <div class="track-row__title" title="Clique no lápis para renomear">${escapeHtml(track.title)}</div>
          ${submeta}
        </div>
        <div class="track-row__date">${escapeHtml(track.date || "")}</div>
        <div class="track-row__actions">
          ${hasAudio ? "" : `<button class="attach-btn" data-action="attach">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 014.95 4.95L10.13 17.1a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
            Anexar áudio
          </button>`}
          <button class="rowRename" title="Renomear" aria-label="Renomear" data-action="rename">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
          </button>
          ${hasAudio ? `<button class="rowDownload" title="Baixar sample" aria-label="Baixar sample" data-action="download">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
          </button>
          <button class="rowCopy" title="Copiar link" aria-label="Copiar link da faixa" data-action="copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07L11.5 4.5"/><path d="M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 007.07 7.07L12.5 19.5"/></svg>
          </button>` : ""}
          <button class="rowMore" title="Mais opções" aria-label="Mais opções" data-action="menu">
            <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
          </button>
          <button class="rowDelete" title="Excluir faixa" aria-label="Excluir faixa" data-action="delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </div>
      `;

      const details = document.createElement("div");
      details.className = "track-details";
      const metaAction = isAnalyzing
        ? `<span class="meta-status is-analyzing">Detectando automaticamente…</span>`
        : (track.bpm || track.key)
          ? `<button class="meta-link" data-action="analyze">Refazer análise</button>`
          : hasAudio
            ? `<span class="meta-status">Detectando automaticamente…</span>`
            : `<span class="meta-status">Anexe um áudio para detectar tom e BPM</span>`;
      details.innerHTML = `
        <label>Descrição</label>
        <textarea class="track-desc-input" placeholder="Adicione uma descrição para essa faixa (loop usado, contexto, o que quiser)…">${escapeHtml(track.description || "")}</textarea>
        <div class="track-details__meta">
          <div class="meta-chip">Tom <b>${track.key ? escapeHtml(track.key) : "—"}</b></div>
          <div class="meta-chip">BPM <b>${track.bpm ? track.bpm : "—"}</b></div>
          ${metaAction}
        </div>
      `;

      item.appendChild(row);
      item.appendChild(details);

      row.addEventListener("click", async (e) => {
        const btn = e.target.closest("button");
        if (btn) {
          const action = btn.dataset.action;
          e.stopPropagation();
          if (action === "attach") {
            const files = await pickFile(els.trackAttachInput, "audio/*", false);
            if (files && files[0]) {
              await MalakDB.attachFileToTrack(track.id, files[0]);
              await reRenderTracks();
              showToast("Áudio anexado.");
              runAnalysis(track.id, files[0], pl.id);
            }
          } else if (action === "rename") {
            startInlineRename(row, track);
          } else if (action === "download") {
            downloadTrack(track);
          } else if (action === "copy") {
            copyTrackLink(track);
          } else if (action === "menu") {
            if (state.expandedTrackIds.has(track.id)) state.expandedTrackIds.delete(track.id);
            else state.expandedTrackIds.add(track.id);
            item.classList.toggle("is-open");
          } else if (action === "analyze") {
            const blob = track.fileId ? await MalakDB.getFileBlob(track.fileId) : null;
            if (!blob) { showToast("Anexe um áudio primeiro."); return; }
            runAnalysis(track.id, blob, pl.id);
          } else if (action === "delete") {
            if (confirm(`Excluir a faixa "${track.title}"?`)) {
              await MalakDB.deleteTrack(track.id);
              if (state.queuePlaylistId === pl.id) removeFromQueueIfPresent(track.id);
              state.expandedTrackIds.delete(track.id);
              state.analyzingIds.delete(track.id);
              await reRenderTracks();
            }
          }
          return;
        }
        if (!hasAudio) return; // nothing to play yet
        playFromPlaylist(pl, tracks, i);
      });

      row.querySelector(".track-row__title").addEventListener("dblclick", () => startInlineRename(row, track));

      const descInput = details.querySelector(".track-desc-input");
      descInput.addEventListener("click", (e) => e.stopPropagation());
      descInput.addEventListener("blur", async () => {
        const val = descInput.value;
        if (val !== (track.description || "")) {
          track.description = val;
          await MalakDB.updateTrack(track.id, { description: val });
          showToast("Descrição salva.");
        }
      });

      els.trackList.appendChild(item);
    });
    highlightActiveRow();
  }

  async function runAnalysis(trackId, fileOrBlob, playlistId) {
    if (typeof MalakAnalysis === "undefined") return;
    state.analyzingIds.add(trackId);
    if (state.currentPlaylistId === playlistId) await reRenderTracks();
    try {
      const result = await MalakAnalysis.analyze(fileOrBlob);
      await MalakDB.updateTrack(trackId, { bpm: result.bpm || null, key: result.key || null });
    } catch (err) {
      console.error("[MΛLΛK] Falha ao analisar tom/BPM:", err);
      showToast("Não foi possível detectar tom/BPM dessa faixa.");
    } finally {
      state.analyzingIds.delete(trackId);
      if (state.currentPlaylistId === playlistId) await reRenderTracks();
    }
  }

  function startInlineRename(row, track) {
    const titleEl = row.querySelector(".track-row__title");
    titleEl.setAttribute("contenteditable", "true");
    titleEl.focus();
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    async function commit() {
      titleEl.removeAttribute("contenteditable");
      const newTitle = titleEl.textContent.trim() || track.title;
      titleEl.textContent = newTitle;
      if (newTitle !== track.title) {
        await MalakDB.updateTrack(track.id, { title: newTitle });
        track.title = newTitle;
        if (state.queue[state.queueIndex]?.id === track.id) els.playerTitle.textContent = newTitle;
      }
      titleEl.removeEventListener("blur", commit);
      titleEl.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); }
      if (e.key === "Escape") { titleEl.textContent = track.title; titleEl.blur(); }
    }
    titleEl.addEventListener("blur", commit);
    titleEl.addEventListener("keydown", onKey);
  }

  els.backBtn.addEventListener("click", () => {
    els.viewDetail.hidden = true;
    els.viewDashboard.hidden = false;
    mountDashboard();
  });

  els.playAllBtn.addEventListener("click", async () => {
    if (!state.currentPlaylistId) return;
    const pl = await MalakDB.getPlaylist(state.currentPlaylistId);
    const tracks = (await MalakDB.getTracksByPlaylist(pl.id)).filter(t => t.fileId || t.urlSrc);
    if (tracks.length) playFromPlaylist(pl, tracks, 0);
    else showToast("Nenhuma faixa com áudio anexado ainda.");
  });

  els.shuffleAllBtn.addEventListener("click", async () => {
    if (!state.currentPlaylistId) return;
    const pl = await MalakDB.getPlaylist(state.currentPlaylistId);
    const tracks = (await MalakDB.getTracksByPlaylist(pl.id)).filter(t => t.fileId || t.urlSrc);
    if (!tracks.length) { showToast("Nenhuma faixa com áudio anexado ainda."); return; }
    state.isShuffled = true;
    setShuffleVisual(true);
    playFromPlaylist(pl, tracks, Math.floor(Math.random() * tracks.length));
  });

  els.renamePlaylistBtn.addEventListener("click", async () => {
    if (!state.currentPlaylistId) return;
    const pl = await MalakDB.getPlaylist(state.currentPlaylistId);
    const result = await openModal({
      title: "Renomear playlist",
      fields: [{ label: "Nome", value: pl.title }, { label: "Autor(a)", value: pl.owner }],
      submitLabel: "Salvar",
    });
    if (!result || !result[0]) return;
    await MalakDB.updatePlaylist(pl.id, { title: result[0], owner: result[1] });
    openPlaylist(pl.id);
  });

  els.deletePlaylistBtn.addEventListener("click", async () => {
    if (!state.currentPlaylistId) return;
    const pl = await MalakDB.getPlaylist(state.currentPlaylistId);
    if (confirm(`Excluir a playlist "${pl.title}"? Isso apaga todas as faixas dela.`)) {
      await MalakDB.deletePlaylist(pl.id);
      els.viewDetail.hidden = true;
      els.viewDashboard.hidden = false;
      mountDashboard();
    }
  });

  els.addTracksBtn.addEventListener("click", async () => {
    if (!state.currentPlaylistId) return;
    const files = await pickFile(els.audioFileInput, "audio/*", true);
    if (!files || !files.length) return;
    let order = Date.now();
    const created = [];
    for (const file of files) {
      const track = await MalakDB.addTrackFromFile(state.currentPlaylistId, file, order++);
      created.push({ track, file });
    }
    showToast(files.length > 1 ? `${files.length} faixas adicionadas.` : "Faixa adicionada.");
    await reRenderTracks();
    // dispara a detecção de tom/BPM em segundo plano pra cada faixa nova
    const playlistId = state.currentPlaylistId;
    for (const { track, file } of created) runAnalysis(track.id, file, playlistId);
  });

  /* ============================================================
     Playback engine
     ============================================================ */
  async function getTrackSrc(track) {
    if (track.fileId) {
      if (objectUrlCache.has(track.fileId)) return objectUrlCache.get(track.fileId);
      const blob = await MalakDB.getFileBlob(track.fileId);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      objectUrlCache.set(track.fileId, url);
      return url;
    }
    return track.urlSrc || null;
  }

  async function playFromPlaylist(pl, tracks, index) {
    state.queue = tracks;
    state.queuePlaylistId = pl.id;
    state.currentPlaylistId = pl.id;
    state.queueIndex = index;
    await loadCurrentTrack(pl);
    audio.play().catch(() => {});
  }

  async function loadCurrentTrack(pl) {
    const track = state.queue[state.queueIndex];
    if (!track) return;
    const src = await getTrackSrc(track);
    if (!src) { showToast("Essa faixa ainda não tem áudio anexado."); return; }
    audio.src = src;
    els.playerTitle.textContent = track.title;
    els.timeCurrent.textContent = "0:00";
    els.timeTotal.textContent = "0:00";
    currentWavePeaks = generatePeaks(track.title + (pl?.id || ""));
    await mountCoverStatic(els.playerCover, pl);
    els.player.classList.add("is-active");
    drawWave();
    highlightActiveRow();
    updateVinylState();
  }

  function highlightActiveRow() {
    if (!els.trackList) return;
    const rows = els.trackList.querySelectorAll(".track-row");
    rows.forEach((row) => {
      const isActive = state.queue[state.queueIndex] && row.dataset.trackId === state.queue[state.queueIndex].id;
      row.classList.toggle("is-active", !!isActive);
    });
  }

  function removeFromQueueIfPresent(trackId) {
    const idx = state.queue.findIndex(t => t.id === trackId);
    if (idx === -1) return;
    if (idx === state.queueIndex) { audio.pause(); audio.removeAttribute("src"); els.player.classList.remove("is-active"); }
    state.queue.splice(idx, 1);
    if (idx < state.queueIndex) state.queueIndex--;
    updateVinylState();
  }

  async function togglePlay() {
    if (!audio.src) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  async function playNext() {
    if (!state.queue.length) return;
    const pl = await MalakDB.getPlaylist(state.queuePlaylistId);
    if (state.isShuffled) {
      state.queueIndex = Math.floor(Math.random() * state.queue.length);
    } else {
      state.queueIndex++;
      if (state.queueIndex >= state.queue.length) {
        if (state.loopMode === "all") state.queueIndex = 0;
        else { state.queueIndex = state.queue.length - 1; return; }
      }
    }
    await loadCurrentTrack(pl);
    audio.play().catch(() => {});
  }

  async function playPrev() {
    if (!state.queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    const pl = await MalakDB.getPlaylist(state.queuePlaylistId);
    state.queueIndex = Math.max(0, state.queueIndex - 1);
    await loadCurrentTrack(pl);
    audio.play().catch(() => {});
  }

  function setShuffleVisual(on) { els.shuffleBtn.classList.toggle("is-on", on); }

  function cycleLoop() {
    const order = ["off", "all", "one"];
    const next = order[(order.indexOf(state.loopMode) + 1) % order.length];
    state.loopMode = next;
    audio.loop = next === "one";
    els.loopBtn.classList.toggle("is-on", next !== "off");
    els.loopBtn.title = next === "off" ? "Repetir: desligado" : next === "all" ? "Repetir: playlist" : "Repetir: faixa";
  }

  function fmtTime(sec) {
    if (!isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  audio.addEventListener("play", () => {
    state.isPlaying = true;
    els.playIcon.outerHTML = `<svg id="playIcon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`;
    els.playIcon = document.getElementById("playIcon");
    highlightActiveRow();
    updateVinylState();
  });
  audio.addEventListener("pause", () => {
    state.isPlaying = false;
    els.playIcon.outerHTML = `<svg id="playIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    els.playIcon = document.getElementById("playIcon");
    highlightActiveRow();
    updateVinylState();
  });
  audio.addEventListener("timeupdate", () => { els.timeCurrent.textContent = fmtTime(audio.currentTime); drawWave(); });
  audio.addEventListener("loadedmetadata", () => { els.timeTotal.textContent = fmtTime(audio.duration); });
  audio.addEventListener("ended", () => {
    if (state.loopMode === "one") { audio.currentTime = 0; audio.play(); return; }
    playNext();
  });
  audio.addEventListener("error", () => {
    if (state.queue[state.queueIndex]) els.playerTitle.textContent = state.queue[state.queueIndex].title + " (não foi possível carregar)";
  });

  els.playBtn.addEventListener("click", togglePlay);
  els.nextBtn.addEventListener("click", playNext);
  els.prevBtn.addEventListener("click", playPrev);
  els.loopBtn.addEventListener("click", cycleLoop);
  els.shuffleBtn.addEventListener("click", () => { state.isShuffled = !state.isShuffled; setShuffleVisual(state.isShuffled); });
  els.volumeSlider.addEventListener("input", (e) => { audio.volume = parseFloat(e.target.value); });
  audio.volume = parseFloat(els.volumeSlider.value);

  els.waveScrub.addEventListener("click", (e) => {
    if (!audio.duration) return;
    const rect = els.waveScrub.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  });

  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement.isContentEditable) return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    if (e.code === "ArrowRight" && e.shiftKey) playNext();
    if (e.code === "ArrowLeft" && e.shiftKey) playPrev();
  });

  window.addEventListener("resize", drawWave);

  /* ============================================================
     Download / copy link
     ============================================================ */
  async function downloadTrack(track) {
    const src = await getTrackSrc(track);
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = track.title.replace(/[^\w\-]+/g, "_") + ".mp3";
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast("Baixando sample…");
  }

  async function copyTrackLink(track) {
    const src = await getTrackSrc(track);
    if (!src) return;
    if (track.fileId) {
      // blob: URLs only work in this browser tab/session — say so clearly.
      navigator.clipboard?.writeText(src).then(
        () => showToast("Link copiado (só funciona neste navegador/sessão)."),
        () => showToast("Não foi possível copiar.")
      );
      return;
    }
    const url = new URL(src, window.location.href).toString();
    navigator.clipboard?.writeText(url).then(() => showToast("Link copiado."), () => showToast("Não foi possível copiar."));
  }

  els.downloadBtn.addEventListener("click", () => { const t = state.queue[state.queueIndex]; if (t) downloadTrack(t); });
  els.copyLinkBtn.addEventListener("click", () => { const t = state.queue[state.queueIndex]; if (t) copyTrackLink(t); });

  /* ============================================================
     Boot
     ============================================================ */
  async function boot() {
    applyTheme();
    mountSiteMeta();
    try {
      await MalakDB.seedIfEmpty(typeof SITE !== "undefined" ? SITE : {}, typeof SEED_PLAYLISTS !== "undefined" ? SEED_PLAYLISTS : []);
      await mountDashboard();
      const backendName = await MalakDB.getBackendName();
      if (backendName === "memory") {
        showToast("Modo sem salvamento: abra em uma aba normal do navegador para guardar suas alterações.");
      }
    } catch (err) {
      console.error("[MΛLΛK] Erro ao iniciar:", err);
      els.playlistGrid.innerHTML = `<div class="empty">Não foi possível carregar a biblioteca.<br>Tente recarregar a página ou abrir em outro navegador.</div>`;
    }
    initGrain();
    drawWave();
  }
  boot();

})();
