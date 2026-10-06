import asyncio
import os
import sys
import json
import re
import time
import platform
import shutil
import urllib.request
import stat
import base64
from aiohttp import web
import aiohttp

def extract_youtube_id(text):
    """Mengekstrak YouTube video ID (11 karakter) dari link atau string"""
    if not text:
        return None
    match = re.search(r'(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([a-zA-Z0-9_-]{11})', str(text))
    if match:
        return match.group(1)
    # Jika sudah merupakan 11 karakter ID YouTube
    clean = str(text).strip()
    if len(clean) == 11 and re.match(r'^[a-zA-Z0-9_-]{11}$', clean):
        return clean
    return None

# Mengambil port dinamis dari Pterodactyl atau default 8080
PORT = int(os.environ.get("SERVER_PORT", 8080))
connected_clients = set()
client_tasks = {} # Menyimpan task streaming untuk tiap websocket client

# Informasi Cloudflare Tunnel Aktif
TUNNEL_INFO = {
    "status": "online",
    "https": "https://178.128.96.217.sslip.io/escanor",
    "wss": "wss://178.128.96.217.sslip.io/escanor/ws",
    "permanent_https": "https://178.128.96.217.sslip.io/escanor",
    "permanent_wss": "wss://178.128.96.217.sslip.io/escanor/ws"
}

# ---------------------------------------------------------
# PURE-PYTHON AES-128-CBC DECRYPTOR (UNTUK SAVETUBE)
# ---------------------------------------------------------
Sbox = [
    0x63, 0x7C, 0x77, 0x7B, 0xF2, 0x6B, 0x6F, 0xC5, 0x30, 0x01, 0x67, 0x2B, 0xFE, 0xD7, 0xAB, 0x76,
    0xCA, 0x82, 0xC9, 0x7D, 0xFA, 0x59, 0x47, 0xF0, 0xAD, 0xD4, 0xA2, 0xAF, 0x9C, 0xA4, 0x72, 0xC0,
    0xB7, 0xFD, 0x93, 0x26, 0x36, 0x3F, 0xF7, 0xCC, 0x34, 0xA5, 0xE5, 0xF1, 0x71, 0xD8, 0x31, 0x15,
    0x04, 0xC7, 0x23, 0xC3, 0x18, 0x96, 0x05, 0x9A, 0x07, 0x12, 0x80, 0xE2, 0xEB, 0x27, 0xB2, 0x75,
    0x09, 0x83, 0x2C, 0x1A, 0x1B, 0x6E, 0x5A, 0xA0, 0x52, 0x3B, 0xD6, 0xB3, 0x29, 0xE3, 0x2F, 0x84,
    0x53, 0xD1, 0x00, 0xED, 0x20, 0xFC, 0xB1, 0x5B, 0x6A, 0xCB, 0xBE, 0x39, 0x4A, 0x4C, 0x58, 0xCF,
    0xD0, 0xEF, 0xAA, 0xFB, 0x43, 0x4D, 0x33, 0x85, 0x45, 0xF9, 0x02, 0x7F, 0x50, 0x3C, 0x9F, 0xA8,
    0x51, 0xA3, 0x40, 0x8F, 0x92, 0x9D, 0x38, 0xF5, 0xBC, 0xB6, 0xDA, 0x21, 0x10, 0xFF, 0xF3, 0xD2,
    0xCD, 0x0C, 0x13, 0xEC, 0x5F, 0x97, 0x44, 0x17, 0xC4, 0xA7, 0x7E, 0x3D, 0x64, 0x5D, 0x19, 0x73,
    0x60, 0x81, 0x4F, 0xDC, 0x22, 0x2A, 0x90, 0x88, 0x46, 0xEE, 0xB8, 0x14, 0xDE, 0x5E, 0x0B, 0xDB,
    0xE0, 0x32, 0x3A, 0x0A, 0x49, 0x06, 0x24, 0x5C, 0xC2, 0xD3, 0xAC, 0x62, 0x91, 0x95, 0xE4, 0x79,
    0xE7, 0xC8, 0x37, 0x6D, 0x8D, 0xD5, 0x4E, 0xA9, 0x6C, 0x56, 0xF4, 0xEA, 0x65, 0x7A, 0xAE, 0x08,
    0xBA, 0x78, 0x25, 0x2E, 0x1C, 0xA6, 0xB4, 0xC6, 0xE8, 0xDD, 0x74, 0x1F, 0x4B, 0xBD, 0x8B, 0x8A,
    0x70, 0x3E, 0xB5, 0x66, 0x48, 0x03, 0xF6, 0x0E, 0x61, 0x35, 0x57, 0xB9, 0x86, 0xC1, 0x1D, 0x9E,
    0xE1, 0xF8, 0x98, 0x11, 0x69, 0xD9, 0x8E, 0x94, 0x9B, 0x1E, 0x87, 0xE9, 0xCE, 0x55, 0x28, 0xDF,
    0x8C, 0xA1, 0x89, 0x0D, 0xBF, 0xE6, 0x42, 0x68, 0x41, 0x99, 0x2D, 0x0F, 0xB0, 0x54, 0xBB, 0x16
]
InvSbox = [0]*256
for i, v in enumerate(Sbox): InvSbox[v] = i
Rcon = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36]

