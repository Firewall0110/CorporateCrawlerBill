--!nonstrict
-- physics_probe.luau — measures driving behaviour by running the REAL VehicleSim.
--
--     lune run tools/simharness/physics_probe.luau
--
-- Not a port and not a reimplementation: this loads src/shared/Sim/VehicleSim.luau itself,
-- steps it at the real fixed timestep against the real config tables, and reports what a
-- truck actually does. A reimplementation can agree with your belief about the code; only
-- the code can disagree with it.
--
-- Diagnostic, not a gate: it prints numbers to read rather than asserting. Once the
-- drivetrain is fixed it is worth turning the headline rows into assertions — "top speed
-- tier 7 reaches >= 95% of its cap", "stock shocks stay airborne < 20% of a rumble patch" —
-- and adding it to CI next to the geometry audit.

local shim = require("./shim")

local VehicleSim = shim.require("shared", "Sim", "VehicleSim")
local VehicleConfig = shim.require("shared", "Config", "VehicleConfig")
local SurfaceConfig = shim.require("shared", "Config", "SurfaceConfig")
local GameConfig = shim.require("shared", "Config", "GameConfig")

local DT = GameConfig.PhysicsStep

-- A flat, wall-free track of one uniform surface. Isolating a surface is the whole point:
-- on a real track you cannot tell a drag problem from a corner.
local function stubTrack(surfaceId, rampAt)
	local t = {
		nodeCount = 64,
		checkpointCount = 8,
		nodeSpacing = 8,
		cx = {},
		cz = {},
		cy = {},
		halfWidth = {},
	}
	for i = 1, 64 do
		t.cx[i], t.cz[i], t.cy[i], t.halfWidth[i] = 0, i * 8, 0, 40
	end
	function t:surfaceAt() return surfaceId end
	function t:groundHeightAt() return 0 end
	function t:rampAt(x, z) return rampAt and rampAt(x, z) or 0 end
	function t:nearestNode() return 1 end
	function t:crossedCheckpoint() return false end
	function t:tangentAt() return 0, 1 end
	function t:gatherWallSegments(_, _, _, out) table.clear(out) return 0 end
	function t:wallSegment() return 0, 0, 0, 0 end
	return t
end

local FULL = { steer = 0, throttle = 1, brake = 0, nitro = false }

local function newTruck(tiers)
	local stats = VehicleConfig.resolve(tiers)
	return VehicleSim.create("probe", stats, { x = 0, z = 0, heading = 0 }), stats
end

local function speedOf(v)
	return math.sqrt(v.vx * v.vx + v.vz * v.vz)
end

--------------------------------------------------------------------------------
print("=== CLAIM 3: does the topSpeed cap ever bind? ===")
print(string.format("%-10s %10s %10s %10s %8s", "surface", "reached", "stated cap", "predicted", "% of cap"))

for _, name in { "DIRT", "MUD", "PUDDLE", "RUMBLE", "TARMAC" } do
	local id = SurfaceConfig.Id[name]
	local surf = SurfaceConfig.get(id)
	local track = stubTrack(id)
	local v, stats = newTruck(nil)

	-- 40 s of full throttle is far past settling for every surface here.
	for _ = 1, 60 * 40 do
		VehicleSim.step(v, FULL, track, DT)
	end

	local cap = stats.topSpeed * surf.topSpeed
	-- Steady state of  vF' = accel - vF*drag  is  accel/drag.
	local predicted = (stats.accel * surf.accel) / (VehicleConfig.Base.rollingDrag + surf.drag)
	local reached = speedOf(v)
	print(string.format("%-10s %10.1f %10.1f %10.1f %7.0f%%", name, reached, cap, predicted, reached / cap * 100))
end

print("\n-- and across the Top Speed ladder, on dirt --")
print(string.format("%-6s %10s %10s %8s", "tier", "reached", "cap", "% of cap"))
for tier = 0, VehicleConfig.Tiers do
	local track = stubTrack(SurfaceConfig.Id.DIRT)
	local v, stats = newTruck({ topSpeed = tier })
	for _ = 1, 60 * 40 do
		VehicleSim.step(v, FULL, track, DT)
	end
	print(string.format("%-6d %10.1f %10.1f %7.0f%%", tier, speedOf(v), stats.topSpeed, speedOf(v) / stats.topSpeed * 100))
end

--------------------------------------------------------------------------------
print("\n=== CLAIM 1: control loss on a rumble strip ===")
print(string.format("%-16s %10s %10s %12s %10s", "shocks tier", "airborne%", "entry v", "exit v", "kept%"))

for _, tier in { 0, 3, 7 } do
	local track = stubTrack(SurfaceConfig.Id.RUMBLE)
	local v = newTruck({ shocks = tier, topSpeed = 3 })

	-- Enter the patch at a realistic pace rather than from rest.
	v.vx, v.vz = 0, -90
	local entry = speedOf(v)

	local airborne, steps = 0, 60 * 5
	for _ = 1, steps do
		VehicleSim.step(v, FULL, track, DT)
		if v.airborne then
			airborne += 1
		end
	end
	local exit = speedOf(v)
	print(string.format("%-16d %9.0f%% %10.1f %12.1f %9.0f%%", tier, airborne / steps * 100, entry, exit, exit / entry * 100))
