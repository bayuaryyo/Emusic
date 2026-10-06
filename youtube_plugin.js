import { randomUUID } from "crypto";

// ==========================================
// PENTING: Ganti ini dengan URL Server Python Anda.
// ==========================================
const HTTP_SERVER_URL = "http://178.128.96.217:8080";

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
    console.error("[YouTube Plugin] Gagal mengambil tunnel info dari:", HTTP_SERVER_URL, e.message || e);
  }
  return null;
}

function createYouTubeApp({ wssUrl, httpsUrl, initialQuery }) {
  const TARGET_WSS = wssUrl || "ws://178.128.96.217:8080/ws";
  const BASE_HTTP = httpsUrl || HTTP_SERVER_URL;
  const INIT_Q = initialQuery || "Top Hits Indonesia";

  return `
<style>
     /* YouTube Dark Theme CSS */
     body { margin: 0; padding: 0; background: #0f0f0f; color: #fff; font-family: Roboto, Arial, sans-serif; }
     header { display: flex; align-items: center; padding: 10px 15px; background: #0f0f0f; position: sticky; top: 0; z-index: 100; border-bottom: 1px solid #272727; }
     .logo { font-size: 20px; font-weight: bold; letter-spacing: -1px; display: flex; align-items: center; gap: 5px; }
     .logo svg { fill: #ff0000; width: 28px; height: 28px; }
     .search-bar { flex: 1; display: flex; margin-left: 15px; background: #121212; border: 1px solid #303030; border-radius: 20px; overflow: hidden; }
     .search-bar input { flex: 1; background: transparent; border: none; color: #fff; padding: 8px 15px; outline: none; text-align: left; direction: ltr; width: 100%; }
     .search-bar button { background: #222222; border: none; border-left: 1px solid #303030; padding: 0 15px; color: #fff; cursor: pointer; }
     
     .video-player-container { width: 100%; aspect-ratio: 16/9; background: #000; display: none; position: relative; overflow: hidden; }
     .video-player-container.active { display: block; }
     video { width: 100%; height: 100%; outline: none; background: #000; }
     .btn-zoom { position: absolute; bottom: 60px; right: 15px; background: rgba(0,0,0,0.7); color: #fff; border: none; width: 34px; height: 34px; border-radius: 50%; cursor: pointer; z-index: 10000; font-size: 16px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.5); }
     #loading-overlay svg { animation: spin 1s linear infinite; }
     @keyframes spin { 100% { transform: rotate(360deg); } }
     .video-info { padding: 15px; border-bottom: 1px solid #272727; display: none; }
     .video-info.active { display: block; }
     .video-title { font-size: 18px; font-weight: bold; margin-bottom: 8px; line-height: 1.3; }
     .video-channel { color: #aaa; font-size: 14px; display: flex; align-items: center; gap: 8px; }
     .channel-avatar { width: 32px; height: 32px; border-radius: 50%; background: #333; }
     
     .video-list { padding: 15px; }
     .video-item { display: flex; flex-direction: column; margin-bottom: 20px; cursor: pointer; }
     .video-thumb { width: 100%; aspect-ratio: 16/9; background: #222; border-radius: 12px; object-fit: cover; }
     .video-meta { display: flex; gap: 12px; margin-top: 10px; }
     .video-text { flex: 1; }
     .item-title { font-size: 15px; font-weight: 500; margin-bottom: 4px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
     .item-channel { font-size: 13px; color: #aaa; }
     
     #status-bar { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #323232; color: #fff; padding: 10px 20px; border-radius: 20px; font-size: 14px; opacity: 0; pointer-events: none; transition: 0.3s; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
     #status-bar.show { opacity: 1; bottom: 30px; }
  </style>

<div class="yt-wrapper" style="width: 100%; min-height: 700px; background: #0f0f0f; display: flex; flex-direction: column;">
  <header>
    <div class="logo">
      <svg viewBox="0 0 24 24"><path d="M21.58 7.19C21.35 6.31 20.69 5.65 19.81 5.42C18.25 5 12 5 12 5s-6.25 0-7.81.42c-.88.23-1.54.89-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81c.23.88.89 1.54 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42c.88-.23 1.54-.89 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81z" fill="#ff0000"/><path d="M10 15l5-3-5-3v6z" fill="#fff"/></svg>
      EscaTube
    </div>
    <div class="search-bar">
      <input type="text" id="searchInput" placeholder="Telusuri...">
      <button id="searchBtn"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></button>
    </div>
  </header>
  
  <div class="video-player-container" id="player-container">
    <div id="loading-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);color:#fff;display:none;align-items:center;justify-content:center;z-index:50;font-size:14px;flex-direction:column;gap:10px;">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
      Sedang Mengunduh Video... (Harap Tunggu)
    </div>
    <video id="video-element" controls playsinline></video>
    <button id="btn-zoom" class="btn-zoom" title="Layar Penuh" style="display:none;">⛶</button>
  </div>
  <div class="video-info" id="video-info">
    <div class="video-title" id="info-title">---</div>
    <div class="video-channel">
       <div class="channel-avatar"></div>
       <span id="info-channel">---</span>
    </div>
  </div>
  
  <div class="video-list" id="video-list"></div>
  <div id="status-bar"></div>

<script>
(() => {
  const TARGET_WSS = "${TARGET_WSS}";
  const BASE_HTTP = "${BASE_HTTP}";
  const INIT_Q = ${JSON.stringify(INIT_Q)};
  const DIRECT_WS = "ws://178.128.96.217:8080/ws";
  let ws = null, reconnectTimer = null, attempt = 0;
  
  const videoEl = document.getElementById('video-element');
  const statusBar = document.getElementById('status-bar');
  const videoList = document.getElementById('video-list');
  const searchInput = document.getElementById('searchInput');

  function setStatus(msg, type="info") {
      if (!statusBar) return;
      statusBar.textContent = msg;
      statusBar.className = 'show ' + (type === 'info' ? '' : type);
      if(type === 'info') setTimeout(() => { statusBar.classList.remove('show'); }, 3000);
  }

  function escapeHtml(text) {
      return (text || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function connect() {
      setStatus("Menghubungkan...", "warn");
      try {
          if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
              return;
          }
          // Pilih target: coba Cloudflare WSS dulu, jika gagal switch coba direct WS
          const isDirect = (attempt % 2 !== 0) || !TARGET_WSS || TARGET_WSS.includes('undefined');
          const target = isDirect ? DIRECT_WS : TARGET_WSS;
          const wsUrl = target + (target.includes('?') ? '&' : '?') + 'uuid=' + Math.random().toString(36).substring(2,10);

          ws = new WebSocket(wsUrl);
          ws.onopen = () => {
              attempt = 0;
              setStatus("Terhubung", "info");
              ws.send(JSON.stringify({ action: 'search', q: INIT_Q }));
          };
          ws.onmessage = (e) => {
              if (typeof e.data !== 'string') {
                  if (window._videoChunks) window._videoChunks.push(e.data);
                  return;
              }
              try {
                  const d = JSON.parse(e.data);
                  if (d.action === 'search_results') renderResults(d.list);
                  if (d.action === 'video_ready') handleVideoReady(d);
                  if (d.action === 'video_error') setStatus("Error: " + d.message, "error");
                  
                  if (d.action === 'start_stream') {
                      window._videoChunks = [];
                      const loader = document.getElementById('loading-overlay');
                      if (loader) loader.style.display = 'flex';
                      setStatus("Mengunduh video...", "warn");
                  }
                  if (d.action === 'end_stream') {
                      const blob = new Blob(window._videoChunks, { type: 'video/mp4' });
                      videoEl.src = URL.createObjectURL(blob);
                      const loader = document.getElementById('loading-overlay');
                      if (loader) loader.style.display = 'none';
                      videoEl.play().catch(err => setStatus("Klik Play untuk memulai", "warn"));
                      setStatus("Memutar video", "info");
                  }
              } catch(err) {}
          };
          ws.onclose = () => {
              attempt++;
              setStatus("Terputus. Menghubungkan ulang...", "error");
              clearTimeout(reconnectTimer);
              reconnectTimer = setTimeout(connect, 2500);
          };
          ws.onerror = (err) => {
              attempt++;
              try { ws.close(); } catch(e) {}
          };
      } catch (err) {
          attempt++;
          setStatus("Koneksi gagal. Menghubungkan ulang...", "error");
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 3000);
      }
  }

  function renderResults(list) {
      videoList.innerHTML = '';
      if(!list || !list.length) {
          videoList.innerHTML = '<div style="color:#aaa; text-align:center; padding:20px;">Tidak ada hasil.</div>';
          return;
      }
      
      list.forEach(item => {
          const div = document.createElement('div');
          div.className = 'video-item';
          const thumbSrc = item.b64 || "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
          div.innerHTML = \`
              <img class="video-thumb" src="\${thumbSrc}">
              <div class="video-meta">
                  <div class="channel-avatar"></div>
                  <div class="video-text">
                      <div class="item-title">\${escapeHtml(item.title)}</div>
                      <div class="item-channel">\${escapeHtml(item.artist)} • \${escapeHtml(item.duration)}</div>
                  </div>
              </div>
          \`;
          div.onclick = () => playVideo(item);
          videoList.appendChild(div);
      });
  }

  function playVideo(item) {
      const wrapper = document.querySelector('.yt-wrapper');
      if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth' });
      
      setStatus(\`Menyiapkan \${item.title}...\`, "warn");
      document.getElementById('info-title').textContent = item.title;
      document.getElementById('info-channel').textContent = item.artist;
      ws.send(JSON.stringify({ action: 'get_video', id: item.id, title: item.title, artist: item.artist }));
  }

  function handleVideoReady(d) {
      document.getElementById('player-container').classList.add('active');
      document.getElementById('video-info').classList.add('active');
      setStatus("Menyiapkan aliran video...", "warn");
  }

  function doSearch() {
      const q = searchInput.value.trim();
      if (!q) return;
      videoList.innerHTML = '';
      ws.send(JSON.stringify({ action: 'search', q }));
  }
  searchInput.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.keyCode === 13) doSearch(); });
  document.getElementById('searchBtn').onclick = doSearch;
  
  let modeGede = false;
  
  document.getElementById('btn-zoom').onclick = () => {
      modeGede = !modeGede;
      const container = document.getElementById('player-container');
      const btn = document.getElementById('btn-zoom');
      const uiElements = document.querySelectorAll('header, .video-info, .video-list');
      
      if (modeGede) {
          btn.textContent = '⤡';
          uiElements.forEach(el => el.style.display = 'none');
          
          container.style.position = 'fixed';
          container.style.top = '0';
          container.style.left = '0';
          container.style.width = window.innerWidth + 'px';
          container.style.height = window.innerHeight + 'px';
          container.style.zIndex = '9999';
          
          videoEl.style.position = 'absolute';
          videoEl.style.top = '50%';
          videoEl.style.left = '50%';
          videoEl.style.width = window.innerHeight + 'px';
          videoEl.style.height = window.innerWidth + 'px';
          videoEl.style.transform = 'translate(-50%, -50%) rotate(90deg)';
          videoEl.style.objectFit = 'contain';
      } else {
          btn.textContent = '⛶';
          uiElements.forEach(el => el.style.display = '');
          
          container.style.position = '';
          container.style.top = '';
          container.style.left = '';
          container.style.width = '100%';
          container.style.height = '';
          container.style.zIndex = '';
          
          videoEl.style.position = '';
          videoEl.style.top = '';
          videoEl.style.left = '';
          videoEl.style.width = '100%';
          videoEl.style.height = '100%';
          videoEl.style.transform = '';
          videoEl.style.objectFit = '';
          
          const wrapper = document.querySelector('.yt-wrapper');
          if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth' });
      }
  };

  videoEl.onplay = () => { document.getElementById('btn-zoom').style.display = 'flex'; };

  connect();
})();
</script>
</div>
`;
}

