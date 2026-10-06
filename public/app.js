// =========================================================
// SPOTIFY WEB PLAYER LOGIC • ESCANOR STREAM
// Full Desktop & Mobile Experience, WebSocket & REST Engine
// =========================================================

let ws = null;
let activeMode = 'music'; // 'music' | 'video'
let currentSong = null;
let currentPlaylist = [];
let currentPlaylistIndex = -1;
let isShuffle = false;
let repeatMode = 'off'; // 'off' | 'all' | 'one'
let parsedLyrics = [];
let currentLyricIndex = -1;
let isMuted = false;
let previousVolume = 1;

// DOM ELEMENTS - AUDIO & VIDEO
const audio = document.getElementById('native-audio');
const video = document.getElementById('video-player');

// DOM ELEMENTS - DESKTOP PLAYER
const dockPlayer = document.getElementById('dock-player');
const dockThumb = document.getElementById('dock-thumb');
const dockTitle = document.getElementById('dock-title');
const dockArtist = document.getElementById('dock-artist');
const dockScrubFill = document.getElementById('dock-scrub-fill');
const dockScrubBar = document.getElementById('dock-scrub-bar');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const btnPlayToggle = document.getElementById('btn-play-toggle');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnLike = document.getElementById('btn-like');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const volSlider = document.getElementById('vol-slider');
const btnVolMute = document.getElementById('btn-volume-mute');
const iconVolHigh = document.getElementById('icon-vol-high');
const iconVolMute = document.getElementById('icon-vol-mute');

// DOM ELEMENTS - MOBILE PLAYER
const mobileMiniPlayer = document.getElementById('mobile-mini-player');
const miniThumb = document.getElementById('mini-thumb');
const miniTitle = document.getElementById('mini-title');
const miniArtist = document.getElementById('mini-artist');
const miniIconPlay = document.getElementById('mini-icon-play');
const miniIconPause = document.getElementById('mini-icon-pause');
const miniProgressFill = document.getElementById('mini-progress-fill');
const miniBtnLike = document.getElementById('mini-btn-like');

const mobileFullPlayer = document.getElementById('mobile-full-player');
const mobileFullArt = document.getElementById('mobile-full-art');
const mobileFullTitle = document.getElementById('mobile-full-title');
const mobileFullArtist = document.getElementById('mobile-full-artist');
const mobileFullLike = document.getElementById('mobile-full-like');
const mobileScrubFill = document.getElementById('mobile-scrub-fill');
const mobileTimeCurrent = document.getElementById('mobile-time-current');
const mobileTimeTotal = document.getElementById('mobile-time-total');
const mobileIconPlay = document.getElementById('mobile-icon-play');
const mobileIconPause = document.getElementById('mobile-icon-pause');
const mobileBtnShuffle = document.getElementById('mobile-btn-shuffle');
const mobileBtnRepeat = document.getElementById('mobile-btn-repeat');
const mobileLyricsSnippet = document.getElementById('mobile-lyrics-snippet');

// DOM ELEMENTS - APP
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const resultsGrid = document.getElementById('results-grid');
const resultsCount = document.getElementById('results-count');
const libraryList = document.getElementById('library-list');
const islandDot = document.getElementById('island-dot');
const islandWave = document.getElementById('island-wave');
const islandStatus = document.getElementById('island-status');
const toastEl = document.getElementById('ios-toast');
const lyricsSheet = document.getElementById('lyrics-sheet');
const lyricsContentList = document.getElementById('lyrics-content-list');
const lyricsScroll = document.getElementById('lyrics-scroll');
const lyricsCoverArt = document.getElementById('lyrics-cover-art');
const lyricsSongTitle = document.getElementById('lyrics-song-title');
const lyricsSongArtist = document.getElementById('lyrics-song-artist');
const heroBanner = document.getElementById('hero-banner');
const greetingText = document.getElementById('greeting-text');

