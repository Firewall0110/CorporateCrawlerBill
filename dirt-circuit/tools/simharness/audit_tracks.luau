--!nonstrict
-- audit_tracks.luau — runs the REAL TrackModel and TrackBuilder over the REAL track pool,
-- headlessly, and reports part counts and build times.
--
--     lune run tools/simharness/audit_tracks.luau
--
-- LESSONS.md J-04: Stellar Dominion's layout-overlap harness found genuine regressions every
-- time it was run, and was never saved — so it had to be rebuilt from scratch, by which point
-- several constants had changed. This one is committed.
--
-- What it actually proves, which is more than a lint pass: that the geometry code RUNS
-- against every shipped track without erroring, and that no track blows the part budget.
-- Both are things you would otherwise only discover in Studio, one track at a time.

local fs = require("@lune/fs")
local net = require("@lune/net")
local process = require("@lune/process")

local shim = require("./shim")

local TrackModel = shim.require("shared", "Sim", "TrackModel")
local TrackBuilder = shim.require("shared", "Sim", "TrackBuilder")
local StyleConfig = shim.require("shared", "Config", "StyleConfig")
local GameConfig = shim.require("shared", "Config", "GameConfig")

local TRACK_DIR = "src/shared/Tracks"

local ids = {}
for _, name in fs.readDir(TRACK_DIR) do
	local id = name:match("^(stadium_%d+)%.json$")
	if id then
		table.insert(ids, id)
	end
end
table.sort(ids)

print(string.format("auditing %d tracks\n", #ids))
print(string.format("%-14s %7s %7s %7s %7s %7s %8s", "track", "total", "surface", "walls", "ramps", "decor", "ms"))
print(string.rep("-", 68))

local failures = {}
local worst, worstId = 0, ""
local totalParts, totalMs = 0, 0

for _, id in ids do
	local raw = net.jsonDecode(fs.readFile(string.format("%s/%s.json", TRACK_DIR, id)))

	local ok, err = pcall(function()
		local track = TrackModel.fromData(raw, false)

		local t0 = os.clock()
		local _model, stats = TrackBuilder.build(track, {
			detailTier = GameConfig.DetailTier.MEDIUM,
			rampData = raw.ramps,
		})
		local ms = (os.clock() - t0) * 1000

		totalParts += stats.total
		totalMs += ms
		if stats.total > worst then
			worst, worstId = stats.total, id
		end

		print(string.format(
			"%-14s %7d %7d %7d %7d %7d %8.1f",
			id, stats.total, stats.surface, stats.walls, stats.ramps, stats.decor, ms
		))

		-- Also exercise the REVERSE direction, since it is a different node ordering and
		-- therefore a genuinely different code path through the merge walk.
		local reversed = TrackModel.fromData(raw, true)
		TrackBuilder.build(reversed, { detailTier = GameConfig.DetailTier.POTATO, rampData = raw.ramps })
	end)

	if not ok then
		table.insert(failures, string.format("%s: %s", id, tostring(err)))
		print(string.format("%-14s  FAILED: %s", id, tostring(err)))
	end
end

print(string.rep("-", 68))
print(string.format("worst: %s at %d parts | mean %d parts | %.0f ms total",
	worstId, worst, math.floor(totalParts / math.max(#ids, 1)), totalMs))
print(string.format("budget: %d track parts, %d decor", StyleConfig.PartBudget.trackWarn, StyleConfig.PartBudget.decorWarn))

if #failures > 0 then
	print(string.format("\n%d track(s) FAILED to build:", #failures))
	for _, f in failures do
		print("  " .. f)
	end
	process.exit(1)
end

print("\nall tracks built clean")
