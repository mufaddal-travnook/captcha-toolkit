# Deploying the BLS bot on EC2

The bot drives a **real (headed) Chromium** — headless rendering changes the
canvas/WebGL fingerprint, which the portal's anti-bot check flags. On a
server with no monitor we therefore run headed Chromium under **xvfb** (a
virtual display). `scripts/run.sh` handles this plus `.env` loading and a
single-instance lock.

---

## 1. Instance

- **Ubuntu 22.04 LTS**, **t3.small** (2 vCPU / 2 GB).
  - Captcha solving is **OpenAI-only** here (the default), so tesseract OCR
    isn't exercised — keeps memory use down.
  - 2 GB is tight for Chromium. If a run gets OOM-killed (check
    `dmesg | grep -i kill`), either run fewer combos per batch or add swap.
- 20+ GB disk.
- Security group: inbound **SSH (22)** only. The bot makes outbound calls only.

## 2. System dependencies

```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>

sudo apt update && sudo apt upgrade -y

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Virtual display (for headed Chromium) + git
sudo apt install -y xvfb git
```

## 3. Code + dependencies

```bash
git clone <your-repo-url> bls-bot
cd bls-bot
npm install

# Chromium + the OS shared libraries it needs
npx playwright install chromium
npx playwright install-deps chromium
```

## 4. Secrets (`.env`)

```bash
nano .env
```
```
OPENAI_API_KEY=sk-...
BLS_EMAIL=...
BLS_PASSWORD=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```
`.env` is gitignored — keep it on the server only.

## 5. Smoke tests

```bash
npm run typecheck
npm test

# Telegram reachable from the server?
node --env-file-if-exists=.env --import tsx -e \
 "import {createNotifier} from './src/features/notifier/index.ts'; \
  const n=createNotifier(); console.log('enabled:',n.enabled); \
  await n.notify('slot-available',{location:'TEST',message:'server alive',url:'x'})"

# One real run under the virtual display:
chmod +x scripts/run.sh
scripts/run.sh --batched
```

Logs land in `logs/run-<timestamp>.log` (latest 50 kept).

## 6. Schedule with cron

```bash
crontab -e
```
Add (every 30 minutes):
```cron
*/30 * * * * /home/ubuntu/bls-bot/scripts/run.sh --batched
```
- `scripts/run.sh` loads `.env`, runs under `xvfb-run`, and uses a `flock` lock
  so a slow run never overlaps the next tick (it just skips).
- Adjust the interval to taste. Every run = full logins + captchas + OpenAI
  calls, so don't set it too aggressive.

Check it's working:
```bash
tail -f logs/run-*.log         # live output of the latest run
grep -i "SLOT AVAILABLE" logs/*.log
```

## 7. Updating

```bash
cd ~/bls-bot
git pull
npm install
npx playwright install chromium   # if Playwright version changed
```

---

## Notes & gotchas

- **Keep `headed: true`** in `src/features/login-bot/config.ts`. `xvfb-run`
  gives headed Chromium a display; switching to headless re-introduces the
  detectable headless fingerprint.
- **Memory (t3.small / 2 GB)**: Chromium is the heavy part. If a run is
  OOM-killed (check `dmesg | grep -i kill`), reduce `batchSize` to 1 in
  `src/features/login-bot/config.ts` (one combo per session), avoid running
  other things on the box, or add swap.
- **Captcha solver**: OpenAI only (`--solver` defaults to `openai`). Don't pass
  `--solver ocr` on the server — OCR (tesseract) is heavier and less accurate.
- **Anti-bot reality**: a server IP (AWS range) is itself a mild signal. Even
  with xvfb, expect more `/account/bot` than on a residential connection. The
  batched mode (`--batched`) and Telegram alerts are designed around this.
- **Cost**: each scheduled run does 4 logins + dashboard captchas + 8 form
  captchas (OpenAI calls). Budget accordingly when picking the cron interval.
