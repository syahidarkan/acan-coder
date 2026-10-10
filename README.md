# My AI Coder

VS Code extension — AI coding assistant sekelas Cursor/Roo Code, 100% hemat token dengan free API auto-rotation dan Pure Script Engine lokal.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set API Keys
Buka Command Palette (`Cmd+Shift+P`) → **AI Coder: Set API Key**

Providers yang perlu di-set:
- `gemini` — dari [aistudio.google.com](https://aistudio.google.com)
- `groq` — dari [console.groq.com](https://console.groq.com)
- `openrouter` — dari [openrouter.ai](https://openrouter.ai)
- `sambanova` — dari [cloud.sambanova.ai](https://cloud.sambanova.ai)
- `unsplash` *(opsional)* — dari [unsplash.com/developers](https://unsplash.com/developers)
- `hermesToken` — string random buatanmu sendiri (sama dengan di `.env` Hermes)

### 3. Build
```bash
npm run build
```

### 4. Run Extension
Tekan `F5` di VS Code untuk launch Extension Development Host.

---

## Available Commands

| Command | Description |
|---|---|
| `AI Coder: Open Chat` | Buka chat panel utama |
| `AI Coder: Set API Key` | Simpan API key ke SecretStorage |
| `AI Coder: Set Project Context` | Deskripsi project untuk context AI |
| `AI Coder: Add Design Rule` | Tambah custom Anti-Slop rule |
| `AI Coder: Click to Clone UI` | Klik elemen browser → React component |
| `AI Coder: Fetch Assets` | Download foto/ikon dari Unsplash/Pexels/SVGL |
| `AI Coder: Run Scraper` | Scrape URL → Markdown |
| `AI Coder: Dry Run Scraper` | Test scraper script terhadap cached HTML |
| `AI Coder: View Training Log` | Parse log ML → chart interaktif |
| `AI Coder: Generate EDA` | CSV → Python EDA script + plots |
| `AI Coder: Profile VRAM` | Estimasi VRAM dari Python model file |
| `AI Coder: Create Presentation` | Teks → PPTX via AI |
| `AI Coder: Create Video` | Teks → Remotion video composition |
| `AI Coder: Use Prompt Template` | Pilih template dari library |
| `AI Coder: Save as Template` | Simpan prompt saat ini sebagai template |
| `AI Coder: Manage Templates` | Lihat semua templates |
| `AI Coder: Hermes Status` | Start/stop Hermes relay server |

---

## Setup Hermes (Remote Control via Telegram)

### Di Mac (VS Code Extension)
1. Set `hermesToken` via **AI Coder: Set API Key**
2. Jalankan **AI Coder: Hermes Status** → Start
3. Pastikan Tailscale aktif

### Di PC Rumah (Relay Server)
```bash
cd hermes-server
npm install
cp .env.example .env
# Edit .env dengan token bot Telegram dan IP Tailscale Mac
npm run dev
```

**Cara dapat ALLOWED_TELEGRAM_USER_ID:**
Kirim pesan ke bot `@userinfobot` di Telegram.

**Cara dapat MAC_TAILSCALE_IP:**
Di Mac: `tailscale ip -4`

### Perintah Telegram yang Tersedia
- `pull` / `update` — git pull
- `push "pesan"` — git add + commit + push
- `status` / `gimana` — git status
- `errors` / `log` — lihat errors terbaru
- `queue` / `task` — lihat status antrian script

---

## Architecture

```
Token Flow:
User Message → MemoryManager (Layer 0 pinned + Layer 1 rolling-8)
             → ApiRotator.route(taskType) → best available model
             → API call with retry + rotation on 429

Pure Script (0 Token):
- Scraping (Playwright + Readability + Turndown)
- Log parsing (regex multi-framework)
- VRAM estimation (formula-based)
- PPTX rendering (pptxgenjs)
- Asset download (axios streams)
- Self-healing selector (memory recall)
- CSS diff (browser defaults lookup)
```

## Database

SQLite di `~/.my-ai-coder/data.db` — conversations, selector memory, prompt templates, API usage.
