# Demo Runbook — M&A Integration Portal v2.0

A ~10-minute presenter script for the Readiness Assessment Suite + Execution Hub.
The story: **measure readiness on both sides → turn the gaps into owned work → watch the integration mature over 100 days → hand the board a one-pager.**

**Setup (30 seconds before you start):**
- `start.command` / `start.bat` (or `node server.js`) → http://localhost:3000
- Role selector: **Integration Leader** · Language: **English** (switch to Deutsch later for the i18n wow)
- Time travel: **Day 1** (header chip). Close the welcome banner.

> Optional login flavor: run a second instance with `PORTAL_AUTH=1 node server.js` and open `/login.html` — click **karen** to show real sign-in with server-enforced roles. Skip if time is tight.

---

## Act 1 — "We measure before we manage" (3 min)

1. **Sidebar → 🎯 Assessments.** Overview tab shows three *required* assessments with live status.
   - Say: *"Most integration tools track tasks. Ours starts one step earlier — it measures whether both companies and the integration leader are actually ready, and the scores drive everything else."*
2. **Target Readiness tab.** Day 1: NextGen scores **48 — At risk**, red flags on Systems & Data and Day-1 Readiness.
   - Point at the radar, the red-flag chips, and the **Recommended actions** cards.
   - Note the sensitivity footer — *"pre-close, this runs on clean-team-approved information only."*
3. **Click "Retake assessment"** and walk one section (the payroll scenario question lands well — it's judgment, not box-ticking). Back out or finish; a finished retake scores instantly server-side.
4. **Acquirer Readiness tab** — TE at **78**. *"We grade ourselves too — most acquirers never do."*
5. **Compatibility tab** — the money shot: overlaid radar, per-dimension gaps (Day-1 Δ51!), and the fit band.
   - Say: *"Alignment is 71, but the fit band says At risk — it's capped by the weaker side. Two unready companies that match each other still aren't a good deal. The tool refuses to flatter you."*

## Act 2 — "Scores become work" (2 min)

6. On **Target Readiness**, under Recommended actions, click **"Create tasks from recommended actions"** → *"✓ 4 tasks created."*
7. Follow the link to the **✅ Execution Hub**. Show the new tasks tagged **"From readiness assessment"** in Day 30, next to the seeded Day-1/100-day checklist (8 workstreams, RAG rollups, Operations blocked ⚠).
   - Say: *"That's the loop no competitor closes — assessment gaps become owned, dated, trackable work in one click."*
8. Flip through the **Synergy Tracker** ($2.9M of $43M realized) and **Risks & Decisions** tabs — click a status chip to cycle it live.
9. Point at the **🔔 bell** in the sidebar: blocked tasks and high-severity risks surface themselves.

## Act 3 — "The 100-day arc" (2 min)

10. **Time travel → Day 30**, back to Assessments: target is now **72 — Ready with support** (▲ trend vs Day 1). The **Integration Leader tab** now also shows the **manager rating** and the self-vs-manager gap dumbbells.
11. Show the **Development plan** (70-20-10): lowest competencies → stretch tasks (push one to the coaching checklist), coaching desk, IL Academy links.
12. **Time travel → Day 90**: target **87 — Ready**, IL **85 — Ready**. *"Explicit retakes, not made-up numbers — every score you saw was a real submission."*
13. **Dashboard → Integration KPIs**: the readiness strip (78 / 48→87 / alignment) sits above the classic 1–5 culture-diagnostic gauges — two instruments, clearly labeled.

## Act 4 — Close (2 min)

14. Assessments → Overview → **🖨 Exec readout** → print dialog → *"one page for the steering committee: four rings, the gap table, the leader's plan, workforce sentiment."* (Sentiment = anonymous employee change-readiness pulses, only shown at 5+ responses — show the employee portal card if asked.)
15. **Language selector → Deutsch** on any assessment page — everything flips, including the radar. *"Built for the target's workforce, not just the deal team: English, German, Chinese, Czech."*
16. Finale, if time: **Admin → Projects → + New Project** — pick *"Start from playbook"*. *"Every finished deal becomes the template for the next one. That's integration as a repeatable capability, not a one-off crisis."*
    - (Creating a project switches the workspace — switch back to **NextGen Sensors** afterwards to reset the demo.)

---

## Reset checklist after a demo
- Time travel back to **Day 1**, role **Integration Leader**, language **English**
- Delete any test projects (Admin → Projects) and test retakes (they simply become the newest score; harmless, but the seeded arc is cleaner)
- Demo logins (auth mode only): admin / karen / pmo · `TEdemo!2026`

## One-liners that land
- *"Two thirds of failed deals fail on people and culture — and no PMI platform measures readiness. This one gates the plan on it."*
- *"The fit score can't be gamed by mutual weakness."*
- *"From red flag to owned task in one click."*
- *"Self-hosted, zero-install, four languages — the target's employees get it in their own language on day one."*