end

--------------------------------------------------------------------------------
print("\n=== CLAIM 2: landing bounce chain after a ramp ===")
print(string.format("%-16s %8s %14s %14s", "shocks tier", "bounces", "no-control s", "speed kept%"))

for _, tier in { 0, 3, 7 } do
	local fired = false
	-- One ramp cell, hit once. stadium_08's strongest ramp is launch ~42.8.
	local track = stubTrack(SurfaceConfig.Id.DIRT, function()
		if not fired then
			fired = true
			return 42.76
		end
		return 0
	end)

	local v = newTruck({ shocks = tier, topSpeed = 3 })
	v.vx, v.vz = 0, -90
	local entry = speedOf(v)

	-- ⚠️ Count TOUCHDOWNS, not transitions into `airborne`.
	--
	-- The bounce path in VehicleSim sets `v.vy = bounce` and leaves `v.airborne` TRUE for
	-- the whole chain, so a counter watching for false->true transitions sees exactly one
	-- event no matter how many times the truck actually hits the ground. The first version
	-- of this probe did that and reported "0 bounces", which would have been read as the
	-- peer's claim failing to reproduce. The instrument was wrong, not the claim.
	--
	-- A touchdown is the step where vy flips from falling to rising. That is observable
	-- regardless of how the flag is managed.
	local airborneSteps, touchdowns = 0, 0
	local prevVy, settleAt = 0, nil
	local speedAtSettle = nil

	for step = 1, 60 * 8 do
		local wasAir = v.airborne
		VehicleSim.step(v, FULL, track, DT)

		if v.airborne then
			airborneSteps += 1
			if prevVy < 0 and v.vy > 0 then
				touchdowns += 1
			end
		elseif wasAir and not settleAt then
			settleAt = step
			speedAtSettle = speedOf(v)
		end
		prevVy = v.vy
	end

	print(string.format("%-16d %8d %14.2f %13.0f%%", tier, touchdowns,
		airborneSteps * DT, (speedAtSettle or speedOf(v)) / entry * 100))
end

--------------------------------------------------------------------------------
print("\n=== how much rumble is actually on the racing line? ===")
local fs = require("@lune/fs")
local net = require("@lune/net")
local TrackModel = shim.require("shared", "Sim", "TrackModel")

local worstId, worstPct = "", 0
local anyCount = 0
for _, file in fs.readDir("src/shared/Tracks") do
	local id = file:match("^(stadium_%d+)%.json$")
	if id then
		local track = TrackModel.fromData(net.jsonDecode(fs.readFile("src/shared/Tracks/" .. file)), false)
		local hits, total = 0, 0
		for i = 1, track.nodeCount do
			for _, frac in { -0.6, -0.2, 0.2, 0.6 } do
				local x, z = track:pointAt(i, frac * track.halfWidth[i])
				total += 1
				if track:surfaceAt(x, z) == SurfaceConfig.Id.RUMBLE then
					hits += 1
				end
			end
		end
		local pct = hits / total * 100
		if pct > 0 then
			anyCount += 1
		end
		if pct > worstPct then
			worstPct, worstId = pct, id
		end
	end
end
print(string.format("%d of 30 tracks have rumble on the driving line; worst is %s at %.1f%% of sampled points",
	anyCount, worstId, worstPct))

--------------------------------------------------------------------------------
-- Does the Top Speed ladder EVER do anything?
--
-- Reached speed is accel/drag, which does not reference topSpeed at all — so the cap only
-- binds where accel/drag would have exceeded it. That makes the two ladders coupled in a
-- way no player could infer: Top Speed is inert until Acceleration is already high.
print("\n=== reached speed by (Acceleration tier x Top Speed tier), on dirt ===")
print("rows = acceleration tier, cols = topSpeed tier. * marks where the cap actually binds.")
local header = string.format("%-6s", "acc\\ts")
for ts = 0, VehicleConfig.Tiers do
	header ..= string.format("%8d", ts)
end
print(header)

for acc = 0, VehicleConfig.Tiers do
	local row = string.format("%-6d", acc)
	for ts = 0, VehicleConfig.Tiers do
		local track = stubTrack(SurfaceConfig.Id.DIRT)
		local v, stats = newTruck({ acceleration = acc, topSpeed = ts })
		for _ = 1, 60 * 40 do
			VehicleSim.step(v, FULL, track, DT)
		end
		local reached = speedOf(v)
		local capBinds = reached >= stats.topSpeed - 0.5
		row ..= string.format("%8s", string.format("%.0f%s", reached, capBinds and "*" or " "))
	end
	print(row)
end
