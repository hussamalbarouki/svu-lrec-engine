# SVU LREC Cloud Engine (v0.3.0)

محرك سحابي لتحويل LREC إلى MP4، معالجته على VPS عبر Coolify. **لا يتم تخزين محتويات المحاضرات على cPanel**.

## التثبيت على Coolify

1. New Resource → Public Repository: `https://github.com/hussamalbarouki/svu-lrec-engine`
2. Branch: `main`, Build Pack: `Dockerfile`, Dockerfile: `/Dockerfile`, Exposed Port: `3000`.
3. Environment variables: `APP_ORIGIN=https://svu.hussamm.tech`, `ENGINE_SHARED_SECRET` (random, 32+ chars; must match site admin).
4. Domain: `https://engine.svu.hussamm.tech` with DNS A record of `engine.svu` pointing to VPS. Cloudflare proxy **DNS only**.
5. Deploy then verify `/healthz` reports `version: "0.3.0"` and `features.direct_download: true`.

## Design and important limits

- Browser uploads LREC directly to VPS in resumable 1MiB chunks. Only token issuance and subscriptions happen in PHP.
- Video conversion prefers a variable-frame-rate pipeline emitting actual screen-change PNG snapshots and preserving complete AAC audio; fallback is the previous bounded encoding path.
- Completed MP4 is downloaded by normal browser navigation with a short-lived capability link, **not via fetch/blob**. It can be recovered for the existing job without a second subscription debit while temporary files remain.
- Temporary LREC inputs are removed after processing. Video output remains on the VPS for the configured result TTL (default ~45min) and is subsequently deleted; it will be lost on VPS replacement or container recreation unless a persistent volume is mounted. The project does not require external storage.
- Do not redeploy while jobs are running; process state and files are in the container and redeploy can interrupt them.
- Health check is necessary but not proof that a full file works; test actual browser download and one full lecture first.

## Security

`ENGINE_SHARED_SECRET` must never be committed. Requests are signed HMAC-SHA256; the origin is restricted to `https://svu.hussamm.tech`. Output download tokens are short lived. Treat all logs and URLs as sensitive.

## Versions and testing

The v0.3 engine has been tested locally for chunked upload and direct download, and its native adaptive source has been tested with a complete `Download.lrec` sample (duration 3622.329 seconds) producing verified H.264/AAC in the local runtime. Your VPS performance and on-site end-to-end operation require testing after redeploy. The accompanying PHP 2.7 patch must be deployed **after** the engine health reports v0.3.0.
