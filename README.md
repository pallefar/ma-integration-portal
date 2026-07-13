# TE Connectivity — M&A Integration Portal

A self-contained demo of a Post-Merger Integration (PMI) portal covering the first 100 days of an acquisition.

## Run it (turnkey)

**Prerequisite:** [Node.js](https://nodejs.org/) (LTS). Everything else — all dependencies (`node_modules`) and the client-side AI library — is already bundled, so there is **no `npm install` step**.

- **Windows:** double-click **`start.bat`**.
- **macOS / Linux:** double-click **`start.command`** (or run `node server.js` in this folder).

The server starts on **http://localhost:3000** and your browser opens automatically. Keep the launcher window open; close it to stop the server.

## What's inside

- **Landing page** with two demo roles — Integration Leader and Acquired Employee.
- **Admin console** at **`/admin.html`** — projects, courses, departments, processes, **HTML slides**, menus, **Quick-Nav bookmarks**, employees, banners, translations, and settings.
- **Client-side AI** (Transformers.js / "smolagents"): the library and ONNX runtime are served **locally** (no CDN). Model weights stream from the Hugging Face Hub on first use, then cache in the browser.

## Notes

- The demo dataset lives in **`db.json`** and ships with the app.
- To require a token for admin/write API calls (recommended for any public deployment), set the **`ADMIN_TOKEN`** environment variable before starting; while it is unset the API stays open for the demo.
- Override the port with the `PORT` environment variable (defaults to `3000`).