// =========================================================
// 1. THEME & GREETING MANAGEMENT
// =========================================================
function initTheme() {
    const savedTheme = localStorage.getItem('escanor_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('escanor_theme', newTheme);
    showToast(`Mode ${newTheme === 'dark' ? 'Gelap Spotify' : 'Terang'} diaktifkan`);
}

function updateGreeting() {
    const hours = new Date().getHours();
    let greet = 'Selamat Datang';
    if (hours >= 4 && hours < 11) greet = 'Selamat Pagi';
    else if (hours >= 11 && hours < 15) greet = 'Selamat Siang';
    else if (hours >= 15 && hours < 18) greet = 'Selamat Sore';
    else greet = 'Selamat Malam';
    if (greetingText) greetingText.textContent = greet;
}

initTheme();
updateGreeting();

// =========================================================
// 2. TOAST NOTIFICATION
// =========================================================
let toastTimeout = null;
function showToast(msg, duration = 2500) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// =========================================================
// 3. BACKEND CONFIGURATION (VERCEL & VPS AUTO-DETECTION)
// =========================================================
const DEFAULT_VPS_HOST = "178.128.96.217:8080";
const DEFAULT_SECURE_TUNNEL = "https://178.128.96.217.sslip.io/escanor";

function getBackendConfig() {
    const hostname = window.location.hostname;
    const isVercelOrRemote = hostname.includes('vercel.app') || 
                             hostname.includes('netlify.app') || 
                             hostname.includes('github.io') ||
                             hostname.includes('pages.dev');

    const saved = localStorage.getItem('escanor_custom_backend');
    if (saved) {
        const clean = saved.trim().replace(/\/+$/, '');
        const isSecure = clean.startsWith('https://') || clean.startsWith('wss://');
        const hostOnly = clean.replace(/^(https?|wss?):\/\//, '');
        return {
            http: (isSecure ? 'https://' : 'http://') + hostOnly,
            ws: (isSecure ? 'wss://' : 'ws://') + hostOnly + '/ws'
        };
    }

    if (isVercelOrRemote) {
        return {
            http: DEFAULT_SECURE_TUNNEL,
            ws: "wss://178.128.96.217.sslip.io/escanor/ws"
        };
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return {
        http: `${window.location.protocol}//${window.location.host}`,
        ws: `${proto}//${window.location.host}/ws`
    };
}

function apiUrl(path) {
    const config = getBackendConfig();
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return `${config.http.replace(/\/+$/, '')}${cleanPath}`;
}

function resolveMediaUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return apiUrl(url);
}

// =========================================================
// 4. WEBSOCKET ENGINE & AUTO-RECONNECT
// =========================================================
function connectWS() {
    const config = getBackendConfig();
    const wsUrl = config.ws;

    if (islandStatus) islandStatus.textContent = "Menghubungkan...";
    if (islandDot) islandDot.className = "status-dot buffering";
    if (islandWave) islandWave.classList.remove('active');

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            if (islandStatus) islandStatus.textContent = "Online";
            if (islandDot) islandDot.className = "status-dot";
            console.log("WebSocket connected to:", wsUrl);
            // Default initial query
            ws.send(JSON.stringify({ action: "search", q: "Top Hits Indonesia 2026" }));
        };

        ws.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const data = JSON.parse(event.data);
                    handleWsEvent(data);
                } catch (e) {
                    console.log("WS text message:", event.data);
                }
            }
        };

        ws.onclose = () => {
            if (islandStatus) islandStatus.textContent = "Terputus";
            if (islandDot) islandDot.className = "status-dot offline";
            if (islandWave) islandWave.classList.remove('active');
            setTimeout(connectWS, 4000);
        };

        ws.onerror = (err) => {
            console.error("WS error:", err);
            ws.close();
        };
    } catch (err) {
        setTimeout(connectWS, 5000);
    }
}

function handleWsEvent(data) {
    const action = data.action || data.t;

    if (action === 'search_results' || action === 'search') {
        const list = data.list || data.results || [];
        renderSearchResults(list, data.q || data.query || '');
    } else if (action === 'song_ready' || action === 'song_info') {
        playTrackData(data);
    } else if (action === 'video_ready' || action === 'video_info') {
        playVideoData(data);
    } else if (action === 'lyrics') {
        handleLyricsResponse(data.lyrics);
    } else if (action === 'error' || action === 'song_error') {
        showToast(data.message || 'Gagal memproses lagu');
        if (islandDot) islandDot.className = "status-dot";
    }
}

