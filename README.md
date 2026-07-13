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

## Notes

- The demo dataset lives in **`db.json`** and ships with the app.
- To require a token for admin/write API calls (recommended for any public deployment), set the **`ADMIN_TOKEN`** environment variable before starting; while it is unset the API stays open for the demo.
- Override the port with the `PORT` environment variable (defaults to `3000`).
