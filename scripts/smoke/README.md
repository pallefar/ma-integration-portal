# Browser smoke harness (`npm run smoke`)

QUAL-02 / D-12-08. A one-command, real-browser net over the first
Integration-Lead pages: it boots an **isolated real-deal server**, signs in
through the real login page, visits each registered page at **1440x900** and
**390x844** in Chromium, and prints axe-core **critical / serious** counts plus
page errors, failed same-origin requests and missing landmarks.

It exists because nothing loaded the pages in a browser before (R5-03, R5-09
and R5-11 reached users that way). It is a developer / CI aid:

- **Never shipped** - `scripts/smoke/` is `export-ignore`d in `.gitattributes`,
  so release zips built with `git archive` do not contain it.
- **No repo dependency** - Playwright and axe-core are *not* in `package.json`
  and not in `node_modules/` (the repo is zero-install). They are resolved from
  the host, see below.
- **Never touches committed data** - the server runs with `MA_MODE=real` on a
  throw-away `MA_DATA_DIR` under `os.tmpdir()`; `data/*.db` is sha256-guarded
  and `git status -- data public/sent_emails` is compared before and after.

## Run it

```sh
PLAYWRIGHT_PATH=/path/to/node_modules/playwright \
AXE_CORE_PATH=/path/to/node_modules/axe-core \
  npm run smoke
```

Options (after `--`): `--pages login,org` (subset), `--out <dir>` (JPEG
screenshot per page x width), `--fail-on-axe` (exit 1 on any critical/serious),
`--headed`, `--help`.

Exit codes: `0` clean - `1` page errors / failed same-origin requests / missing
landmarks (or axe critical+serious with `--fail-on-axe`) - `2` cannot run (tool
missing, under 1 GB free in the temp dir, bad usage).

**axe counts are informational until Phase 19 gates them.** Today they are
printed for every page x width but do not change the exit code.

## Tool resolution

Resolved in this order, first valid package wins (a candidate must be a
directory whose `package.json` `name` is the tool):

1. `PLAYWRIGHT_PATH` / `AXE_CORE_PATH` - the package directory itself
2. `~/.npm/_npx/*/node_modules/<tool>` - the local npx cache
3. the global npm root (`npm root -g`)

The harness prints the resolved path and version of both, and **never installs
anything**. If one is missing it exits `2` and prints the fix. To get a copy
without touching this repo, install into any scratch directory *outside* the
repo (pin a version that is at least two weeks old) and point the variable at it:

```sh
npm install --prefix "$SCRATCH" axe-core@<pinned> --no-save --ignore-scripts
AXE_CORE_PATH="$SCRATCH/node_modules/axe-core" npm run smoke
```

> **`AXE_CORE_PATH` is a host-local path.** The Phase 12 evidence run used a
> pre-existing copy at `/Users/karstenhaldan/cv/node_modules/axe-core`
> (axe-core 4.11.1) and Playwright 1.62.1 from the local npx cache on the
> developer machine. Those paths are not a project dependency and mean nothing
> on another machine - each machine sets its own.

## Adding a page

A later UI phase adds its pages by **appending an entry to
`scripts/smoke/pages.js`** - never edit `run.js` for a page:

```js
{
  name: 'raid',            // used by --pages and the table
  path: '/raid.html',
  as: 'il',                // 'anonymous' | 'il' | 'admin'
  widths: [1440, 390],
  afterLoad: async (page) => { await page.click('#some-tab'); },   // optional
  allow: [{ url: /\/api\/thing$/, status: 404 }],                 // optional expected 4xx
  landmarks: ['main'],                                            // optional, default ['main']
},
```

The registry is mapped through `withDefaults()` at the bottom of the file, which merges
the shared `KNOWN_CONSOLE` allow-list into every entry. That list holds pre-existing site-wide console errors (today: the CSP rejecting
the Google Fonts `@import` in `style.css`); delete an entry when its cause is
fixed so the harness starts failing on a regression.

## What it does not do

- It does not fix anything or assert visual correctness - it is a *smoke* net:
  does the page load, does it stay on its URL, is it error-free, what does axe say.
- The accounts it creates are synthetic (`smoke.il`, a `Synthetic Smoke Target
  Co` deal) and live only in the temp data dir; generated passwords are never
  printed.