// =========================================================
// 5. SEARCH & RESULTS RENDERING
// =========================================================
let searchDebounceTimer = null;

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (searchClear) searchClear.style.display = val ? 'block' : 'none';

        clearTimeout(searchDebounceTimer);
        if (val.length >= 3) {
            searchDebounceTimer = setTimeout(() => doSearch(), 600);
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            clearTimeout(searchDebounceTimer);
            doSearch();
        }
    });
}

function clearSearchInput() {
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    if (searchClear) searchClear.style.display = 'none';
}

function focusSearchInput() {
    switchMainTab('search');
    if (searchInput) {
        searchInput.focus();
        searchInput.select();
    }
}

function quickSearch(query) {
    if (searchInput) {
        searchInput.value = query;
        if (searchClear) searchClear.style.display = 'block';
    }
    doSearch(query);
}

function doSearch(overrideQuery) {
    const query = overrideQuery || (searchInput ? searchInput.value.trim() : '');
    if (!query) return;

    if (resultsCount) resultsCount.textContent = "Mencari...";
    renderSkeletons();

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "search", q: query }));
    } else {
        fetch(apiUrl(`/api/search?q=${encodeURIComponent(query)}`))
            .then(res => res.json())
            .then(data => {
                const list = data.list || data.results || [];
                renderSearchResults(list, query);
            })
            .catch(() => {
                showToast("Gagal melakukan pencarian");
                if (resultsCount) resultsCount.textContent = "Gagal";
            });
    }
}

function renderSkeletons() {
    if (!resultsGrid) return;
    let html = '';
    for (let i = 0; i < 8; i++) {
        html += `
        <div class="spotify-card skeleton">
            <div class="card-art-box"><div class="skeleton-box"></div></div>
            <div class="skeleton-line" style="width:85%"></div>
            <div class="skeleton-line" style="width:50%"></div>
        </div>`;
    }
    resultsGrid.innerHTML = html;
}