def rot_word(w): return ((w << 8) & 0xFFFFFFFF) | (w >> 24)
def sub_word(w):
    return (Sbox[(w >> 24) & 0xFF] << 24) | (Sbox[(w >> 16) & 0xFF] << 16) | (Sbox[(w >> 8) & 0xFF] << 8) | Sbox[w & 0xFF]

def decrypt_aes_128_cbc(key: bytes, iv: bytes, data: bytes) -> bytes:
    w = [0] * 44
    for i in range(4): w[i] = (key[4*i] << 24) | (key[4*i+1] << 16) | (key[4*i+2] << 8) | key[4*i+3]
    for i in range(4, 44):
        temp = w[i-1]
        if i % 4 == 0: temp = sub_word(rot_word(temp)) ^ (Rcon[i//4] << 24)
        w[i] = w[i-4] ^ temp
    round_keys = []
    for r in range(11):
        rk = []
        for i in range(4):
            val = w[r*4 + i]
            rk.extend([(val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF])
        round_keys.append(rk)
    def mul(a, b):
        res = 0
        while b:
            if b & 1: res ^= a
            a = ((a << 1) ^ 0x1B) & 0xFF if (a & 0x80) else (a << 1)
            b >>= 1
        return res
    def inv_mix_cols(s):
        ns = [0]*16
        for c in range(4):
            i = c*4
            ns[i]   = mul(0x0e, s[i]) ^ mul(0x0b, s[i+1]) ^ mul(0x0d, s[i+2]) ^ mul(0x09, s[i+3])
            ns[i+1] = mul(0x09, s[i]) ^ mul(0x0e, s[i+1]) ^ mul(0x0b, s[i+2]) ^ mul(0x0d, s[i+3])
            ns[i+2] = mul(0x0d, s[i]) ^ mul(0x09, s[i+1]) ^ mul(0x0e, s[i+2]) ^ mul(0x0b, s[i+3])
            ns[i+3] = mul(0x0b, s[i]) ^ mul(0x0d, s[i+1]) ^ mul(0x09, s[i+2]) ^ mul(0x0e, s[i+3])
        return ns
    def decrypt_block(block):
        s = [a ^ b for a, b in zip(block, round_keys[10])]
        for r in range(9, 0, -1):
            s = [s[0], s[13], s[10], s[7], s[4], s[1], s[14], s[11], s[8], s[5], s[2], s[15], s[12], s[9], s[6], s[3]]
            s = [InvSbox[x] for x in s]
            s = [a ^ b for a, b in zip(s, round_keys[r])]
            s = inv_mix_cols(s)
        s = [s[0], s[13], s[10], s[7], s[4], s[1], s[14], s[11], s[8], s[5], s[2], s[15], s[12], s[9], s[6], s[3]]
        s = [InvSbox[x] for x in s]
        return [a ^ b for a, b in zip(s, round_keys[0])]
    prev = list(iv)
    out = []
    for i in range(0, len(data), 16):
        blk = data[i:i+16]
        dec = decrypt_block(blk)
        out.extend([a ^ b for a, b in zip(dec, prev)])
        prev = list(blk)
    pad = out[-1]
    if 1 <= pad <= 16: out = out[:-pad]
    return bytes(out)

SAVETUBE_KEY = bytes.fromhex('C5D58EF67A7584E4A29F6C35BBC4EB12')

def get_savetube_download(video_id, retries=3):
    """Mendapatkan link direct MP3 dari SaveTube via pure Python dengan retry"""
    headers = {'Origin': 'https://yt.savetube.me', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    last_err = None
    for attempt in range(retries):
        try:
            cdn_res = urllib.request.urlopen(urllib.request.Request('https://media.savetube.vip/api/random-cdn', headers=headers), timeout=8)
            cdn = json.loads(cdn_res.read())['cdn']
            cdn = cdn.replace('https://', '').replace('http://', '').strip('/')

            info_req = urllib.request.Request(
                f'https://{cdn}/v2/info',
                data=json.dumps({'url': f'https://www.youtube.com/watch?v={video_id}'}).encode(),
                headers={'Content-Type': 'application/json', 'Origin': 'https://yt.savetube.me', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            encrypted = base64.b64decode(json.loads(urllib.request.urlopen(info_req, timeout=15).read())['data'])
            dec = decrypt_aes_128_cbc(SAVETUBE_KEY, encrypted[:16], encrypted[16:])
            meta = json.loads(dec.decode('utf-8'))

            dl_req = urllib.request.Request(
                f'https://{cdn}/download',
                data=json.dumps({'id': video_id, 'downloadType': 'audio', 'quality': '128kbps', 'key': meta['key']}).encode(),
                headers={'Content-Type': 'application/json', 'Origin': 'https://yt.savetube.me', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            dl_res = json.loads(urllib.request.urlopen(dl_req, timeout=20).read())
            dl_url = dl_res.get('data', {}).get('downloadUrl', '')
            if dl_url:
                return {
                    'title': meta.get('title', 'Unknown'),
                    'duration': meta.get('durationLabel', '0:00'),
                    'thumbnail': meta.get('thumbnail', ''),
                    'audioUrl': dl_url
                }
        except Exception as e:
            last_err = e
            time.sleep(1)
    if last_err:
        raise last_err
    raise Exception("Gagal mendapatkan link download audio dari SaveTube")

def get_savetube_video(video_id, retries=3):
    """Mendapatkan link direct MP4 dari SaveTube (Resolusi 360p) dengan retry"""
    headers = {'Origin': 'https://yt.savetube.me', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    last_err = None
    for attempt in range(retries):
        try:
            cdn_res = urllib.request.urlopen(urllib.request.Request('https://media.savetube.vip/api/random-cdn', headers=headers), timeout=8)
            cdn = json.loads(cdn_res.read())['cdn']
            cdn = cdn.replace('https://', '').replace('http://', '').strip('/')

            info_req = urllib.request.Request(
                f'https://{cdn}/v2/info',
                data=json.dumps({'url': f'https://www.youtube.com/watch?v={video_id}'}).encode(),
                headers={'Content-Type': 'application/json', 'Origin': 'https://yt.savetube.me', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            encrypted = base64.b64decode(json.loads(urllib.request.urlopen(info_req, timeout=15).read())['data'])
            dec = decrypt_aes_128_cbc(SAVETUBE_KEY, encrypted[:16], encrypted[16:])
            meta = json.loads(dec.decode('utf-8'))

            dl_req = urllib.request.Request(
                f'https://{cdn}/download',
                data=json.dumps({'id': video_id, 'downloadType': 'video', 'quality': '360', 'key': meta['key']}).encode(),
                headers={'Content-Type': 'application/json', 'Origin': 'https://yt.savetube.me', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            dl_res = json.loads(urllib.request.urlopen(dl_req, timeout=20).read())
            dl_url = dl_res.get('data', {}).get('downloadUrl', '')
            if dl_url:
                return {
                    'title': meta.get('title', 'Unknown'),
                    'duration': meta.get('durationLabel', '0:00'),
                    'thumbnail': meta.get('thumbnail', ''),
                    'videoUrl': dl_url
                }
        except Exception as e:
            last_err = e
            time.sleep(1)
    if last_err:
        raise last_err
    raise Exception("Gagal mendapatkan link download video dari SaveTube")

def search_youtube(query):
    """Pencarian lagu YouTube langsung via YouTube InnerTube (super cepat)"""
    url = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false'
    data = {
        'context': {'client': {'clientName': 'WEB', 'clientVersion': '2.20230515.00.00'}},
        'query': query
    }
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=6) as r:
        res = json.loads(r.read())
    
    results = []
    try:
        sections = res['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents']
        for sec in sections:
            items = sec.get('itemSectionRenderer', {}).get('contents', [])
            for item in items:
                v = item.get('videoRenderer')
                if not v:
                    continue
                vid = v.get('videoId')
                title = v.get('title', {}).get('runs', [{}])[0].get('text', 'Unknown')
                artist = v.get('ownerText', {}).get('runs', [{}])[0].get('text', 'YouTube')
                duration = v.get('lengthText', {}).get('simpleText', '0:00')
                thumbs = v.get('thumbnail', {}).get('thumbnails', [])
                thumb = thumbs[-1].get('url', '') if thumbs else ''
                results.append({
                    'id': vid,
                    'title': title,
                    'artist': artist,
                    'duration': duration,
                    'thumb': thumb
                })
                if len(results) >= 12:
                    break
            if len(results) >= 12:
                break
    except Exception as e:
        print('Parse error:', e)
    return results

def get_lyrics_py(query, fallback_title=""):
    """Mengambil lirik tersinkronisasi dari Nexray API"""
    candidates = [query, fallback_title]
    for q in candidates:
        if not q: continue
        clean_q = re.sub(r'[\[\(].*?[\]\)]', '', q)
        clean_q = re.sub(r'official|music|video|audio|lyrics|lirik', '', clean_q, flags=re.IGNORECASE).strip()
        url = f'https://api.nexray.eu.cc/search/lyrics?q={urllib.parse.quote(clean_q or q)}'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            res = json.loads(urllib.request.urlopen(req, timeout=4).read())
            if res.get('status') and res.get('result', {}).get('lyrics'):
                lrc = res['result']['lyrics'].get('synced_lyrics') or res['result']['lyrics'].get('plain_lyrics')
                if lrc and lrc.strip():
                    return lrc.strip()
        except Exception:
            pass
    return ""

# ---------------------------------------------------------
# AUTO-DOWNLOAD & RUN CLOUDFLARE TUNNEL (WSS/HTTPS)
# ---------------------------------------------------------
def get_cloudflared_path():
    """Mencari atau mengunduh binary cloudflared secara otomatis"""
    system_bin = shutil.which("cloudflared")
    if system_bin:
        return system_bin

    is_windows = platform.system().lower() == "windows"
    bin_name = "cloudflared.exe" if is_windows else "cloudflared"
    local_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), bin_name)
    if os.path.exists(local_path):
        return local_path

    arch = platform.machine().lower()
    print(f"📥 [Tunnel] Mengunduh binary cloudflared untuk {platform.system()} ({arch})...")

    if is_windows:
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    elif "arm" in arch or "aarch64" in arch:
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    else:
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"

    try:
        urllib.request.urlretrieve(url, local_path)
        if not is_windows:
            os.chmod(local_path, os.stat(local_path).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
        print(f"✅ [Tunnel] cloudflared berhasil diunduh ke {local_path}")
        return local_path
    except Exception as e:
        print(f"⚠️ [Tunnel] Gagal mengunduh cloudflared: {e}")
        return None

async def run_cloudflared_tunnel(app):
    """Context manager untuk menjalankan Cloudflare Quick Tunnel di background"""
    bin_path = get_cloudflared_path()
    if not bin_path:
        print("⚠️ [Tunnel] Binary cloudflared tidak tersedia. Menjalankan server tanpa tunnel.")
        TUNNEL_INFO["status"] = "offline"
        yield
        return

    cmd = [bin_path, "tunnel", "--url", f"http://127.0.0.1:{PORT}"]
    print(f"🚇 [Tunnel] Menjalankan Cloudflare Quick Tunnel untuk port {PORT}...")

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
    except Exception as e:
        print(f"❌ [Tunnel] Gagal menjalankan proses cloudflared: {e}")
        TUNNEL_INFO["status"] = "error"
        TUNNEL_INFO["error"] = str(e)
        yield
        return

    async def monitor_tunnel():
        pattern = re.compile(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
        while process.returncode is None:
            line = await process.stderr.readline()
            if not line:
                break
            text = line.decode('utf-8', errors='ignore').strip()
            match = pattern.search(text)
            if match:
                https_url = match.group(0)
                wss_url = https_url.replace("https://", "wss://") + "/ws"
                TUNNEL_INFO["status"] = "online"
                TUNNEL_INFO["https"] = https_url
                TUNNEL_INFO["wss"] = wss_url

                try:
                    with open("tunnel_url.txt", "w") as f:
                        f.write(f"{https_url}\n{wss_url}\n")
                except Exception:
                    pass

                print("\n" + "="*58)
                print("🌐 CLOUDFLARE WSS/HTTPS TUNNEL AKTIF!")
                print(f"🔗 HTTPS URL : {https_url}")
                print(f"⚡ WSS URL   : {wss_url}")
                print("="*58 + "\n")

    monitor_task = asyncio.create_task(monitor_tunnel())

    yield

    print("🛑 [Tunnel] Menghentikan Cloudflare Tunnel...")
    monitor_task.cancel()
    try:
        process.terminate()
        await process.wait()
    except Exception:
        pass
    print("✅ [Tunnel] Cloudflare Tunnel telah dinonaktifkan.")

# ---------------------------------------------------------
# 1. JALUR WEBSOCKET (STREAMING, SEARCH, DAN RESOLVE LAGU)
# ---------------------------------------------------------
async def stream_audio_to_ws(ws, url):
    try:
        req_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*'
        }
        async with aiohttp.ClientSession(headers=req_headers) as session:
            async with session.get(url) as resp:
                if resp.status not in (200, 206):
                    await ws.send_json({"error": "Gagal mengambil lagu", "status": resp.status})
                    return
                
                content_type = resp.headers.get("Content-Type", "audio/mpeg")
                total_bytes = int(resp.headers.get("Content-Length", 0))

                await ws.send_json({
                    "action": "start_stream", 
                    "content_type": content_type,
                    "total_bytes": total_bytes
                })
                
                async for chunk in resp.content.iter_chunked(16384):
                    if ws.closed:
                        break
                    await ws.send_bytes(chunk)
                    
                if not ws.closed:
                    await ws.send_json({"action": "end_stream"})
                    
    except asyncio.CancelledError:
        print("Streaming dihentikan (Task Cancelled)")
    except Exception as e:
        if not ws.closed:
            await ws.send_json({"error": f"Terjadi kesalahan streaming: {str(e)}"})

def get_stream_proxy_url(request, media_url):
    """Membangun URL proxy stream yang valid melalui SSL / reverse proxy Nginx"""
    if not media_url:
        return ""
    host = request.headers.get("Host", "")
    prefix = request.headers.get("X-Forwarded-Prefix", "")
    if "178.128.96.217.sslip.io" in host:
        base = "https://178.128.96.217.sslip.io/escanor"
    elif TUNNEL_INFO.get("permanent_https"):
        base = TUNNEL_INFO["permanent_https"]
    elif TUNNEL_INFO.get("https"):
        base = TUNNEL_INFO["https"]
    else:
        scheme = "https" if request.secure or request.headers.get("X-Forwarded-Proto") == "https" else "http"
        base_host = host or f"178.128.96.217:{PORT}"
        base = f"{scheme}://{base_host}"
        if prefix:
            base = f"{base.rstrip('/')}/{prefix.strip('/')}"
    return f"{base.rstrip('/')}/stream?url=" + urllib.parse.quote(media_url)

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    connected_clients.add(ws)
    print(f"📡 [UI HTML] Klien terhubung! Total aktif: {len(connected_clients)}")
    
    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    tipe = data.get("action") or data.get("t")

                    # Handshake / Auth dari kartu WhatsApp
                    if tipe in ("auth", "yl_kunci"):
                        await ws.send_json({"t": "auth_ok", "status": "authenticated"})
                        print("🔑 Handshake auth client berhasil")
                        continue

                    # Heartbeat
                    if tipe == "ping":
                        await ws.send_json({"t": "pong"})
                        continue

                    # 1. FITUR PENCARIAN
                    if tipe == "search":
                        query = data.get("q", "").strip()
                        print(f"🔍 [Search] Mencari lagu: '{query}'")
                        if query:
                            yt_id = extract_youtube_id(query)
                            if yt_id:
                                try:
                                    info = await asyncio.to_thread(get_savetube_download, yt_id)
                                    results = [{
                                        'id': yt_id,
                                        'title': info.get('title', 'YouTube Video'),
                                        'artist': 'YouTube',
                                        'duration': info.get('duration', '0:00'),
                                        'thumb': info.get('thumbnail', '')
                                    }]
                                except Exception:
                                    results = await asyncio.to_thread(search_youtube, query)
                            else:
                                results = await asyncio.to_thread(search_youtube, query)
                            
                            # Helper function untuk fetch thumbnail base64
                            async def fetch_thumb(url):
                                if not url or not url.startswith("http"): return ""
                                clean_url = url.split("?")[0]
                                headers = {"User-Agent": "Mozilla/5.0"}
                                try:
                                    async with aiohttp.ClientSession() as session:
                                        async with session.get(clean_url, headers=headers, timeout=2.5) as resp:
                                            if resp.status == 200:
                                                data_img = await resp.read()
                                                return "data:image/jpeg;base64," + base64.b64encode(data_img).decode('utf-8')
                                except: pass
                                return ""
                            
                            items_to_thumb = results[:8]
                            b64_list = await asyncio.gather(*(fetch_thumb(r.get('thumb', '')) for r in items_to_thumb))
                            for i, b in enumerate(b64_list):
                                items_to_thumb[i]['b64'] = b
                            for r in results:
                                if 'b64' not in r:
                                    r['b64'] = r.get('thumb', '')

                            await ws.send_json({
                                "action": "search_results",
                                "q": query,
                                "list": results
                            })
                        continue

                    # 2. RESOLVE LAGU PILIHAN USER
                    if tipe == "get_song":
                        video_id = data.get("id")
                        title = data.get("title", "")
                        artist = data.get("artist", "")
                        print(f"🎵 [GetSong] Mengambil lagu: {title} ({video_id})")

                        try:
                            audio_info = await asyncio.to_thread(get_savetube_download, video_id)
                            audio_url = audio_info.get("audioUrl", "")
                            if not audio_url:
                                raise Exception("Gagal mendapatkan link audio dari SaveTube")

                            lyrics = ""
                            try:
                                lyrics = await asyncio.to_thread(get_lyrics_py, title, f"{title} {artist}")
                            except Exception:
                                pass
                            
                            proxy_url = get_stream_proxy_url(request, audio_url)
                            thumb_url = audio_info.get("thumbnail", "")
                            await ws.send_json({
                                "action": "song_ready",
                                "id": video_id,
                                "title": audio_info.get("title", title),
                                "artist": artist or "YouTube Music",
                                "duration": audio_info.get("duration", "0:00"),
                                "thumb": thumb_url,
                                "thumb_b64": thumb_url,
                                "audioUrl": audio_url,
                                "proxyUrl": proxy_url,
                                "fullProxyUrl": proxy_url,
                                "lyrics": lyrics
                            })

                            if ws in client_tasks and not client_tasks[ws].done():
                                client_tasks[ws].cancel()
                            if audio_url:
                                client_tasks[ws] = asyncio.create_task(stream_audio_to_ws(ws, audio_url))

                        except Exception as err:
                            print("❌ Error get_song:", err)
                            await ws.send_json({"action": "song_error", "message": str(err)})
                        continue

                    # 2.5 FITUR VIDEO (YOUTUBE CLONE)
                    if tipe == "get_video":
                        video_id = data.get("id")
                        title = data.get("title", "")
                        artist = data.get("artist", "")
                        print(f"🎬 [GetVideo] Mengambil video: {title} ({video_id})")

                        try:
                            video_info = await asyncio.to_thread(get_savetube_video, video_id)
                            video_url = video_info.get("videoUrl", "")
                            proxy_url = get_stream_proxy_url(request, video_url)
                            
                            await ws.send_json({
                                "action": "video_ready",
                                "id": video_id,
                                "title": video_info.get("title", title),
                                "artist": artist or "YouTube",
                                "duration": video_info.get("duration", "0:00"),
                                "thumb": video_info.get("thumbnail", ""),
                                "videoUrl": video_url,
                                "proxyUrl": proxy_url,
                                "fullProxyUrl": proxy_url
                            })

                            if ws in client_tasks and not client_tasks[ws].done():
                                client_tasks[ws].cancel()
                                
                        except Exception as err:
                            print("❌ Error get_video:", err)
                            await ws.send_json({"action": "video_error", "message": str(err)})
                        continue

                    # 3. PLAY LANGSUNG DARI URL, VIDEO ID, ATAU PENCARIAN
                    if tipe == "play":
                        target = (data.get("url") or data.get("q") or data.get("id") or "").strip()
                        if not target:
                            await ws.send_json({"error": "URL atau nama lagu kosong"})
                            continue
                        
                        if ws in client_tasks and not client_tasks[ws].done():
                            client_tasks[ws].cancel()

                        # Cek apakah target mengandung link YouTube atau ID
                        yt_id = extract_youtube_id(target)

                        # Jika bukan link YouTube dan bukan link http/https direct, berarti kata kunci pencarian lagu!
                        if not yt_id and not (target.startswith("http://") or target.startswith("https://")):
                            print(f"🔍 [Play] Mencari otomatis lagu: '{target}'...")
                            search_res = await asyncio.to_thread(search_youtube, target)
                            if search_res:
                                yt_id = search_res[0]['id']
                                auto_title = search_res[0].get('title', target)
                                print(f"🎯 [Play] Ditemukan lagu: {auto_title} ({yt_id})")
                            else:
                                await ws.send_json({"error": f"Lagu tidak ditemukan untuk: {target}"})
                                continue

                        if yt_id:
                            print(f"🎵 [Play] Memproses YouTube ID: {yt_id}")
                            try:
                                audio_info = await asyncio.to_thread(get_savetube_download, yt_id)
                                audio_url = audio_info.get("audioUrl", "")
                                if not audio_url:
                                    await ws.send_json({"error": "Gagal mendapatkan audio stream dari SaveTube"})
                                    continue

                                proxy_url = get_stream_proxy_url(request, audio_url)

                                lyrics = ""
                                try:
                                    lyrics = await asyncio.to_thread(get_lyrics_py, audio_info.get("title", ""), f"{audio_info.get('title', '')}")
                                except Exception:
                                    pass

                                await ws.send_json({
                                    "action": "song_ready",
                                    "id": yt_id,
                                    "title": audio_info.get("title", "Lagu"),
                                    "artist": "YouTube Music",
                                    "duration": audio_info.get("duration", "0:00"),
                                    "thumb": audio_info.get("thumbnail", ""),
                                    "thumb_b64": audio_info.get("thumbnail", ""),
                                    "audioUrl": audio_url,
                                    "proxyUrl": proxy_url,
                                    "fullProxyUrl": proxy_url,
                                    "lyrics": lyrics
                                })
                                client_tasks[ws] = asyncio.create_task(stream_audio_to_ws(ws, audio_url))
                            except Exception as err:
                                print(f"❌ Error resolve play YT: {err}")
                                await ws.send_json({"error": f"Gagal memutar lagu: {str(err)}"})
                                continue
                        else:
                            # Direct streaming URL (misal direct mp3 link)
                            print(f"🎵 [Play] Memulai direct streaming dari: {target}")
                            client_tasks[ws] = asyncio.create_task(stream_audio_to_ws(ws, target))
                        
                    elif tipe == "stop":
                        if ws in client_tasks and not client_tasks[ws].done():
                            client_tasks[ws].cancel()
                        await ws.send_json({"action": "stopped"})
                        
                    else:
                        for client in connected_clients.copy():
                            if not client.closed:
                                await client.send_str(msg.data)
                                
                except json.JSONDecodeError:
                    for client in connected_clients.copy():
                        if not client.closed:
                            await client.send_str(msg.data)

            elif msg.type == aiohttp.WSMsgType.ERROR:
                print(f'❌ WebSocket error: {ws.exception()}')
                
    except ConnectionError:
        pass # Abaikan error jika klien terputus
    except Exception as e:
        print(f"❌ Terjadi kesalahan pada websocket: {e}")
    finally:
        if ws in client_tasks:
            if not client_tasks[ws].done():
                client_tasks[ws].cancel()
            del client_tasks[ws]
            
        connected_clients.discard(ws)
        print(f"❌ [UI HTML] Klien terputus. Sisa aktif: {len(connected_clients)}")
        
    return ws

# ---------------------------------------------------------
# 2. JALUR HTTP (PROXY STREAMING AUDIO & TUNNEL INFO)
# ---------------------------------------------------------
# 2. JALUR HTTP (PROXY STREAMING AUDIO/VIDEO & REST API)
# ---------------------------------------------------------
async def stream_handler(request):
    raw_target = request.query.get('url') or request.query.get('q') or request.query.get('id')
    if not raw_target:
        return web.Response(text="URL atau ID lagu kosong", status=400)

    target_url = raw_target
    yt_id = extract_youtube_id(raw_target)
    if yt_id:
        req_type = request.query.get('type', 'audio')
        try:
            if req_type == 'video':
                vinfo = await asyncio.to_thread(get_savetube_video, yt_id)
                target_url = vinfo.get('videoUrl', '')
            else:
                ainfo = await asyncio.to_thread(get_savetube_download, yt_id)
                target_url = ainfo.get('audioUrl', '')
        except Exception as err:
            return web.Response(text=f"Gagal resolve link YouTube: {err}", status=500)

    if not target_url:
        return web.Response(text="Stream URL tidak ditemukan", status=404)

    req_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
    }
    if 'Range' in request.headers:
        req_headers['Range'] = request.headers['Range']
        
    print(f"▶️ [Stream] Menerima request pemutaran lagu...")

    async with aiohttp.ClientSession() as session:
        async with session.get(target_url, headers=req_headers) as resp:
            if resp.status not in (200, 206):
                return web.Response(text="Gagal mengambil lagu dari sumber", status=resp.status)
            
            content_type = resp.headers.get('Content-Type')
            if not content_type or content_type == 'application/octet-stream':
                if '.mp4' in target_url:
                    content_type = 'video/mp4'
                else:
                    content_type = 'audio/mpeg'
            
            res_headers = {
                'Content-Type': content_type,
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Range, Content-Type',
                'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
            }
            if 'Content-Range' in resp.headers:
                res_headers['Content-Range'] = resp.headers['Content-Range']
            if 'Content-Length' in resp.headers:
                res_headers['Content-Length'] = resp.headers['Content-Length']

            response = web.StreamResponse(
                status=resp.status,
                reason=resp.reason,
                headers=res_headers
            )
            await response.prepare(request)
            
            try:
                async for chunk in resp.content.iter_chunked(32768):
                    await response.write(chunk)
            except (aiohttp.ClientConnectionResetError, ConnectionResetError, asyncio.CancelledError):
                pass
                
            return response

async def search_handler(request):
    """Endpoint HTTP search untuk pencarian video instan"""
    query = request.query.get('q', '').strip()
    if not query:
        return web.json_response({"list": []}, headers={'Access-Control-Allow-Origin': '*'})
    results = await asyncio.to_thread(search_youtube, query)
    return web.json_response({
        "q": query,
        "list": results[:12]
    }, headers={
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    })

async def song_api_handler(request):
    """REST API: Ambil metadata & stream url audio"""
    target = request.query.get('id') or request.query.get('q') or request.query.get('url', '')
    if not target:
        return web.json_response({"error": "Parameter id atau q diperlukan"}, status=400, headers={'Access-Control-Allow-Origin': '*'})
    
    yt_id = extract_youtube_id(target)
    if not yt_id:
        res = await asyncio.to_thread(search_youtube, target)
        if res:
            yt_id = res[0]['id']
        else:
            return web.json_response({"error": "Lagu tidak ditemukan"}, status=404, headers={'Access-Control-Allow-Origin': '*'})
    
    try:
        info = await asyncio.to_thread(get_savetube_download, yt_id)
        audio_url = info.get('audioUrl', '')
        host = request.headers.get("Host", f"178.128.96.217:{PORT}")
        scheme = "https" if request.secure or request.headers.get("X-Forwarded-Proto") == "https" else "http"
        direct_proxy = f"/stream?url=" + urllib.parse.quote(audio_url) if audio_url else ""
        full_proxy = f"{scheme}://{host}{direct_proxy}" if direct_proxy else ""
        
        lyrics = ""
        try:
            lyrics = await asyncio.to_thread(get_lyrics_py, info.get('title', ''), info.get('title', ''))
        except Exception:
            pass

        proxy_url = get_stream_proxy_url(request, audio_url)

        return web.json_response({
            "status": "success",
            "id": yt_id,
            "title": info.get('title'),
            "duration": info.get('duration'),
            "thumbnail": info.get('thumbnail'),
            "audioUrl": audio_url,
            "proxyUrl": proxy_url,
            "fullProxyUrl": proxy_url,
            "lyrics": lyrics
        }, headers={'Access-Control-Allow-Origin': '*'})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500, headers={'Access-Control-Allow-Origin': '*'})

async def video_api_handler(request):
    """REST API: Ambil metadata & stream url video"""
    target = request.query.get('id') or request.query.get('q') or request.query.get('url', '')
    if not target:
        return web.json_response({"error": "Parameter id atau q diperlukan"}, status=400, headers={'Access-Control-Allow-Origin': '*'})
    
    yt_id = extract_youtube_id(target)
    if not yt_id:
        res = await asyncio.to_thread(search_youtube, target)
        if res:
            yt_id = res[0]['id']
        else:
            return web.json_response({"error": "Video tidak ditemukan"}, status=404, headers={'Access-Control-Allow-Origin': '*'})
    
    try:
        info = await asyncio.to_thread(get_savetube_video, yt_id)
        video_url = info.get('videoUrl', '')
        proxy_url = get_stream_proxy_url(request, video_url)

        return web.json_response({
            "status": "success",
            "id": yt_id,
            "title": info.get('title'),
            "duration": info.get('duration'),
            "thumbnail": info.get('thumbnail'),
            "videoUrl": video_url,
            "proxyUrl": proxy_url,
            "fullProxyUrl": proxy_url
        }, headers={'Access-Control-Allow-Origin': '*'})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500, headers={'Access-Control-Allow-Origin': '*'})

async def tunnel_handler(request):
    """Endpoint untuk bot mengambil URL WSS & HTTPS aktif secara dinamis"""
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    }
    return web.json_response(TUNNEL_INFO, headers=headers)

async def tunnel_options(request):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    }
    return web.Response(headers=headers)

# ---------------------------------------------------------
# 3. STATIC FILES UNTUK UI DEMO
# ---------------------------------------------------------
async def index_handler(request):
    if os.path.exists('./public/index.html'):
        return web.FileResponse('./public/index.html')
    return web.FileResponse('./index.html')

async def style_handler(request):
    if os.path.exists('./public/style.css'):
        return web.FileResponse('./public/style.css')
    return web.Response(status=404)

async def app_js_handler(request):
    if os.path.exists('./public/app.js'):
        return web.FileResponse('./public/app.js')
    return web.Response(status=404)

# ---------------------------------------------------------
# START SERVER
# ---------------------------------------------------------
app = web.Application()
app.cleanup_ctx.append(run_cloudflared_tunnel)

import os
os.makedirs("temp_videos", exist_ok=True)
app.router.add_static('/video/', path='./temp_videos/', name='video')
if os.path.exists('./public'):
    app.router.add_static('/public/', path='./public/', name='public')

app.router.add_get('/', index_handler)
app.router.add_get('/style.css', style_handler)
app.router.add_get('/app.js', app_js_handler)
app.router.add_get('/ws', websocket_handler)
app.router.add_get('/search', search_handler)
app.router.add_get('/api/search', search_handler)
app.router.add_get('/stream', stream_handler)
app.router.add_get('/api/stream', stream_handler)
app.router.add_get('/api/song', song_api_handler)
app.router.add_get('/api/video', video_api_handler)
app.router.add_get('/tunnel', tunnel_handler)
app.router.add_options('/tunnel', tunnel_options)

if __name__ == '__main__':
    print(f"🚀 Escanor Python berjalan di port {PORT}")
    web.run_app(app, host='0.0.0.0', port=PORT)