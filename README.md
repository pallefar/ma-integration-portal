# TE Connectivity — M&A Integration Portal

A self-contained demo of a Post-Merger Integration (PMI) portal covering the first 100 days of an acquisition.

## Run it

Grab the latest [release](https://github.com/pallefar/ma-integration-portal/releases) — two options:

**A. Zero-install (recommended).** The `…-windows.zip` and `…-macos.zip` bundles ship a portable Node runtime, so there is **nothing to install at all**:
- **Windows:** unzip, then double-click **`start.bat`**.
- **macOS:** unzip, then double-click **`start.command`**.

**B. Any OS (needs Node).** The plain `…zip` bundle needs [Node.js](https://nodejs.org/) (LTS) installed. All app dependencies (`node_modules`) are still bundled, so there is no `npm install` step — just run `start.bat` / `start.command`, or `node server.js`.

Either way the server starts on **http://localhost:3000** and your browser opens automatically. Keep the launcher window open; close it to stop the server. (The launchers use a bundled `./node` runtime if present, otherwise system Node.)

## What's inside

- **Landing page** with two demo roles — Integration Leader and Acquired Employee.
- **Admin console** at **`/admin.html`** — projects, courses, departments, processes, **HTML slides**, menus, **Quick-Nav bookmarks**, employees, banners, translations, and settings.
- **Client-side AI** (Transformers.js / "smolagents"): the library and ONNX runtime are served **locally** (no CDN). Model weights stream from the Hugging Face Hub on first use, then cache in the browser.

## Three modes

The same codebase runs in three modes, chosen by how it is launched (details and the first-run checklist are in [DEPLOYMENT.md](DEPLOYMENT.md)):

- **demo** — `start.command` / `start.bat` set `DEMO_OPEN=1`; the showcase runs open, with no login, on the committed demo data. Never use it for real deal data.
- **dev** — plain `node server.js`: sign-in is required, but the host uses the committed `data/*.db` and its published demo passwords, and accounts are read-only. For development and tests only.
- **real-deal** — `start-real-deal.command` / `start-real-deal.bat` run `MA_MODE=real` on their own gitignored data directory (`data/real`, or `MA_DATA_DIR`) with no demo accounts. Create the first admin with `node scripts/bootstrap-admin.js`, then manage people in the admin console **Users** tab. This is the only mode for MNPI.

## Notes

- The data layer is **SQLite** (`data/*.db`, see `db/store.js`); the demo dataset ships as the committed `data/demo.db`.
- Per-person accounts replace the shared `ADMIN_TOKEN`; the token still works as an optional, discouraged break-glass (see DEPLOYMENT.md).
- Override the port with the `PORT` environment variable (defaults to `3000`).