function renderSearchResults(items, query) {
    if (!resultsGrid) return;
    currentPlaylist = items;

    if (!items || items.length === 0) {
        resultsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-subdued);">
            <h3>Lagu tidak ditemukan</h3>
            <p style="font-size: 13px; margin-top: 6px;">Coba gunakan kata kunci artis atau judul yang lebih spesifik.</p>
        </div>`;
        if (resultsCount) resultsCount.textContent = "0 Hasil";
        return;
    }

    if (resultsCount) resultsCount.textContent = `${items.length} Lagu`;
    const heading = document.getElementById('section-heading-text');
    if (heading) heading.textContent = query ? `Hasil untuk "${query}"` : "Lagu Rekomendasi";

    let html = '';
    items.forEach((item, index) => {
        const thumb = item.b64 || item.thumb || item.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80';
        const title = escapeHtml(item.title || 'Untitled');
        const artist = escapeHtml(item.artist || item.channel || 'Artis');

        html += `
        <div class="spotify-card" onclick="selectPlayTrack(${index})">
            <div class="card-art-box">
                <img class="card-cover-img" src="${thumb}" alt="${title}" loading="lazy">
                <button class="card-floating-play" title="Putar" onclick="event.stopPropagation(); selectPlayTrack(${index});">
                    <svg viewBox="0 0 24 24"><polygon points="8,5 19,12 8,19"/></svg>
                </button>
            </div>
            <div class="card-title-text" title="${title}">${title}</div>
            <div class="card-artist-text" title="${artist}">${artist}</div>
        </div>`;
    });

    resultsGrid.innerHTML = html;
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

// =========================================================
// 6. PLAYBACK ENGINE & TRACK SELECTION
// =========================================================
function selectPlayTrack(index) {
    if (index < 0 || index >= currentPlaylist.length) return;
    currentPlaylistIndex = index;
    const item = currentPlaylist[index];
    const ytId = item.id;

    if (!ytId) return;

    if (islandStatus) islandStatus.textContent = "Memuat...";
    if (islandDot) islandDot.className = "status-dot buffering";
    showToast(`Memutar: ${item.title}`);

    // Update UI immediately with thumbnail & title
    updateTrackDisplay(item);

    // Save to library history
    saveToLibrary(item);

    if (activeMode === 'video') {
        requestVideo(ytId, item.title, item.artist);
    } else {
        requestSong(ytId, item.title, item.artist);
    }
}

function requestSong(id, title, artist) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "get_song", id: id, title: title || "", artist: artist || "" }));
    } else {
        fetch(apiUrl(`/api/song?id=${encodeURIComponent(id)}`))
            .then(res => res.json())
            .then(data => playTrackData(data))
            .catch(() => showToast("Gagal memuat audio"));
    }
}

function requestVideo(id, title, artist) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "get_video", id: id, title: title || "", artist: artist || "" }));
    } else {
        fetch(apiUrl(`/api/video?id=${encodeURIComponent(id)}`))
            .then(res => res.json())
            .then(data => playVideoData(data))
            .catch(() => showToast("Gagal memuat video"));
    }
}

function playTrackData(data) {
    currentSong = data;
    const mediaUrl = resolveMediaUrl(data.audioUrl || data.streamUrl || data.proxyUrl);

    if (!mediaUrl) {
        showToast("Sumber audio tidak tersedia");
        return;
    }

    updateTrackDisplay(data);
    parseLyrics(data.lyrics || "");

    audio.src = mediaUrl;
    audio.play().then(() => {
        setPlayingState(true);
    }).catch(err => {
        console.warn("Auto-play prevented:", err);
        setPlayingState(false);
    });

    updateMediaSession(data);
    updateAmbientColor(data.thumbnail);
}

function playVideoData(data) {
    currentSong = data;
    const videoUrl = resolveMediaUrl(data.videoUrl || data.proxyUrl);

    updateTrackDisplay(data);

    const vidContainer = document.getElementById('video-container-view');
    const vidTitle = document.getElementById('video-title');
    const vidArtist = document.getElementById('video-artist');

    if (vidContainer) vidContainer.style.display = 'block';
    if (vidTitle) vidTitle.textContent = data.title || 'Video';
    if (vidArtist) vidArtist.textContent = data.artist || data.channel || 'Channel';

    if (video) {
        video.src = videoUrl;
        video.play();
    }
    audio.pause();
    setPlayingState(true);
}

function updateTrackDisplay(item) {
    const thumb = item.b64 || item.thumb || item.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80';
    const title = item.title || 'Pilih Lagu';
    const artist = item.artist || item.channel || 'Escanor Stream';

    // Desktop
    if (dockThumb) dockThumb.src = thumb;
    if (dockTitle) dockTitle.textContent = title;
    if (dockArtist) dockArtist.textContent = artist;

    // Mobile Mini Player
    if (miniThumb) miniThumb.src = thumb;
    if (miniTitle) miniTitle.textContent = title;
    if (miniArtist) miniArtist.textContent = artist;

    // Mobile Full Player
    if (mobileFullArt) mobileFullArt.src = thumb;
    if (mobileFullTitle) mobileFullTitle.textContent = title;
    if (mobileFullArtist) mobileFullArtist.textContent = artist;

    // Lyrics Header
    if (lyricsCoverArt) lyricsCoverArt.src = thumb;
    if (lyricsSongTitle) lyricsSongTitle.textContent = title;
    if (lyricsSongArtist) lyricsSongArtist.textContent = artist;

    // Update heart state
    checkLikedState(item.id);
}

function setPlayingState(playing) {
    if (playing) {
        if (iconPlay) iconPlay.style.display = 'none';
        if (iconPause) iconPause.style.display = 'block';
        if (miniIconPlay) miniIconPlay.style.display = 'none';
        if (miniIconPause) miniIconPause.style.display = 'block';
        if (mobileIconPlay) mobileIconPlay.style.display = 'none';
        if (mobileIconPause) mobileIconPause.style.display = 'block';
        if (islandWave) islandWave.classList.add('active');
        if (islandDot) islandDot.className = "status-dot";
        if (islandStatus) islandStatus.textContent = "Memutar";
    } else {
        if (iconPlay) iconPlay.style.display = 'block';
        if (iconPause) iconPause.style.display = 'none';
        if (miniIconPlay) miniIconPlay.style.display = 'block';
        if (miniIconPause) miniIconPause.style.display = 'none';
        if (mobileIconPlay) mobileIconPlay.style.display = 'block';
        if (mobileIconPause) mobileIconPause.style.display = 'none';
        if (islandWave) islandWave.classList.remove('active');
        if (islandStatus) islandStatus.textContent = "Dijeda";
    }
}

function togglePlayPause() {
    if (activeMode === 'video' && video) {
        if (video.paused) {
            video.play();
            setPlayingState(true);
        } else {
            video.pause();
            setPlayingState(false);
        }
        return;
    }

    if (!audio.src) {
        if (currentPlaylist.length > 0) {
            selectPlayTrack(0);
        } else {
            showToast("Pilih lagu terlebih dahulu");
        }
        return;
    }

    if (audio.paused) {
        audio.play().then(() => setPlayingState(true));
    } else {
        audio.pause();
        setPlayingState(false);
    }
}

function handleNextBtn() {
    if (currentPlaylist.length === 0) return;

    if (isShuffle) {
        currentPlaylistIndex = Math.floor(Math.random() * currentPlaylist.length);
    } else {
        currentPlaylistIndex = (currentPlaylistIndex + 1) % currentPlaylist.length;
    }
    selectPlayTrack(currentPlaylistIndex);
}

function handlePrevBtn() {
    if (currentPlaylist.length === 0) return;

    if (audio.currentTime > 4) {
        audio.currentTime = 0;
        return;
    }

    currentPlaylistIndex = (currentPlaylistIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    selectPlayTrack(currentPlaylistIndex);
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    if (btnShuffle) btnShuffle.classList.toggle('active', isShuffle);
    if (mobileBtnShuffle) mobileBtnShuffle.classList.toggle('active', isShuffle);
    showToast(isShuffle ? "Acak lagu aktif" : "Acak lagu dinonaktifkan");
}

function toggleRepeat() {
    if (repeatMode === 'off') {
        repeatMode = 'all';
        showToast("Ulangi seluruh playlist");
    } else if (repeatMode === 'all') {
        repeatMode = 'one';
        showToast("Ulangi lagu ini saja");
    } else {
        repeatMode = 'off';
        showToast("Ulangi dinonaktifkan");
    }

    const isActive = repeatMode !== 'off';
    if (btnRepeat) {
        btnRepeat.classList.toggle('active', isActive);
        btnRepeat.title = `Ulangi: ${repeatMode}`;
    }
    if (mobileBtnRepeat) {
        mobileBtnRepeat.classList.toggle('active', isActive);
    }
}

// =========================================================
// 7. TIMELINE SCRUBBING & TIME FORMATTING
// =========================================================
audio.addEventListener('timeupdate', () => {
    const cur = audio.currentTime || 0;
    const dur = audio.duration || 0;

    if (dur > 0) {
        const percent = (cur / dur) * 100;
        if (dockScrubFill) dockScrubFill.style.width = `${percent}%`;
        if (miniProgressFill) miniProgressFill.style.width = `${percent}%`;
        if (mobileScrubFill) mobileScrubFill.style.width = `${percent}%`;

        if (timeCurrent) timeCurrent.textContent = formatTime(cur);
        if (timeTotal) timeTotal.textContent = formatTime(dur);
        if (mobileTimeCurrent) mobileTimeCurrent.textContent = formatTime(cur);
        if (mobileTimeTotal) mobileTimeTotal.textContent = formatTime(dur);

        syncLyrics(cur);
    }
});

audio.addEventListener('ended', () => {
    if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play();
    } else {
        handleNextBtn();
    }
});

function handleSeek(e) {
    if (!audio.duration || !dockScrubBar) return;
    const rect = dockScrubBar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pos * audio.duration;
}

function handleSeekMobile(e) {
    const track = document.getElementById('mobile-scrub-track');
    if (!audio.duration || !track) return;
    const rect = track.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pos * audio.duration;
}

function formatTime(sec) {
    if (isNaN(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// =========================================================
// 8. VOLUME & MUTE CONTROLS
// =========================================================
function handleVolume(val) {
    const v = parseFloat(val);
    audio.volume = v;
    if (v === 0) {
        isMuted = true;
        if (iconVolHigh) iconVolHigh.style.display = 'none';
        if (iconVolMute) iconVolMute.style.display = 'block';
    } else {
        isMuted = false;
        previousVolume = v;
        if (iconVolHigh) iconVolHigh.style.display = 'block';
        if (iconVolMute) iconVolMute.style.display = 'none';
    }
}

function toggleMute() {
    if (isMuted) {
        audio.volume = previousVolume || 1;
        if (volSlider) volSlider.value = audio.volume;
        isMuted = false;
        if (iconVolHigh) iconVolHigh.style.display = 'block';
        if (iconVolMute) iconVolMute.style.display = 'none';
    } else {
        previousVolume = audio.volume;
        audio.volume = 0;
        if (volSlider) volSlider.value = 0;
        isMuted = true;
        if (iconVolHigh) iconVolHigh.style.display = 'none';
        if (iconVolMute) iconVolMute.style.display = 'block';
    }
}

// =========================================================
// 9. SPOTIFY KARAOKE SYNCHRONIZED LYRICS
// =========================================================
function parseLyrics(lrcText) {
    parsedLyrics = [];
    currentLyricIndex = -1;

    if (!lrcText || typeof lrcText !== 'string') {
        renderLyricsUI();
        return;
    }

    const lines = lrcText.split('\n');
    const regex = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\](.*)/;

    lines.forEach(line => {
        const match = line.match(regex);
        if (match) {
            const min = parseFloat(match[1]);
            const sec = parseFloat(match[2]);
            const text = match[3].trim();
            if (text) {
                parsedLyrics.push({ time: min * 60 + sec, text: text });
            }
        }
    });

    renderLyricsUI();
}

function renderLyricsUI() {
    if (!lyricsContentList) return;

    if (parsedLyrics.length === 0) {
        lyricsContentList.innerHTML = `
        <div class="lyrics-placeholder">
            Lirik tidak tersedia untuk lagu ini.
        </div>`;
        if (mobileLyricsSnippet) mobileLyricsSnippet.textContent = "Lirik tidak tersedia.";
        return;
    }

    let html = '';
    parsedLyrics.forEach((item, index) => {
        html += `<div class="lyric-line-item" id="lyric-line-${index}" onclick="jumpToLyricTime(${item.time})">${escapeHtml(item.text)}</div>`;
    });
    lyricsContentList.innerHTML = html;
}

function syncLyrics(currTime) {
    if (parsedLyrics.length === 0) return;

    let activeIdx = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
        if (currTime >= parsedLyrics[i].time - 0.25) {
            activeIdx = i;
        } else {
            break;
        }
    }

    if (activeIdx !== currentLyricIndex) {
        if (currentLyricIndex !== -1) {
            const oldEl = document.getElementById(`lyric-line-${currentLyricIndex}`);
            if (oldEl) oldEl.classList.remove('active');
        }

        currentLyricIndex = activeIdx;

        if (currentLyricIndex !== -1) {
            const newEl = document.getElementById(`lyric-line-${currentLyricIndex}`);
            if (newEl) {
                newEl.classList.add('active');
                if (lyricsScroll) {
                    const scrollOffset = newEl.offsetTop - lyricsScroll.clientHeight / 2 + newEl.clientHeight / 2;
                    lyricsScroll.scrollTo({ top: scrollOffset, behavior: 'smooth' });
                }
            }

            if (mobileLyricsSnippet && parsedLyrics[currentLyricIndex]) {
                mobileLyricsSnippet.textContent = parsedLyrics[currentLyricIndex].text;
            }
        }
    }
}

function jumpToLyricTime(time) {
    audio.currentTime = time;
}

function toggleLyrics() {
    if (!lyricsSheet) return;
    const isShowing = lyricsSheet.classList.contains('show');
    if (isShowing) {
        lyricsSheet.classList.remove('show');
    } else {
        lyricsSheet.classList.add('show');
        if (currentLyricIndex !== -1 && lyricsScroll) {
            const el = document.getElementById(`lyric-line-${currentLyricIndex}`);
            if (el) {
                lyricsScroll.scrollTo({ top: el.offsetTop - 150, behavior: 'smooth' });
            }
        }
    }
}

function handleLyricsResponse(rawLyrics) {
    if (rawLyrics) {
        parseLyrics(rawLyrics);
    }
}

// =========================================================
// 10. SPOTIFY LIBRARY & FAVORITES (KOLEKSI KAMU)
// =========================================================
function getFavorites() {
    try {
        return JSON.parse(localStorage.getItem('escanor_favorites') || '[]');
    } catch {
        return [];
    }
}

function saveFavorites(favs) {
    localStorage.setItem('escanor_favorites', JSON.stringify(favs));
}

function checkLikedState(songId) {
    if (!songId) return;
    const favs = getFavorites();
    const isLiked = favs.some(f => f.id === songId);

    if (btnLike) btnLike.classList.toggle('liked', isLiked);
    if (miniBtnLike) miniBtnLike.classList.toggle('liked', isLiked);
    if (mobileFullLike) mobileFullLike.classList.toggle('liked', isLiked);
}

function toggleLikeCurrentSong() {
    if (!currentSong || !currentSong.id) return;
    let favs = getFavorites();
    const idx = favs.findIndex(f => f.id === currentSong.id);

    if (idx >= 0) {
        favs.splice(idx, 1);
        showToast("Dihapus dari Koleksi Kamu");
    } else {
        favs.unshift(currentSong);
        showToast("Disimpan ke Koleksi Kamu");
    }

    saveFavorites(favs);
    checkLikedState(currentSong.id);
    renderLibraryList('likes');
}

function saveToLibrary(track) {
    try {
        let history = JSON.parse(localStorage.getItem('escanor_history') || '[]');
        history = history.filter(h => h.id !== track.id);
        history.unshift(track);
        if (history.length > 30) history.pop();
        localStorage.setItem('escanor_history', JSON.stringify(history));
        renderLibraryList('all');
    } catch {}
}

function renderLibraryList(filter = 'all') {
    if (!libraryList) return;

    let items = [];
    if (filter === 'likes') {
        items = getFavorites();
    } else {
        try {
            items = JSON.parse(localStorage.getItem('escanor_history') || '[]');
        } catch { items = []; }
    }

    if (items.length === 0) {
        libraryList.innerHTML = `
        <div class="library-empty">
            <p>${filter === 'likes' ? 'Belum ada lagu disukai' : 'Belum ada riwayat lagu'}</p>
            <small>Putar lagu atau klik ikon hati untuk menyimpan.</small>
        </div>`;
        return;
    }

    let html = '';
    items.forEach(item => {
        const thumb = item.b64 || item.thumb || item.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&q=80';
        html += `
        <div class="library-item" onclick="requestSongById('${item.id}', '${escapeHtml(item.title)}')">
            <img class="library-item-thumb" src="${thumb}" alt="thumb">
            <div class="library-item-meta">
                <div class="library-item-title">${escapeHtml(item.title)}</div>
                <div class="library-item-sub">${escapeHtml(item.artist || 'Artis')}</div>
            </div>
        </div>`;
    });
    libraryList.innerHTML = html;
}

function requestSongById(id, title) {
    showToast(`Memutar: ${title}`);
    requestSong(id);
}

function filterLibrary(type) {
    document.querySelectorAll('.library-chips .chip').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    renderLibraryList(type);
}

function clearLibraryHistory() {
    localStorage.removeItem('escanor_history');
    renderLibraryList('all');
    showToast("Riwayat dibersihkan");
}

renderLibraryList('all');

// =========================================================
// 11. MOBILE FULL-SCREEN PLAYER TOGGLE
// =========================================================
function openMobilePlayer() {
    if (mobileFullPlayer) mobileFullPlayer.classList.add('open');
}

function closeMobilePlayer() {
    if (mobileFullPlayer) mobileFullPlayer.classList.remove('open');
}

function switchMainTab(tabName) {
    // Update mobile nav bar
    document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
    const mobBtn = document.getElementById(`mob-nav-${tabName}`);
    if (mobBtn) mobBtn.classList.add('active');

    // Update sidebar nav
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(b => b.classList.remove('active'));
    const sideBtn = document.getElementById(`side-nav-${tabName}`);
    if (sideBtn) sideBtn.classList.add('active');

    if (tabName === 'home') {
        const scroll = document.getElementById('content-scroll');
        if (scroll) scroll.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (tabName === 'search') {
        if (searchInput) searchInput.focus();
    } else if (tabName === 'library') {
        renderLibraryList('all');
    }
}

// =========================================================
// 12. MODE SWITCHER (AUDIO / VIDEO)
// =========================================================
function setMode(mode) {
    activeMode = mode;
    const tabMusic = document.getElementById('tab-music');
    const tabVideo = document.getElementById('tab-video');
    const vidContainer = document.getElementById('video-container-view');

    if (tabMusic) tabMusic.classList.toggle('active', mode === 'music');
    if (tabVideo) tabVideo.classList.toggle('active', mode === 'video');

    if (mode === 'video') {
        if (vidContainer) vidContainer.style.display = 'block';
        if (currentSong && currentSong.id) {
            requestVideo(currentSong.id);
        }
    } else {
        if (vidContainer) vidContainer.style.display = 'none';
        if (video) video.pause();
        if (currentSong && currentSong.id) {
            requestSong(currentSong.id);
        }
    }
}

function toggleVideoModeFromBar() {
    setMode(activeMode === 'music' ? 'video' : 'music');
}

function focusPlayer() {
    showToast("Escanor Stream Web Player Online");
}

// =========================================================
// 13. DYNAMIC AMBIENT COLOR & MEDIASESSION
// =========================================================
function updateAmbientColor(imageUrl) {
    if (!heroBanner) return;
    // Set subtle vibrant glow on top hero section
    heroBanner.style.background = `linear-gradient(180deg, rgba(30, 215, 96, 0.22) 0%, transparent 100%)`;
}

function updateMediaSession(song) {
    if ('mediaSession' in navigator && song) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.title || 'Untitled',
            artist: song.artist || song.channel || 'Escanor Stream',
            album: 'Escanor Music',
            artwork: [
                { src: song.thumbnail || '', sizes: '512x512', type: 'image/jpeg' }
            ]
        });

        navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
        navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
        navigator.mediaSession.setActionHandler('previoustrack', () => handlePrevBtn());
        navigator.mediaSession.setActionHandler('nexttrack', () => handleNextBtn());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime && audio.duration) {
                audio.currentTime = details.seekTime;
            }
        });
    }
}

// =========================================================
// 14. KEYBOARD SHORTCUTS
// =========================================================
window.addEventListener('keydown', (e) => {
    // Avoid triggering when user is typing in search input
    if (document.activeElement === searchInput) return;

    if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
    } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 5);
    } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        handleVolume(Math.min(1, audio.volume + 0.1));
        if (volSlider) volSlider.value = audio.volume;
    } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        handleVolume(Math.max(0, audio.volume - 0.1));
        if (volSlider) volSlider.value = audio.volume;
    } else if (e.key === 'm' || e.key === 'M') {
        toggleMute();
    } else if (e.key === 'l' || e.key === 'L') {
        toggleLyrics();
    }
});

// START WEBSOCKET
connectWS();
