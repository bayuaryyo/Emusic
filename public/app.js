let ws = null;
        let activeMode = 'music';
        let currentSong = null;
        let parsedLyrics = [];
        let currentLyricIndex = -1;
        let isShuffle = false;
        let currentPlaylist = [];
        let currentPlaylistIndex = -1;

        const audio = document.getElementById('native-audio');
        const video = document.getElementById('video-player');
        const islandDot = document.getElementById('island-dot');
        const islandWave = document.getElementById('island-wave');
        const islandStatus = document.getElementById('island-status');
        const resultsGrid = document.getElementById('results-grid');
        const dockPlayer = document.getElementById('dock-player');
        const searchInput = document.getElementById('search-input');
        const toastEl = document.getElementById('ios-toast');
        const lyricsContentList = document.getElementById('lyrics-content-list');
        const lyricsScroll = document.getElementById('lyrics-scroll');

        // THEME MANAGEMENT (LIGHT/DARK)
        function initTheme() {
            const savedTheme = localStorage.getItem('escanor_theme') || 'light';
            document.documentElement.setAttribute('data-theme', savedTheme);
        }

        function toggleTheme() {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('escanor_theme', newTheme);
            showToast(`Tema diganti ke mode ${newTheme === 'dark' ? 'gelap' : 'terang'}`);
        }

        initTheme();

        // TOAST (NO EMOJI)
        function showToast(msg, duration = 2800) {
            toastEl.textContent = msg;
            toastEl.classList.add('show');
            setTimeout(() => toastEl.classList.remove('show'), duration);
        }

        // BACKEND CONFIGURATION (SUPPORT VERCEL HOSTING & VPS)
        const DEFAULT_VPS_HOST = "178.128.96.217:8080";
        const DEFAULT_SECURE_TUNNEL = "https://178.128.96.217.sslip.io/escanor";

        function getBackendConfig() {
            const hostname = window.location.hostname;
            const isVercelOrRemote = hostname.includes('vercel.app') || 
                                     hostname.includes('netlify.app') || 
                                     hostname.includes('github.io') ||
                                     hostname.includes('pages.dev');

            // Cek jika user menyetel custom backend di browser
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
                // Di Vercel (karena HTTPS), browser mewajibkan WSS & HTTPS (Anti Mixed-Content)
                return {
                    http: DEFAULT_SECURE_TUNNEL,
                    ws: "wss://178.128.96.217.sslip.io/escanor/ws"
                };
            }

            // Saat diakses langsung dari VPS atau localhost
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

        // WEBSOCKET CONNECTION
        function connectWS() {
            const config = getBackendConfig();
            const wsUrl = config.ws;

            islandStatus.textContent = "Menghubungkan...";
            islandDot.className = "island-dot buffering";
            islandWave.classList.remove('active');

            try {
                ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                    islandStatus.textContent = "Escanor Online";
                    islandDot.className = "island-dot";
                    console.log("WebSocket connected:", wsUrl);
                    ws.send(JSON.stringify({ action: "search", q: "Top Hits Indonesia" }));
                };

                ws.onmessage = (event) => {
                    if (typeof event.data === 'string') {
                        try {
                            const data = json = JSON.parse(event.data);
                            handleWsEvent(data);
                        } catch (e) {
                            console.log("WS text message:", event.data);
                        }
                    }
                };

                ws.onclose = () => {
                    islandStatus.textContent = "Terputus";
                    islandDot.className = "island-dot offline";
                    islandWave.classList.remove('active');
                    setTimeout(connectWS, 3500);
                };

                ws.onerror = (err) => {
                    console.error("WS error:", err);
                    ws.close();
                };
            } catch (err) {
                setTimeout(connectWS, 4000);
            }
        }

        // HANDLE WS EVENTS
        function handleWsEvent(d) {
            if (d.action === 'search_results') {
                renderResults(d.list || []);
            } else if (d.action === 'song_ready') {
                playAudioSong(d);
            } else if (d.action === 'video_ready') {
                playVideoStream(d);
            } else if (d.error) {
                showToast(d.error);
                islandDot.className = "island-dot";
                islandStatus.textContent = "Escanor Online";
            }
        }

        // MODE SWITCHER
        function setMode(mode) {
            activeMode = mode;
            document.getElementById('tab-music').classList.toggle('active', mode === 'music');
            document.getElementById('tab-video').classList.toggle('active', mode === 'video');
            document.getElementById('video-container-view').style.display = mode === 'video' ? 'block' : 'none';
            if (mode === 'video') {
                audio.pause();
            } else {
                video.pause();
            }
        }

        // SEARCH
        function doSearch() {
            const q = searchInput.value.trim();
            if (!q) return showToast("Ketik judul lagu atau tempel link");

            resultsGrid.innerHTML = `
                <div class="empty-glass-box">
                    <div class="ios-spinner"></div>
                    <p style="font-weight:600;">Mencari "${escapeHtml(q)}"...</p>
                </div>
            `;

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: "search", q }));
            } else {
                fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}`))
                    .then(res => res.json())
                    .then(data => renderResults(data.list || []))
                    .catch(err => {
                        resultsGrid.innerHTML = `<div class="empty-glass-box"><p>Gagal mencari lagu: ${err.message}</p></div>`;
                    });
            }
        }

        function quickSearch(q) {
            searchInput.value = q;
            doSearch();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSearch();
        });

        // RENDER RESULTS
        function renderResults(list) {
            currentPlaylist = list || [];
            if (!list || !list.length) {
                resultsGrid.innerHTML = `
                    <div class="empty-glass-box">
                        <p style="font-size:16px; margin-bottom:6px; font-weight:600;">Tidak ada hasil ditemukan</p>
                        <p style="font-size:13px; color:var(--text-tertiary);">Coba cari dengan kata kunci lain.</p>
                    </div>
                `;
                document.getElementById('results-count').textContent = '0 lagu';
                return;
            }

            document.getElementById('results-count').textContent = `${list.length} lagu ditemukan`;
            resultsGrid.innerHTML = '';

            list.forEach(item => {
                const card = document.createElement('div');
                card.className = 'ios-music-card';
                const thumb = item.b64 || item.thumb || "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80";

                card.innerHTML = `
                    <div class="card-artwork-box">
                        <img class="card-img" src="${thumb}" alt="${escapeHtml(item.title)}" loading="lazy">
                        <span class="badge-duration">${item.duration || '0:00'}</span>
                        <div class="hover-play-glyph">
                            <div class="glyph-disc">
                                <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                        </div>
                    </div>
                    <div class="card-meta-box">
                        <div class="card-track-title">${escapeHtml(item.title)}</div>
                        <div class="card-track-artist">${escapeHtml(item.artist || 'YouTube')}</div>
                    </div>
                `;

                card.onclick = () => selectItem(item);
                resultsGrid.appendChild(card);
            });
        }

        // SELECT SONG / VIDEO
        function selectItem(item) {
            if (currentPlaylist.length) {
                const idx = currentPlaylist.findIndex(x => x.id === item.id);
                if (idx !== -1) currentPlaylistIndex = idx;
            }
            if (activeMode === 'video') {
                showToast(`Menyiapkan video: ${item.title}`);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ action: "get_video", id: item.id, title: item.title, artist: item.artist }));
                } else {
                    fetch(apiUrl(`/api/video?id=${item.id}`))
                        .then(r => r.json())
                        .then(d => playVideoStream(d));
                }
            } else {
                showToast(`Memuat: ${item.title}`);
                islandDot.className = "island-dot buffering";
                islandStatus.textContent = "Memuat lagu...";

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ action: "get_song", id: item.id, title: item.title, artist: item.artist }));
                } else {
                    fetch(apiUrl(`/api/song?id=${item.id}`))
                        .then(r => r.json())
                        .then(d => playAudioSong(d));
                }
            }
        }

        // SPOTIFY-STYLE LRC PARSER (STRIP TIMESTAMP FROM TEXT)
        function parseLrc(lrcText) {
            if (!lrcText || !lrcText.trim()) return [];
            const rawLines = lrcText.split('\n');
            const parsed = [];
            const timeReg = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

            for (const line of rawLines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Ekstrak timestamp
                let hasTime = false;
                let match;
                timeReg.lastIndex = 0;
                const cleanText = trimmed.replace(timeReg, '').trim();

                timeReg.lastIndex = 0;
                while ((match = timeReg.exec(trimmed)) !== null) {
                    hasTime = true;
                    const min = parseInt(match[1], 10);
                    const sec = parseInt(match[2], 10);
                    const ms = match[3] ? parseFloat('0.' + match[3]) : 0;
                    const totalSec = min * 60 + sec + ms;
                    if (cleanText) {
                        parsed.push({ time: totalSec, text: cleanText });
                    }
                }

                if (!hasTime && cleanText) {
                    parsed.push({ time: -1, text: cleanText });
                }
            }

            parsed.sort((a, b) => a.time - b.time);
            return parsed;
        }

        // RENDER SPOTIFY-STYLE ANIMATED LYRICS
        function renderLyricsUI(lrcRaw) {
            parsedLyrics = parseLrc(lrcRaw);
            currentLyricIndex = -1;

            if (!parsedLyrics.length) {
                lyricsContentList.innerHTML = `
                    <div style="color:var(--text-tertiary); padding:40px 20px; text-align:center; font-size:15px;">
                        Lirik tidak tersedia untuk lagu ini.
                    </div>
                `;
                document.getElementById('btn-lyrics').style.display = 'none';
                return;
            }

            document.getElementById('btn-lyrics').style.display = 'inline-block';
            lyricsContentList.innerHTML = '';

            parsedLyrics.forEach((item, idx) => {
                const el = document.createElement('div');
                el.className = 'lrc-line';
                el.id = `lrc-${idx}`;
                el.textContent = item.text;
                if (item.time >= 0) {
                    el.onclick = () => {
                        audio.currentTime = item.time;
                        audio.play();
                    };
                }
                lyricsContentList.appendChild(el);
            });
        }

        // SYNCHRONIZED LYRICS SCROLLER ON TIME UPDATE
        function syncLyricsToAudio(currentTime) {
            if (!parsedLyrics.length) return;

            let activeIdx = -1;
            for (let i = 0; i < parsedLyrics.length; i++) {
                if (parsedLyrics[i].time >= 0 && currentTime >= parsedLyrics[i].time) {
                    activeIdx = i;
                }
            }

            if (activeIdx !== -1 && activeIdx !== currentLyricIndex) {
                // Hapus active sebelumnya
                if (currentLyricIndex !== -1) {
                    const prevEl = document.getElementById(`lrc-${currentLyricIndex}`);
                    if (prevEl) prevEl.classList.remove('active');
                }

                currentLyricIndex = activeIdx;
                const activeEl = document.getElementById(`lrc-${activeIdx}`);
                if (activeEl) {
                    activeEl.classList.add('active');
                    activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }

        // PLAY AUDIO SONG
        function playAudioSong(d) {
            currentSong = d;

            // Update UI
            document.getElementById('dock-title').textContent = d.title || 'Lagu';
            document.getElementById('dock-artist').textContent = d.artist || 'Escanor Stream';
            
            const thumbEl = document.getElementById('dock-thumb');
            if (thumbEl) {
                thumbEl.src = d.thumb || d.thumb_b64 || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&q=80';
                thumbEl.onerror = () => {
                    thumbEl.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&q=80';
                };
            }

            const badge = document.getElementById('dock-badge');
            if (badge) badge.textContent = "PREVIEW";

            // Reset scrubber
            document.getElementById('dock-scrub-fill').style.width = '0%';
            document.getElementById('time-current').textContent = '0:00';
            document.getElementById('time-total').textContent = '0:00';

            // Render Spotify-style synced lyrics
            renderLyricsUI(d.lyrics || '');

            islandStatus.textContent = d.title || 'Memutar';
            dockPlayer.classList.add('active');

            const streamUrl = resolveMediaUrl(d.proxyUrl || d.audioUrl);
            if (streamUrl) {
                audio.src = streamUrl;
                audio.play().then(() => {
                    islandDot.className = "island-dot";
                    islandWave.classList.add('active');
                    showToast(`Memutar: ${d.title}`);
                }).catch(e => {
                    console.log("Audio play deferred:", e);
                    showToast(`Ketuk tombol Play untuk mendengarkan`);
                });
            }
        }

        // PLAY VIDEO STREAM
        function playVideoStream(d) {
            setMode('video');
            document.getElementById('video-title').textContent = d.title || 'Video';
            document.getElementById('video-artist').textContent = d.artist || 'YouTube';

            const vUrl = resolveMediaUrl(d.proxyUrl || d.videoUrl);
            if (vUrl) {
                video.src = vUrl;
                video.play().then(() => {
                    showToast(`Memutar video`);
                }).catch(e => {
                    showToast(`Ketuk play pada video untuk memulai`);
                });
                document.getElementById('video-container-view').scrollIntoView({ behavior: 'smooth' });
            }
        }

        // AUDIO CONTROLS & APPLE DOCK FEATURES
        function togglePlayPause() {
            if (audio.paused) {
                audio.play();
            } else {
                audio.pause();
            }
        }

        function toggleShuffle() {
            isShuffle = !isShuffle;
            const btn = document.getElementById('btn-shuffle');
            if (btn) btn.classList.toggle('active', isShuffle);
            showToast(isShuffle ? "Mode Acak Aktif" : "Mode Acak Nonaktif");
        }

        function toggleRepeat() {
            audio.loop = !audio.loop;
            const btn = document.getElementById('btn-repeat');
            if (btn) btn.classList.toggle('active', audio.loop);
            const lbl = document.getElementById('opt-repeat-label');
            if (lbl) lbl.textContent = audio.loop ? "Ulangi: Nyala" : "Ulangi: Mati";
            showToast(audio.loop ? "Putar Ulang Aktif" : "Putar Ulang Nonaktif");
        }

        function handlePrevBtn() {
            if (audio.currentTime > 3) {
                audio.currentTime = 0;
                showToast("Memulai dari awal");
            } else if (currentPlaylist.length && currentPlaylistIndex > 0) {
                currentPlaylistIndex--;
                selectItem(currentPlaylist[currentPlaylistIndex]);
            } else {
                seekRelative(-10);
            }
        }

        function handleNextBtn() {
            if (isShuffle && currentPlaylist.length > 1) {
                let nextIdx = Math.floor(Math.random() * currentPlaylist.length);
                if (nextIdx === currentPlaylistIndex) nextIdx = (nextIdx + 1) % currentPlaylist.length;
                currentPlaylistIndex = nextIdx;
                selectItem(currentPlaylist[currentPlaylistIndex]);
            } else if (currentPlaylist.length && currentPlaylistIndex < currentPlaylist.length - 1) {
                currentPlaylistIndex++;
                selectItem(currentPlaylist[currentPlaylistIndex]);
            } else {
                seekRelative(10);
            }
        }

        function toggleMute() {
            audio.muted = !audio.muted;
            const high = document.getElementById('icon-vol-high');
            const mute = document.getElementById('icon-vol-mute');
            const slider = document.getElementById('vol-slider');
            if (audio.muted) {
                if (high) high.style.display = 'none';
                if (mute) mute.style.display = 'block';
                if (slider) slider.value = 0;
                showToast("Suara Dibisukan");
            } else {
                if (high) high.style.display = 'block';
                if (mute) mute.style.display = 'none';
                if (slider) slider.value = audio.volume || 1;
                showToast("Suara Aktif");
            }
        }

        function handleVolume(val) {
            audio.volume = parseFloat(val);
            video.volume = parseFloat(val);
            const high = document.getElementById('icon-vol-high');
            const mute = document.getElementById('icon-vol-mute');
            if (audio.volume === 0) {
                audio.muted = true;
                if (high) high.style.display = 'none';
                if (mute) mute.style.display = 'block';
            } else {
                audio.muted = false;
                if (high) high.style.display = 'block';
                if (mute) mute.style.display = 'none';
            }
        }

        // MORE OPTIONS CONTEXT MENU
        function toggleOptionsMenu(e) {
            if (e) e.stopPropagation();
            const menu = document.getElementById('dock-menu-dropdown');
            if (menu) menu.classList.toggle('show');
        }

        function closeOptionsMenu() {
            const menu = document.getElementById('dock-menu-dropdown');
            if (menu) menu.classList.remove('show');
        }

        window.addEventListener('click', (e) => {
            const wrap = document.querySelector('.dock-more-wrap');
            if (wrap && !wrap.contains(e.target)) {
                closeOptionsMenu();
            }
        });

        function downloadCurrentSong() {
            if (!currentSong) return showToast("Pilih lagu terlebih dahulu");
            const url = resolveMediaUrl(currentSong.proxyUrl || currentSong.audioUrl);
            if (!url) return showToast("Tautan audio belum siap");
            const a = document.createElement('a');
            a.href = url;
            a.download = (currentSong.title || 'audio') + '.mp3';
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showToast("Mengunduh audio lagu...");
        }

        function copySongInfo() {
            if (!currentSong) return showToast("Pilih lagu terlebih dahulu");
            const text = `${currentSong.title} — ${currentSong.artist || 'YouTube'}`;
            navigator.clipboard.writeText(text).then(() => {
                showToast(`Tersalin: ${text}`);
            }).catch(() => {
                showToast("Gagal menyalin judul");
            });
        }

        function updateScrubTooltip(e) {
            const bar = document.getElementById('dock-scrub-bar');
            const pill = document.getElementById('dock-time-pill');
            if (!bar || !pill || !audio.duration) return;
            const rect = bar.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const seekSec = pct * audio.duration;
            document.getElementById('time-current').textContent = formatTime(seekSec);
            document.getElementById('time-total').textContent = formatTime(audio.duration);
        }

        function hideScrubTooltip() {
            if (audio.duration) {
                document.getElementById('time-current').textContent = formatTime(audio.currentTime);
                document.getElementById('time-total').textContent = formatTime(audio.duration);
            }
        }

        audio.onplay = () => {
            document.getElementById('icon-play').style.display = 'none';
            document.getElementById('icon-pause').style.display = 'block';
            document.getElementById('dock-thumb').classList.add('playing');
            islandWave.classList.add('active');
        };

        audio.onpause = () => {
            document.getElementById('icon-play').style.display = 'block';
            document.getElementById('icon-pause').style.display = 'none';
            document.getElementById('dock-thumb').classList.remove('playing');
            islandWave.classList.remove('active');
        };

        audio.onended = () => {
            if (audio.loop) return;
            if (isShuffle && currentPlaylist.length > 1) {
                let nextIdx = Math.floor(Math.random() * currentPlaylist.length);
                if (nextIdx === currentPlaylistIndex) nextIdx = (nextIdx + 1) % currentPlaylist.length;
                currentPlaylistIndex = nextIdx;
                selectItem(currentPlaylist[currentPlaylistIndex]);
            } else if (currentPlaylist.length && currentPlaylistIndex < currentPlaylist.length - 1) {
                currentPlaylistIndex++;
                selectItem(currentPlaylist[currentPlaylistIndex]);
            } else {
                document.getElementById('icon-play').style.display = 'block';
                document.getElementById('icon-pause').style.display = 'none';
                document.getElementById('dock-thumb').classList.remove('playing');
                islandWave.classList.remove('active');
            }
        };

        audio.ontimeupdate = () => {
            if (!audio.duration) return;
            const cur = audio.currentTime;
            const dur = audio.duration;
            const pct = (cur / dur) * 100;

            document.getElementById('dock-scrub-fill').style.width = pct + '%';
            document.getElementById('time-current').textContent = formatTime(cur);
            document.getElementById('time-total').textContent = formatTime(dur);

            // Sync live Spotify lyrics!
            syncLyricsToAudio(cur);
        };

        function handleSeek(e) {
            const wrap = document.getElementById('dock-scrub-bar');
            const rect = wrap.getBoundingClientRect();
            const clickPos = (e.clientX - rect.left) / rect.width;
            if (audio.duration) {
                audio.currentTime = clickPos * audio.duration;
            }
        }

        function seekRelative(secs) {
            if (audio.duration) {
                audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + secs));
            }
        }

        function toggleLyrics() {
            const sheet = document.getElementById('lyrics-sheet');
            const btn = document.getElementById('btn-lyrics');
            const isOpen = sheet.classList.contains('show');
            sheet.classList.toggle('show', !isOpen);
            btn.classList.toggle('active', !isOpen);
        }

        function focusPlayer() {
            dockPlayer.classList.add('active');
            dockPlayer.scrollIntoView({ behavior: 'smooth' });
        }

        function formatTime(secs) {
            if (isNaN(secs)) return '0:00';
            const m = Math.floor(secs / 60);
            const s = Math.floor(secs % 60);
            return `${m}:${s < 10 ? '0' : ''}${s}`;
        }

        function escapeHtml(text) {
            return String(text || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }

        // START ON LOAD
        window.addEventListener('load', () => {
            connectWS();
        });
