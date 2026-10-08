# Deploy — Magic Board (frontend-src)

How to build and ship this app to Cloudflare. Copy-paste for PowerShell.

**Live URL:** https://xoai-cheese.ctbkod1612.workers.dev

The app is deployed as a **Worker with static assets** (an assets-only Worker — there is no
`main` script). `wrangler.jsonc` in this directory declares it; you do not need to create or
edit that file.

---

## One-time setup

```powershell
cd code\frontend-src
npm install

# Authenticate. Opens a browser; no API token to handle.
npx wrangler login
```

`wrangler login` is preferred for manual use — it stores OAuth credentials and you never
touch a key. If you would rather use an API token:

```powershell
$env:CLOUDFLARE_API_TOKEN  = "your-token"
$env:CLOUDFLARE_ACCOUNT_ID = "2a49d7d53dd2f0b0cd59e9b3350edacc"
```

Required token permissions: **Account → Cloudflare Pages → Edit**, **Account → Workers
Scripts → Edit**, **Account → Account Settings → Read**.

---

## Every deploy after that

```powershell
cd code\frontend-src
npm run build
npx wrangler deploy
```

Three lines. `npm run build` (which is `tsc -b && vite build`) produces `dist/`, and
`npx wrangler deploy` reads `wrangler.jsonc` and uploads it.

> **Run `wrangler deploy` from `code\frontend-src`.** That is where `wrangler.jsonc`
> lives. From the repo root wrangler will not find the config.

---

## Full commit-and-deploy cycle

```powershell
cd C:\Users\LENOVO\Documents\GitHub\aitc2026-team-377-xoai-cheese

git add -A
git commit -m "your message"
git push origin main

cd code\frontend-src
npm run build
npx wrangler deploy
cd ..\..
```

---

## Useful commands

```powershell
npx wrangler deploy --dry-run      # show what would upload, deploy nothing
npx wrangler whoami                # who am I logged in as
npx wrangler tail                  # live production logs
npx wrangler deployments list      # recent deployments
npx wrangler rollback              # roll back to the previous version
```

---

## Verifying a deploy

Do not trust wrangler's "Success" alone — check the site actually serves:

```powershell
$b = "https://xoai-cheese.ctbkod1612.workers.dev"

curl.exe -s -o NUL -w "HTTP %{http_code}`n" "$b/"
curl.exe -s -D - -o NUL "$b/mb-assets/atlas/body-0.bin.gz" | Select-String "HTTP/|access-control-allow-origin"
```

`/` must return **200**, and every `/mb-assets/*` path must return
`Access-Control-Allow-Origin: *`. That wildcard CORS header is **not optional**: artifact
simulations run inside sandboxed iframes on an opaque (`null`) origin, so every asset request
they make is cross-origin. This is stated explicitly in `public/_headers`; losing it makes
simulations render blank while the site itself still looks fine.

---

## Gotchas

**`spawn EPERM` or a Tailwind oxide error on build.** You are inside a restricted/confined
shell. In a normal terminal the build just works — these are sandbox artifacts, not real
failures.

**Never add `VITE_LLM_*` to `.env`.** Vite inlines every `VITE_`-prefixed value into the JS
bundle at build time, so a key placed there is readable by anyone who loads the page. `.env`
is gitignored and intentionally empty. Model endpoint, model id and API key are entered in
the app's Settings dialog at runtime and kept in the browser's local storage — by design
there is **no** build-time configuration, so no credential can ever leak into a deployment.

**`$env:` variables do not persist across shells.** If you use the token route instead of
`wrangler login`, either set them each session or persist them once with
`setx CLOUDFLARE_API_TOKEN "..."` and then open a new terminal.

**`.html` asset paths 307-redirect** to their extensionless form
(`/mb-assets/scenarios/sphere.html` → `/mb-assets/scenarios/sphere`, which serves 200).
Browsers follow this automatically. If a simulation ever loads blank, check this first.

---

## Automatic deploys (optional)

To deploy on every push instead of running the commands above, connect the repo in the
Cloudflare dashboard under **Workers & Pages → Workers Builds** with:

| Field | Value |
|---|---|
| Build command | `cd code/frontend-src && npm install && npm run build && npx wrangler deploy` |
| Deploy command | *(leave empty — it is already in the build command)* |
| Environment variables | **leave empty** — the app is configured at runtime |
| Protect with Cloudflare Access | **off**, or judges cannot reach the site |

The build command must `cd` into `code/frontend-src` because this is a monorepo and the
Vite app is not at the repo root.

Do **not** use `wrangler pages deploy` or `wrangler preview`. This project is deployed as a
Worker with static assets, not a Pages project, and `wrangler preview` was removed in
Wrangler v4.