async function sendYouTubePlayer(conn, replyJid, html, quotedMsg) {
  if (!conn?.relayMessage) throw new Error("Connection WhatsApp tidak valid");
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
            submessages: [{ messageType: 2, messageText: "YouTube Player" }],
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
    { messageId: responseId, quoted: quotedMsg }
  );
}

function formatError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

export const info = {
  name: "YouTube Clone",
  menu: ["yt", "nonton", "ytapp"],
  case: ["yt", "nonton", "ytapp"],
  description: "YouTube Clone + HTTP Streaming HTML Player",
  hidden: false,
  owner: false,
  admin: false,
  allowPrivate: true,
};

export default async function handler(leni) {
  const { replyJid, lenwy, msg, q, LenwyText, LenwyWait, len } = leni;
  const initialQuery = q?.trim() || "Top Hits Indonesia";

  if (typeof LenwyWait === "function") await LenwyWait();
  else if (typeof LenwyText === "function") await LenwyText("📺 *Membuka YouTube Player...*");

  try {
    const tunnel = await getTunnelInfo();
    const wssUrl = tunnel?.wss || "ws://178.128.96.217:8080/ws";
    const httpsUrl = tunnel?.https || HTTP_SERVER_URL;

    const html = createYouTubeApp({ wssUrl, httpsUrl, initialQuery });
    await sendYouTubePlayer(lenwy, replyJid, html, len || msg);

  } catch (error) {
    const message = formatError(error);
    await lenwy.sendMessage(
      replyJid,
      { text: "❌ Gagal membuka YouTube Player.\n\n" + `> ${message} ` },
      { quoted: len || msg }
    );
  }
}

