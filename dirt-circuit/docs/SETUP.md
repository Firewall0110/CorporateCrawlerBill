# Setting up — first time with Rojo

Short version of the mental model, because it is the opposite of the Studio-MCP workflow:

> **Rojo does not push code into Studio. Studio pulls code from your disk.**

You run a small server on your machine (`rojo serve`), you click **Connect** in a Studio
plugin, and from then on every file you save on disk appears in Studio within about a
second. Nothing outside your machine ever touches your place.

This is deliberate, and it is `LESSONS.md` A-01 — the single most expensive lesson from the
last project. There, the game lived in the live Studio session and the repo was stale
scaffold, which meant no diffs, no review, no rollback, no CI, and no way to answer "what
changed and when". Here the repo *is* the game, and Studio is a renderer.

---

## Path A — just look at it (no toolchain, 30 seconds)

A prebuilt place file is the fastest way to see the tree. Open `DirtCircuit.rbxlx` in
Studio: **File → Open from File**. Everything is there — services, config, the 30 tracks
as ModuleScripts.

Good for a look. Not good for iterating: edits you make in Studio are not in git, and the
next build overwrites them. Use Path B to actually work.

You can regenerate that file any time with `rojo build --output DirtCircuit.rbxlx`.

---

## Path B — the real loop

### 1. Get the code

```bash
git clone https://github.com/Firewall0110/CorporateCrawlerBill.git
cd CorporateCrawlerBill
git checkout claude/roblox-game-dominion-lessons-dvefh2
cd dirt-circuit
```

### 2. Install the toolchain

[Rokit](https://github.com/rojo-rbx/rokit) is a version manager for Roblox tools. It reads
`rokit.toml` and installs the exact pinned versions, so your machine and CI run the same
binaries.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install.sh | bash
# Windows (PowerShell)
# irm https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install.ps1 | iex

rokit install        # installs rojo, selene, stylua, lune
rojo --version       # should print 7.5.1
```

If you would rather not use a version manager, install Rojo alone from
<https://github.com/rojo-rbx/rojo/releases> and skip the linters for now.

### 3. Install the Studio plugin

```bash
rojo plugin install
```

That drops the plugin into your local plugins folder. Restart Studio and a **Rojo** button
appears in the Plugins tab. (Alternatively, install "Rojo" from the Creator Store — make
sure it is version 7.x.)

### 4. Make a place

In Studio: **New → Baseplate**, then **File → Publish to Roblox As…** and create a new
experience. Publishing first matters, because two settings you need are only available on a
published place.

Then **Home → Game Settings**:

| Setting | Where | Why |
|---|---|---|
| **Enable Studio Access to API Services** | Security | `DataService` needs it or profiles silently never load in a Play test |
| **Allow HTTP Requests** | Security | needed later by `ErrorReporter` / feedback webhooks |

Delete the baseplate's `Terrain` and the default `SpawnLocation` when you get to building
the lobby; neither matters yet.

### 5. Connect

```bash
rojo serve          # in dirt-circuit/
```

In Studio, click **Rojo → Connect** (default `localhost:34872`). The tree fills in. Leave
`rojo serve` running and edit files in your editor — Studio updates as you save.

**Sync is one-way: disk → Studio.** Editing a synced script inside Studio will get
overwritten on the next change. That is the point, not a limitation. If you want to change
code, change the file.

---

## What Rojo owns, and what stays yours

From `default.project.json`, Rojo manages exactly these branches:

| Path | Managed |
|---|---|
| `ReplicatedStorage.Shared` | yes — replaced on sync |
| `ServerScriptService.Server` | yes — replaced on sync |
| `StarterPlayer.StarterPlayerScripts.Client` | yes — replaced on sync |
| `Workspace`, `Lighting`, `StarterGui`, `SoundService` | **properties only** |

Everything else in `Workspace` is yours. Rojo sets `StreamingEnabled = false`,
`Gravity`, the lighting preset and `ScreenOrientation = LandscapeSensor` on each sync, but
it will not delete parts you place by hand. So a lobby you build in Studio survives — though
see the note on the lobby below.

---

## What you will actually see today

Honestly: not a game. Press Play and you get two prints —

```
[DirtCircuit] server ready — build 0
[DirtCircuit] client ready
```

— and a baseplate. The simulation, collision, track model, AI, race lifecycle, persistence,
remotes and camera all exist and all pass the linters, but nothing calls them yet, because
the pieces that turn data into a visible world are not written:

* **`TrackBuilder`** — turns a `track.json` into stadium geometry. Until this exists there
  is nothing to drive on.
* **`LobbyService`** and the concourse — no bay doors, so no way to start a race.
* **`InputController`** — no keyboard/touch input is read.
* **Race HUD** — no lap counter, position or nitro readout.

`TrackBuilder` is the one that changes everything: with it, a track becomes visible, the
camera can frame it, and a race can be started from a command line in Studio without any
lobby. That is the shortest path from here to seeing eight trucks race.

---

## Building the lobby

Two workable options, and they mix:

1. **Build it by hand in Studio**, under a `Workspace.Lobby` folder. Rojo will not touch it.
   Fastest for a set-dressed space like the concourse.
2. **Generate it**, the way tracks are generated, so it is data in git.

For a rectangular concourse with bay doors, hand-building is the sensible call — it is a
one-off, and the parts that need to be *addressed by code* (the bay door prompts) can be
found by name. If it starts needing variants, move it to data.

⚠️ If you hand-build it, it lives only in the `.rbxl`, which is not in git. Either commit
the place file, or accept that the lobby is Studio-side state and back it up deliberately.
That tension is exactly what `LESSONS.md` A-01 is about — worth deciding on purpose rather
than by drift.

---

## Everyday commands

```bash
rojo serve                          # live sync while you work
rojo build --output DirtCircuit.rbxlx   # a place file, no Studio needed

selene src                          # lint (needs `selene generate-roblox-std` once)
stylua src                          # format
python3 tools/luau_check.py src     # structural check, no toolchain needed

python3 tools/trackgen/generate.py --count 30   # regenerate the track pool
open tools/trackgen/preview/index.html          # review all 30 as images
```

---

## Why not drive Studio over MCP, like the last project?

You can — a Roblox Studio MCP server lets an agent edit the live datamodel directly, and
that is how Stellar Dominion was built. Two reasons not to use it for *code* here:

1. **It reintroduces A-01.** The moment the live session is where code lives, the repo is
   stale, and everything that made the last project hard to change comes back: no diff, no
   review, no CI, no rollback, no history.
2. **This session cannot reach your machine anyway.** I am running in a cloud container. I
   have no Studio, no MCP connection to yours, and no way to see your place. Everything I
   produce arrives through git.

Where a Studio MCP genuinely helps is the stuff that is *not* code: eyeballing a build,
nudging set dressing, taking a screenshot of a layout. Use it for that if you have it, and
keep code flowing through Rojo.
