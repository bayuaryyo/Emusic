import { createDecipheriv, randomUUID } from "crypto";
import yts from "yt-search";
import { prepareWAMessageMedia } from "@whiskeysockets/baileys";

/* =========================================================
 * CONFIG
 * ========================================================= */
const METADATA_DECRYPTION_KEY = Buffer.from("C5D58EF67A7584E4A29F6C35BBC4EB12", "hex");
const HEADERS = {
  "Content-Type": "application/json",
  Origin: "https://yt.savetube.me",
  "User-Agent": "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36",
};

// ==========================================
// PENTING: Ganti ini dengan URL Server Python Anda.
// ==========================================
const HTTP_SERVER_URL = "http://178.128.96.217:8080";

const DEFAULT_THUMB =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iIzFhMGQxMiIvPjx0ZXh0IHg9IjIwMCIgeT0iMjEwIiBmb250LXNpemU9IjM0IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZmlsbD0iI2ZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+TUFJTiBQQ0xBWUVSPC90ZXh0Pjwvc3ZnPg==";

/* =========================================================
 * HELPERS
 * ========================================================= */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function formatError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}
function isYouTubeUrl(text = "") {
  return /(?:youtube\.com|youtu\.be)/i.test(text);
}
function extractYouTubeId(url = "") {
  const match = String(url).match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([a-zA-Z0-9_-]{11})/
  );
  return match?.[1] || null;
}
function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

/* =========================================================
 * SAVETUBE (TIDAK PERLU DIUBAH)
 * ========================================================= */
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(data?.message || `HTTP ${response.status} ${response.statusText}`);
  }
  return data;
}

async function savetube(url, { downloadType = "audio", quality = "128kbps" } = {}) {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error("URL YouTube tidak valid");
  const cdnRes = await fetchJson("https://media.savetube.vip/api/random-cdn", { headers: HEADERS });
  if (!cdnRes?.cdn) throw new Error("CDN SaveTube tidak tersedia");
  const cdn = String(cdnRes.cdn).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const info = await fetchJson(`https://${cdn}/v2/info`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
  });
  if (!info?.data) throw new Error("Metadata SaveTube kosong");
  let metadata;
  try {
    const encrypted = Buffer.from(info.data, "base64");
    const iv = encrypted.subarray(0, 16);
    const ciphertext = encrypted.subarray(16);
    const decipher = createDecipheriv("aes-128-cbc", METADATA_DECRYPTION_KEY, iv);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    metadata = JSON.parse(decrypted.toString("utf8"));
  } catch (error) {
    throw new Error("Decrypt metadata SaveTube gagal");
  }
  const download = await fetchJson(`https://${cdn}/download`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      id: videoId,
      downloadType,
      quality,
      key: metadata.key,
    }),
  });
  if (!download?.data?.downloadUrl) throw new Error("URL download audio tidak tersedia");
  return {
    title: metadata.title || "Unknown",
    duration: metadata.durationLabel || "0:00",
    thumbnail: metadata.thumbnail || "",
    url: download.data.downloadUrl,
  };
}

async function savetubeRetry(url, options = {}, retry = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retry; attempt++) {
    try {
      return await savetube(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < retry) await sleep(1500);
    }
  }
  throw lastError;
}

/* =========================================================
 * THUMBNAIL
 * ========================================================= */
async function getThumb(url) {
  try {
    if (!url) return Buffer.alloc(0);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Thumbnail gagal (${response.status})`);
    const raw = Buffer.from(await response.arrayBuffer());
    if (!raw.length) return Buffer.alloc(0);

    try {
      const sharp = (await import('sharp')).default;
      return await sharp(raw)
        .resize(1280, 720, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch (e) {
      return raw;
    }
  } catch (error) {
    return Buffer.alloc(0);
  }
}

async function createHighQualityThumbnail(conn, thumbnail) {
  try {
    if (!thumbnail?.length) return null;
    const result = await prepareWAMessageMedia(
      { image: thumbnail },
      { upload: conn.waUploadToServer, mediaTypeOverride: "thumbnail-link" }
    );
    return result?.imageMessage || null;
  } catch (error) {
    return null;
  }
}

/* =========================================================
 * MUSIC PLAYER HTML + WSS / HTTP PROXY INTEGRATION
 * ========================================================= */
async function getTunnelInfo() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${HTTP_SERVER_URL}/tunnel`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data?.status === "online" && data?.wss) return data;
    }
  } catch (e) {
    console.error("[Music Plugin] Gagal mengambil tunnel info dari:", HTTP_SERVER_URL, e.message || e);
  }
  return null;
}

