# Recording the `/skillfed` demo GIF

A ~20–30s real capture of a live `/skillfed` run for the README. This is a **real recording**,
lightly trimmed — never a fabricated or re-enacted session. The output lands at
[`assets/demo.gif`](../assets/demo.gif) and supplements the stylized `assets/demo.svg` hero.

Tool: **[ScreenToGif](https://www.screentogif.com/)** (free, native Windows). asciinema/VHS aren't
used — they need WSL/Go/ffmpeg this machine doesn't have, and VHS would be a scripted re-enactment.

---

## 1. Set the stage (before hitting record)

- **Fresh terminal, scratch directory.** Run the demo in a throwaay folder (e.g. `~/skillfed-demo`),
  NOT a real project. Nothing on screen should be a private path.
- **Brand-match the terminal** so the GIF sits beside the other assets:
  - Font: **IBM Plex Mono** (fallback Consolas), size ~16–18pt.
  - Background cream `#F7F3EB`, text ink `#1E1B16`, accent violet `#7C5CDB` if your theme allows.
  - Window ~**96×28** cells. Hide tabs/side panels; a clean single pane.
- **Scrub the chrome:** no title bar showing a private path, no visible env vars, no other repo
  names, no tokens. Maximize just the terminal.

### Privacy checklist (non-negotiable — this is a privacy tool)
- [ ] Prompt shows a neutral cwd (`~/skillfed-demo`), not a real path
- [ ] No `SKILLFED_*` tokens, API keys, or `.env` contents visible
- [ ] No other client/repo names in scrollback
- [ ] Title bar / tab text scrubbed
- [ ] Do a dry run first and read every visible line

## 2. The capture — storyboard (the *honest* flow)

Use the **same scenario as `demo.svg`** for brand coherence:

```
claude
/skillfed automate monthly vendor-invoice reconciliation
```

The recording must show what actually happens — not the simplified one-match-per-wish view.
Capture these five beats:

1. **Command entered** — `/skillfed automate monthly vendor-invoice reconciliation`.
2. **Abstract wishes go out** — the agent writes 3 wishes, each a description + ~4 paraphrases +
   a capability sketch. Show (even briefly) that *only these* cross the boundary — capability
   vocabulary, never the task/files. This is the privacy beat.
3. **Multiple ranked candidates come back** — per wish, several results, ranked by score, each
   with real trust metadata: license class (`permissive`/`review`), provenance, stars, source.
   The PDF wish returns ~5 (top: `azure-ai-document-intelligence`, permissive · verified · 2607★).
4. **The agent selects** the best per wish (or rejects all) — show the chosen one highlighted.
5. **Install approval** — "Install the selected? → .claude/skills/ with license + source."

Stop once the approval/confirmation is on screen. Do **not** hide the messiness: real matches
include `review`-license and low/zero-star skills alongside the strong ones — that honesty is the
point (it proves these are real catalog results, and shows the trust signals doing their job).

ScreenToGif recorder: capture the terminal region (~**960×600**), **12–15 fps**.

## 3. Trim + optimize (ScreenToGif editor)

Goal: **~20–30s**, **< ~3 MB**, clean loop.

1. **Remove duplicate frames** (Edit → Reduce Frame Count / Remove Duplicates) — kills idle time.
2. **Trim the verbose middle**: delete long stretches of agent reasoning / tool calls. Keep
   command → table → approval. *Trim dead frames only — never edit the actual output text.*
3. **Resize** to **720px wide** (matches the README embed).
4. **Reduce palette** (Save As → GIF → fewer colors, e.g. 128) to shrink size.
5. Ensure **loop = infinite**.
6. Save as `assets/demo.gif`.

If it's still > ~3 MB, either drop to 10 fps, shorten, or run a second pass with `gifsicle`
(available via Node in `frontend-env`): `gifsicle -O3 --lossy=80 --colors 128 in.gif -o demo.gif`.

## 4. Hand off

Drop the file at `assets/demo.gif`. Then this exact block goes into `README.md` **right below the
`demo.svg` hero** (line ~22, still inside the centered `<div>`) — kept collapsed so the top stays
clean, and only added once the file exists so nothing renders broken:

```html
<details>
<summary>▶ Watch a real ~25s run</summary>

<img src="assets/demo.gif" alt="A real /skillfed run: the agent writes abstract wishes, the federation returns ranked vetted matches with license and trust metadata, and the chosen skills install to .claude/skills after approval" width="720">

</details>
```

Final step is commit + verify it renders on GitHub (the raw-CDN/proxy cache can lag a few minutes —
same as the badges). Ship `.gitattributes` (the `*.gif binary` rule), this runbook, `assets/demo.gif`,
and the README block together as one commit.

**Honesty rule:** the wish→match table and install prompt shown must be the real ones from the run.
Trimming pacing is fine; changing what the tool "said" is not.