async function getLyrics(query, fallbackTitle = "") {
  const clean = (t) => String(t || "").replace(/[\[\(].*?[\]\)]/g, "").replace(/official|music|video|audio|lyrics|lirik/gi, "").trim();
  const q1 = clean(query);
  const q2 = clean(fallbackTitle);
  const candidates = [q1, query, q2, fallbackTitle].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];

  for (const q of uniqueCandidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`https://api.nexray.eu.cc/search/lyrics?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data?.status && data?.result?.lyrics) {
          const lrc = data.result.lyrics.synced_lyrics || data.result.lyrics.plain_lyrics;
          if (lrc && lrc.trim()) return lrc.trim();
        }
      }
    } catch (e) { }
  }
  return "";
}

function createMusicApp({ wssUrl, httpsUrl, initialQuery }) {
  const TARGET_WSS = wssUrl || "ws://node-1.nexhostku.com:19142/ws";
  const BASE_HTTP = httpsUrl || HTTP_SERVER_URL;
  const INIT_Q = initialQuery || "Top Hits Indonesia";

  return `
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
:root {
  --sp-bg: #121212;
  --sp-card: #282828;
  --sp-green: #1db954;
  --sp-text: #ffffff;
  --sp-subtext: #a7a7a7;
  --sp-nav: #000000;
}
* { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; -webkit-tap-highlight-color: transparent; }
html, body { background: transparent; color: var(--sp-text); min-height: 100vh; -webkit-font-smoothing: antialiased; }
.wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px 12px; }
.player { position: relative; width: 100%; max-width: 360px; height: 700px; border-radius: 16px; overflow: hidden; background: var(--sp-bg); box-shadow: 0 20px 50px rgba(0, 0, 0, .8); display: flex; flex-direction: column; }

/* SVG Helpers */
svg { fill: currentColor; }
.btn-icon { background: none; border: none; color: var(--sp-subtext); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 8px; margin: -8px; }
.btn-icon:active { color: white; transform: scale(0.95); }

/* --- HOME VIEW --- */
#home-view { display: flex; flex-direction: column; flex: 1; height: 100%; overflow: hidden; }

/* Top Header */
.h-header { padding: 16px; display: flex; flex-direction: column; gap: 16px; background: linear-gradient(180deg, rgba(40,40,40,1) 0%, rgba(18,18,18,1) 100%); }
.h-top { display: flex; align-items: center; gap: 12px; }
.h-profile { width: 32px; height: 32px; border-radius: 50%; background: #9d5b7a; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
.h-pills { display: flex; gap: 8px; }
.pill { padding: 6px 16px; border-radius: 500px; font-size: 13px; font-weight: 500; background: rgba(255,255,255,0.1); color: white; cursor: pointer; }
.pill.active { background: var(--sp-green); color: black; font-weight: 600; }
.h-search-bar { display: flex; align-items: center; background: white; border-radius: 4px; padding: 0 12px; height: 46px; }
.h-search-bar svg { width: 24px; height: 24px; color: black; }
.h-search-bar input { flex: 1; border: none; outline: none; background: transparent; padding: 0 10px; font-size: 15px; font-weight: 500; color: black; }
.h-search-bar input::placeholder { color: #555; }

/* Content List */
.h-content { flex: 1; overflow-y: auto; padding: 0 16px 120px 16px; }
.h-content::-webkit-scrollbar { display: none; }
.section-title { font-size: 22px; font-weight: 700; margin: 16px 0; letter-spacing: -0.5px; }

.song-list { display: flex; flex-direction: column; gap: 12px; }
.song-item { display: flex; align-items: center; cursor: pointer; transition: background 0.2s; border-radius: 6px; }
.song-item:active { background: rgba(255,255,255,0.1); }
.song-thumb { width: 64px; height: 64px; border-radius: 4px; object-fit: cover; margin-right: 12px; background: var(--sp-card); }
.song-info { flex: 1; min-width: 0; }
.song-title { font-size: 16px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: white; margin-bottom: 4px; }
.song-artist { font-size: 14px; color: var(--sp-subtext); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Mini Player */
#mini-player { position: absolute; bottom: 64px; left: 8px; right: 8px; background: #3c2a2a; border-radius: 6px; padding: 6px 8px; display: flex; align-items: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 10; opacity: 0; pointer-events: none; transition: opacity 0.3s, transform 0.3s; transform: translateY(10px); }
#mini-player.active { opacity: 1; pointer-events: auto; transform: translateY(0); }
.mp-art { width: 38px; height: 38px; border-radius: 4px; object-fit: cover; margin-right: 10px; }
.mp-info { flex: 1; min-width: 0; margin-right: 10px; }
.mp-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: white; }
.mp-artist { font-size: 12px; color: rgba(255,255,255,0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-controls { display: flex; align-items: center; gap: 14px; color: white; }
.mp-progress { position: absolute; bottom: 0; left: 8px; right: 8px; height: 2px; background: rgba(255,255,255,0.2); border-radius: 2px; }
.mp-fill { height: 100%; background: white; width: 0%; border-radius: 2px; }

/* Bottom Nav */
.bottom-nav { position: absolute; bottom: 0; left: 0; right: 0; height: 60px; background: rgba(0,0,0,0.9); display: flex; justify-content: space-around; align-items: center; z-index: 5; }
.nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--sp-subtext); }
.nav-item.active { color: white; }
.nav-item svg { width: 24px; height: 24px; }
.nav-item span { font-size: 10px; font-weight: 500; }

/* --- FULL PLAYER OVERLAY --- */
.overlay { position: absolute; inset: 0; background: linear-gradient(180deg, #4a4a4a 0%, #121212 100%); z-index: 50; display: flex; flex-direction: column; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.overlay.active { transform: translateY(0); }

.fp-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; }
.fp-header-text { text-align: center; flex: 1; font-size: 11px; font-weight: 700; color: white; letter-spacing: 0.5px; text-transform: uppercase; }
.fp-header-text span { font-size: 12px; font-weight: 700; text-transform: none; display: block; margin-top: 2px; }

.fp-body { padding: 0 24px; flex: 1; display: flex; flex-direction: column; }
.fp-art-wrap { flex: 1; display: flex; align-items: center; justify-content: center; margin-bottom: 24px; min-height: 0; }
.fp-art { width: 100%; max-height: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); }

.fp-lrc-preview { font-size: 16px; font-weight: 700; color: white; margin-bottom: 24px; min-height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }

.fp-info { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.fp-title { font-size: 22px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
.fp-artist { font-size: 16px; color: var(--sp-subtext); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.fp-progress-wrap { margin-bottom: 20px; }
.fp-progress { height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; position: relative; }
.fp-fill { height: 100%; background: white; width: 0%; border-radius: 2px; }
.fp-dot { position: absolute; right: -5px; top: 50%; transform: translateY(-50%); width: 10px; height: 10px; background: white; border-radius: 50%; }
.fp-times { display: flex; justify-content: space-between; font-size: 12px; color: var(--sp-subtext); margin-top: 6px; font-variant-numeric: tabular-nums; }

.fp-controls { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.btn-play { width: 64px; height: 64px; border-radius: 50%; background: white; color: black; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; }
.btn-play svg { width: 28px; height: 28px; }

.fp-bottom { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }

.fp-lrc-tab { background: #3b3b3b; color: white; padding: 12px 16px; border-radius: 12px; font-weight: 700; font-size: 14px; text-align: left; cursor: pointer; margin-bottom: 16px; }

/* --- LYRICS OVERLAY --- */
#lyrics-overlay { z-index: 100; background: rgba(0,0,0,0.9); }
.lrc-bg { position: absolute; inset: 0; background-size: cover; background-position: center; filter: blur(30px) brightness(0.4); z-index: -1; }
.lrc-scroll { flex: 1; overflow-y: auto; padding: 20px 24px 60vh; scroll-behavior: smooth; }
.lrc-scroll::-webkit-scrollbar { display: none; }
.lrc-line { font-size: 24px; font-weight: 700; color: rgba(255,255,255,0.4); margin-bottom: 24px; cursor: pointer; transition: color 0.3s; }
.lrc-line.active { color: white; }

.ws-status { position: fixed; top: 0; left: 0; right: 0; background: var(--sp-green); color: black; font-weight: 700; font-size: 12px; text-align: center; padding: 6px; z-index: 999; transform: translateY(-100%); transition: transform 0.3s; }
.ws-status.show { transform: translateY(0); }
.ws-status.error { background: #e22134; color: white; }
</style>

<div class="wrap">
<div class="player">

  <!-- HOME VIEW -->
  <div id="home-view">
    <div class="h-header">
       <div class="h-top">
          <div class="h-profile">B</div>
          <div class="h-pills">
             <span class="pill active">Semua</span>
             <span class="pill">Musik</span>
             <span class="pill">Podcast</span>
          </div>
       </div>
       <div class="h-search-bar">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="searchInput" placeholder="Apa yang ingin kamu dengarkan?" autocomplete="off">
       </div>
    </div>
    
    <div class="h-content">
       <div class="section-title" id="sectionTitle">Pencarian Teratas</div>
       <div class="song-list" id="songList"></div>
    </div>
  </div>

  <!-- MINI PLAYER -->
  <div id="mini-player">
    <img id="mp-art" class="mp-art" src=""/>
    <div class="mp-info">
       <div id="mp-title" class="mp-title">Title</div>
       <div id="mp-artist" class="mp-artist">Artist</div>
    </div>
    <div class="mp-controls">
       <!-- Decorative Device -->
       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/></svg>
       <!-- Play/Pause -->
       <div id="mp-play-btn" style="cursor:pointer">
          <svg id="mp-play-icon" width="24" height="24" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          <svg id="mp-pause-icon" width="24" height="24" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
       </div>
    </div>
    <div class="mp-progress"><div id="mp-fill" class="mp-fill"></div></div>
  </div>

  <!-- BOTTOM NAV -->
  <div class="bottom-nav">
     <div class="nav-item active">
        <svg viewBox="0 0 24 24"><path d="M12 3l9 7v11h-6v-7h-6v7H3V10l9-7z"/></svg>
        <span>Home</span>
     </div>
     <div class="nav-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span>Cari</span>
     </div>
     <div class="nav-item">
        <svg viewBox="0 0 24 24"><path d="M4 2v20h12V2H4zm2 2h8v16H6V4zm14 0h2v16h-2V4z"/></svg>
        <span>Koleksi Kamu</span>
     </div>
     <div class="nav-item">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <span>Premium</span>
     </div>
  </div>

  <!-- FULL PLAYER -->
  <div id="full-player" class="overlay">
    <div class="fp-header">
       <button class="btn-icon" id="fp-close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
       </button>
       <div class="fp-header-text">Memainkan dari Pencarian<br><span id="fp-album-title">---</span></div>
       <button class="btn-icon"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
    </div>
    
    <div class="fp-body">
       <div class="fp-art-wrap">
         <img id="fp-art" class="fp-art" src=""/>
       </div>
       
       <div class="fp-lrc-preview" id="fp-lrc-preview">...</div>
       
       <div class="fp-info">
          <div style="min-width:0; flex:1; margin-right:12px;">
             <div class="fp-title" id="fp-title">---</div>
             <div class="fp-artist" id="fp-artist">---</div>
          </div>
          <button class="btn-icon" style="color:white;"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg></button>
       </div>
       
       <div class="fp-progress-wrap">
          <div class="fp-progress" id="fp-progress">
             <div class="fp-fill" id="fp-fill"></div>
             <div class="fp-dot"></div>
          </div>
          <div class="fp-times">
             <span id="fp-time-cur">0:00</span>
             <span id="fp-time-dur">0:00</span>
          </div>
       </div>
       
       <div class="fp-controls">
          <button class="btn-icon" style="color:var(--sp-green);"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg></button>
          <button class="btn-icon" id="fp-btn-prev" style="color:white;"><svg width="32" height="32" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
          <button class="btn-play" id="fp-btn-play">
             <svg id="fp-icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
             <svg id="fp-icon-pause" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>
          <button class="btn-icon" id="fp-btn-next" style="color:white;"><svg width="32" height="32" viewBox="0 0 24 24"><path d="M16 6h2v12h-2zm-10 6l8.5 6V6z"/></svg></button>
          <button class="btn-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>
       </div>
       
       <div class="fp-bottom">
          <button class="btn-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/></svg></button>
          <div style="display:flex; gap:16px;">
             <button class="btn-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
             <button class="btn-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>
          </div>
       </div>
       
       <div class="fp-lrc-tab" id="fp-lrc-tab">
          Pratinjau lirik
       </div>
    </div>
  </div>

  <!-- LYRICS OVERLAY -->
  <div id="lyrics-overlay" class="overlay">
     <div class="lrc-bg" id="lrc-bg"></div>
     <div class="fp-header">
       <button class="btn-icon" id="lrc-close" style="color:white;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
       </button>
       <div class="fp-header-text" id="lrc-title" style="font-size: 14px; text-transform:none;">Now I Know</div>
       <button class="btn-icon" style="color:white;"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
     </div>
     <div class="lrc-scroll" id="lrc-body"></div>
  </div>
  
  <div class="ws-status" id="statusBar">Connecting...</div>
  <audio id="audio" preload="metadata"></audio>
</div>
</div>

<script>
(function() {
  const TARGET_WSS = "${TARGET_WSS}";
  const BASE_HTTP = "${BASE_HTTP}";
  const INIT_Q = "${INIT_Q}";
  const wsUrl = \`\${TARGET_WSS}?uuid=\${Math.random().toString(36).substring(2,10)}\`;
  
  let ws = null, reconnectTimer = null;
  const audio = document.getElementById('audio');
  
  // UI Elements
  const searchInput = document.getElementById('searchInput');
  const songList = document.getElementById('songList');
  const sectionTitle = document.getElementById('sectionTitle');
  const statusBar = document.getElementById('statusBar');
  
  const miniPlayer = document.getElementById('mini-player');
  const fullPlayer = document.getElementById('full-player');
  const lyricsOverlay = document.getElementById('lyrics-overlay');
  
  let activeSongId = null;
  let currentResults = [];
  let isDragging = false;
  let lyricsData = [];
  let lyricsOpen = false;
  let activeLrcIdx = -1;

  function setStatus(msg, type='info') {
      statusBar.textContent = msg;
      statusBar.className = 'ws-status show ' + (type === 'info' ? '' : type);
      if(type === 'info') setTimeout(() => { statusBar.classList.remove('show'); }, 3000);
  }

  function escapeHtml(text) {
      return (text || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function formatTime(sec) {
      if(isNaN(sec)) return "0:00";
      sec = Math.floor(sec);
      return Math.floor(sec / 60) + ":" + (sec % 60).toString().padStart(2, '0');
  }

  // (Fungsi fetchBase64 dihapus karena proses convert Base64 sekarang dilakukan di server.py untuk menghindari masalah CSP WhatsApp Web)

  function connect() {
      setStatus("Menghubungkan...", "warn");
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
          setStatus("Terhubung", "info");
          ws.send(JSON.stringify({ action: 'search', q: INIT_Q }));
      };
      ws.onmessage = (e) => {
          if (typeof e.data !== 'string') {
              if (window._audioChunks) window._audioChunks.push(e.data);
              return;
          }
          try {
              const d = JSON.parse(e.data);
              if (d.action === 'search_results') renderResults(d.q, d.list);
              if (d.action === 'song_ready') handleSongReady(d);
              if (d.action === 'song_error') setStatus("Error: " + d.message, "error");
              if (d.action === 'start_stream') {
                  window._audioChunks = [];
                  setStatus("Mengunduh stream audio...", "warn");
              }
              if (d.action === 'end_stream') {
                  const blob = new Blob(window._audioChunks, { type: 'audio/mpeg' });
                  audio.src = URL.createObjectURL(blob);
                  audio.play().catch(err => setStatus("Klik Play untuk memulai", "warn"));
                  setStatus("Memutar lagu", "info");
              }
          } catch(err) {}
      };
      ws.onclose = () => {
          setStatus("Terputus. Menghubungkan ulang...", "error");
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
  }

  function renderResults(q, list) {
      songList.innerHTML = '';
      currentResults = (list || []).slice(0, 5); // Limit to 5
      sectionTitle.textContent = q === INIT_Q ? "Pencarian Teratas" : \`Hasil untuk "\${q}"\`;
      
      if(!currentResults.length) {
          songList.innerHTML = '<div style="color:var(--sp-subtext); padding:20px; text-align:center;">Tidak ada hasil.</div>';
          return;
      }
      
      currentResults.forEach(item => {
          const div = document.createElement('div');
          div.className = 'song-item';
          const thumbSrc = item.b64 || "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
          div.innerHTML = \`
              <img class="song-thumb" id="thumb-\${item.id}" src="\${thumbSrc}">
              <div class="song-info">
                  <div class="song-title">\${escapeHtml(item.title)}</div>
                  <div class="song-artist">\${escapeHtml(item.artist)}</div>
              </div>
              <div style="padding:0 8px; color:var(--sp-subtext)">
                  <svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
              </div>
          \`;
          div.onclick = () => playSong(item);
          songList.appendChild(div);
      });
  }

  function playSong(item) {
      if (activeSongId === item.id) {
          fullPlayer.classList.add('active');
          return;
      }
      activeSongId = item.id;
      setStatus(\`Menyiapkan \${item.title}...\`, "warn");
      ws.send(JSON.stringify({ action: 'get_song', id: item.id, title: item.title, artist: item.artist }));
  }

  function parseLrc(text) {
      if(!text) return [];
      const lines = text.split(/\\r?\\n/), items = [], rgx = /\\[(\\d{2}):(\\d{2}(?:\\.\\d+)?)\\](.*)/;
      lines.forEach(line => {
          const m = line.match(rgx);
          if(m) {
              const t = parseInt(m[1])*60 + parseFloat(m[2]), s = m[3].trim();
              if(s) items.push({ time: t, text: s });
          }
      });
      return items.sort((a,b) => a.time - b.time);
  }

  async function handleSongReady(d) {
      // Setup Data
      const b64 = d.thumb_b64 || "";
      
      // Update Mini Player
      miniPlayer.classList.add('active');
      document.getElementById('mp-title').textContent = d.title;
      document.getElementById('mp-artist').textContent = d.artist;
      if(b64) document.getElementById('mp-art').src = b64;
      
      // Update Full Player
      document.getElementById('fp-album-title').textContent = d.title;
      document.getElementById('fp-title').textContent = d.title;
      document.getElementById('fp-artist').textContent = d.artist;
      document.getElementById('fp-time-dur').textContent = d.duration || "0:00";
      if(b64) {
          document.getElementById('fp-art').src = b64;
          document.getElementById('lrc-bg').style.backgroundImage = \`url(\${b64})\`;
      }
      
      // Lyrics
      lyricsData = parseLrc(d.lyrics);
      const lrcBody = document.getElementById('lrc-body');
      lrcBody.innerHTML = '';
      if(lyricsData.length) {
          lyricsData.forEach(item => {
              const div = document.createElement('div');
              div.className = 'lrc-line';
              div.textContent = item.text;
              div.onclick = () => { audio.currentTime = item.time; if(audio.paused) audio.play(); };
              lrcBody.appendChild(div);
          });
          document.getElementById('fp-lrc-preview').textContent = lyricsData[0].text;
      } else {
          document.getElementById('fp-lrc-preview').textContent = "Lirik tidak tersedia";
          lrcBody.innerHTML = '<div style="color:var(--sp-subtext); text-align:center; margin-top:50px;">Tidak ada lirik sinkron.</div>';
      }
      
      // Play Audio (Mengandalkan WebSocket Stream)
      fullPlayer.classList.add('active');
  }

  // Interactions
  miniPlayer.onclick = (e) => {
      if(e.target.closest('#mp-play-btn')) {
          if (audio.paused) audio.play(); else audio.pause();
          return;
      }
      fullPlayer.classList.add('active');
  };
  
  document.getElementById('fp-close').onclick = () => fullPlayer.classList.remove('active');
  
  document.getElementById('fp-lrc-tab').onclick = () => { lyricsOpen = true; lyricsOverlay.classList.add('active'); };
  document.getElementById('fp-lrc-preview').onclick = () => { lyricsOpen = true; lyricsOverlay.classList.add('active'); };
  document.getElementById('lrc-close').onclick = () => { lyricsOpen = false; lyricsOverlay.classList.remove('active'); };

  const playPause = () => { if(audio.src) { if(audio.paused) audio.play(); else audio.pause(); } };
  document.getElementById('fp-btn-play').onclick = playPause;

  audio.onplay = () => {
      document.getElementById('fp-icon-play').style.display = 'none';
      document.getElementById('fp-icon-pause').style.display = 'block';
      document.getElementById('mp-play-icon').style.display = 'none';
      document.getElementById('mp-pause-icon').style.display = 'block';
  };
  audio.onpause = () => {
      document.getElementById('fp-icon-play').style.display = 'block';
      document.getElementById('fp-icon-pause').style.display = 'none';
      document.getElementById('mp-play-icon').style.display = 'block';
      document.getElementById('mp-pause-icon').style.display = 'none';
  };
  audio.onerror = (e) => {
      const err = audio.error;
      const msg = err ? "Error " + err.code + ": " + err.message : "Audio error";
      setStatus(msg, "error");
  };

  function syncLyrics(time) {
      if(!lyricsData.length) return;
      let idx = -1;
      for(let i=0; i<lyricsData.length; i++) {
          if(time >= lyricsData[i].time) idx = i; else break;
      }
      if(idx !== activeLrcIdx && idx >= 0) {
          activeLrcIdx = idx;
          document.getElementById('fp-lrc-preview').textContent = lyricsData[idx].text;
          if(lyricsOpen) {
              const lines = document.getElementById('lrc-body').querySelectorAll('.lrc-line');
              lines.forEach((l, i) => {
                  if(i === idx) {
                      l.classList.add('active');
                      l.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  } else l.classList.remove('active');
              });
          }
      }
  }

  audio.ontimeupdate = () => {
      if(!isDragging && audio.duration) {
          const p = (audio.currentTime / audio.duration) * 100;
          document.getElementById('fp-fill').style.width = p + '%';
          document.getElementById('mp-fill').style.width = p + '%';
          document.getElementById('fp-time-cur').textContent = formatTime(audio.currentTime);
          syncLyrics(audio.currentTime);
      }
  };

  function seek(e, barId, fillId) {
      if(!audio.duration) return;
      const r = document.getElementById(barId).getBoundingClientRect();
      let p = (e.clientX || (e.touches && e.touches[0].clientX) - r.left) / r.width;
      p = Math.max(0, Math.min(1, p));
      document.getElementById(fillId).style.width = (p * 100) + '%';
      if(!isDragging) audio.currentTime = p * audio.duration;
  }
  
  const fpBar = document.getElementById('fp-progress');
  fpBar.onmousedown = (e) => { isDragging = true; seek(e, 'fp-progress', 'fp-fill'); };
  document.addEventListener('mousemove', (e) => { if(isDragging) seek(e, 'fp-progress', 'fp-fill'); });
  document.addEventListener('mouseup', (e) => { if(isDragging) { isDragging = false; seek(e, 'fp-progress', 'fp-fill'); } });
  fpBar.ontouchstart = (e) => { isDragging = true; seek(e, 'fp-progress', 'fp-fill'); };
  document.addEventListener('touchmove', (e) => { if(isDragging) seek(e, 'fp-progress', 'fp-fill'); });
  document.addEventListener('touchend', (e) => { if(isDragging) { isDragging = false; } });

  function doSearch() {
      const q = searchInput.value.trim();
      if (!q) return;
      songList.innerHTML = '';
      ws.send(JSON.stringify({ action: 'search', q }));
  }
  searchInput.onkeypress = (e) => { if(e.key === 'Enter') doSearch(); };

  document.getElementById('fp-btn-next').onclick = () => {
      if(!currentResults.length || !activeSongId) return;
      let idx = currentResults.findIndex(x => x.id === activeSongId);
      if(idx >= 0 && idx < currentResults.length - 1) playSong(currentResults[idx + 1]);
  };
  document.getElementById('fp-btn-prev').onclick = () => {
      if(!currentResults.length || !activeSongId) return;
      let idx = currentResults.findIndex(x => x.id === activeSongId);
      if(idx > 0) playSong(currentResults[idx - 1]);
  };
  audio.onended = () => document.getElementById('fp-btn-next').onclick();

  connect();
})();
</script>
`;
}
/* =========================================================
 * SEND MUSIC PLAYER (DENGAN CAPABILITY METADATA META AI)
 * ========================================================= */
async function sendMusicPlayer(conn, replyJid, html) {
  if (!conn?.relayMessage) throw new Error("Connection WhatsApp tidak valid");
  const { randomUUID } = await import("crypto");
  const responseId = randomUUID();
  const unifiedData = {
    response_id: responseId,
    sections: [{
      view_model: {
        primitive: { __typename: "GenAIaeacdsnwHtmlPrimitive", payload: html, trusted_sources: [] },
        __typename: "GenAISingleLayoutViewModel",
      }
    }]
  };
  await conn.relayMessage(
    replyJid,
    {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2,
        botMetadata: {
          messageDisclaimerText: "",
          botResponseId: responseId,
          capabilityMetadata: {
            capabilities: [
              "RICH_RESPONSE_UNIFIED_RESPONSE",
              "JSON_PATCH_STREAMING",
              "STREAMING_DISAGGREGATION",
              "PROGRESS_INDICATOR",
              67,
              "UNIFIED_RESPONSE_EMBEDDED_SCREENS",
              "RICH_RESPONSE_UR_BLOKS_ENABLED",
              "RICH_RESPONSE_STRUCTURED_RESPONSE"
            ]
          }
        },
      },
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [{ messageType: 2, messageText: "Music Player" }],
            unifiedResponse: { data: Buffer.from(JSON.stringify(unifiedData)).toString("base64") },
            contextInfo: {
              forwardingScore: 1,
              isForwarded: true,
              forwardedAiBotMessageInfo: { botJid: "867051314767696@bot" },
              forwardOrigin: 4,
            },
          },
        },
      },
    },
    { messageId: responseId }
  );
}

/* =========================================================
 * HANDLER
 * ========================================================= */
export const info = {
  name: "Play 3",
  menu: ["play3"],
  case: ["play3"],
  description: "YouTube Play + WSS Tunnel + Spotify Synced Lyrics HTML Player",
  hidden: false,
  owner: false,
  premium: false,
  group: false,
  private: false,
  admin: false,
  botAdmin: false,
  allowPrivate: true,
};

export default async function handler(leni) {
  const { command, args, replyJid, lenwy, msg, q, LenwyText } = leni;

  const initialQuery = q?.trim() || "Top Hits Indonesia";

  await LenwyText("🎧 *Membuka Spotify Music Player...*");

  try {
    const tunnel = await getTunnelInfo();
    const wssUrl = tunnel?.wss || null;
    const httpsUrl = tunnel?.https || null;

    const html = createMusicApp({ wssUrl, httpsUrl, initialQuery });

    await sendMusicPlayer(lenwy, replyJid, html);

  } catch (error) {
    const message = formatError(error);
    await lenwy.sendMessage(
      replyJid,
      { text: "❌ Gagal membuka Music Player.\n\n" + `> ${message}` },
      { quoted: msg }
    );
  }
}
