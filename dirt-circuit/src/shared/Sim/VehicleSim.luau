--!nonstrict
-- VehicleSim — the arcade truck integrator.
--
-- ★ This module is the sole writer of a vehicle's motion state. There is no `BodyVelocity`,
-- no `BodyGyro`, no `AlignOrientation`, no `LinearVelocity`, and no Roblox rigid-body solver
-- anywhere near a truck. Trucks are `Anchored` models that a view layer moves with `PivotTo`
-- to match whatever this file computed. (Lesson C-01)
--
-- Why that is worth stating so loudly: the single most repeated root cause in the entire
-- Stellar Dominion post-mortem corpus is two systems writing one property. Its ships had
-- translation on the client and rotation on the server, so travel direction lagged heading
-- by a network hop and the error grew as `speed * sin(delta-heading)` — worst exactly when
-- it mattered, at speed, in a turn. The fix was not better tuning. The fix was one writer.
-- Then a leftover `BodyGyro` that a one-shot neutraliser had silently missed fought the new
-- drive and made orientation oscillate and settle at an offset. Both bugs are unreachable
-- from a design where nothing else can write motion at all.
--
-- The same module runs on the server (authority) and on the owning client (prediction). Not
-- a port of it — the same file. So client and server cannot disagree about the rules, only
-- about timing, which is what reconciliation is for. (Lesson C-02)
--
-- CONVENTIONS, obeyed by TrackModel, AIDriverService and CameraController too:
--   * XZ is the ground plane, Y is up.
--   * A heading `h` means `CFrame.Angles(0, h, 0)`, whose LookVector is `(-sin h, 0, -cos h)`
--     and whose RightVector is `(cos h, 0, -sin h)`. Stellar Dominion got this backwards
--     once and wrote the correction down; this is the correction.
--   * `dt` is ALWAYS the fixed step. Never pass a frame delta. See GameConfig.PhysicsStep.

local GameConfig = require(script.Parent.Parent.Config.GameConfig)
local VehicleConfig = require(script.Parent.Parent.Config.VehicleConfig)
local SurfaceConfig = require(script.Parent.Parent.Config.SurfaceConfig)
local Collision = require(script.Parent.Collision)
local Guards = require(script.Parent.Parent.Util.Guards)

local VehicleSim = {}

local NITRO = VehicleConfig.Nitro
local GRAVITY = VehicleConfig.Gravity
local AIR_DRAG = VehicleConfig.AirDrag

-- Below this speed the truck has no steering authority, so you cannot pirouette on the
-- spot. Arcade racers all do this; it reads as weight.
local STEER_AUTHORITY_SPEED = 8
-- Lateral speed at which the drift steering bonus is fully applied.
local FULL_SLIP_SPEED = 40
-- How fast an over-speed truck (nitro just ended) bleeds back to its cap.
local OVERSPEED_DECAY = 55
-- A landing bounce smaller than this just stops, rather than chattering forever.
local MIN_BOUNCE = 6
-- Washboard/mogul jolt frequency, in radians per stud travelled.
local ROUGH_FREQUENCY = 0.55

export type Input = {
	steer: number, -- -1 (left) .. 1 (right)
	throttle: number, -- 0..1
	brake: number, -- 0..1
	nitro: boolean,
}

VehicleSim.NEUTRAL_INPUT = { steer = 0, throttle = 0, brake = 0, nitro = false } :: Input

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

function VehicleSim.create(id: string, stats, spawn)
	return {
		id = id,
		stats = stats,
		active = true,

		-- Motion
		px = spawn.x,
		pz = spawn.z,
		heading = spawn.heading,
		vx = 0,
		vz = 0,
		y = 0, -- ABSOLUTE world height; the authoritative vertical state
		height = 0, -- derived: studs above the track surface directly below
		vy = 0,
		airborne = false,

		-- Last known good position, restored if the integrator ever produces a non-finite
		-- value. See the guard at the end of `step` (Lesson B-03).
		safePx = spawn.x,
		safePz = spawn.z,

		-- Cosmetic / feedback state, read by the view layer only
		susp = 0,
		roughPhase = 0,
		lastImpact = 0,
		lastLandingSeverity = 0,
		wheelSpin = 0,

		-- Nitro
		nitroCount = stats.nitroStock,
		nitroTimer = 0,
		nitroCooldown = 0,
		nitroFiredThisStep = false,

		-- Race progress
		node = 1, -- cached nearest centreline node; a hint, not authority
		lap = 0,
		cp = 0, -- checkpoints passed this lap
		cpTotal = 0, -- monotonic; the sortable half of `progress`
		finished = false,
		finishTime = nil,
	}
end

function VehicleSim.reset(v, spawn)
	v.px, v.pz = spawn.x, spawn.z
	v.safePx, v.safePz = spawn.x, spawn.z
	v.heading = spawn.heading
	v.vx, v.vz, v.vy = 0, 0, 0
	v.y = 0 -- snapped onto the surface by the first step's grounded branch
	v.height = 0
	v.airborne = false
	v.susp = 0
	v.roughPhase = 0
	v.lastImpact = 0
	v.nitroTimer = 0
	v.nitroCooldown = 0
	v.nitroCount = v.stats.nitroStock
end

--------------------------------------------------------------------------------
-- The step
--------------------------------------------------------------------------------

-- Advances one vehicle by exactly `dt`. Pure with respect to everything except `v` itself
-- and the read-only track — which is what makes prediction replay exact.
function VehicleSim.step(v, input: Input, track, dt: number)
	if not v.active then
		return
	end

	v.nitroFiredThisStep = false
	v.lastImpact = 0

	-- Sanitise input at the boundary. On the server this is a hostile client's payload; on
	-- the client it is our own controller, and validating both means there is exactly one
	-- definition of what an input frame may contain. (Lesson D-01)
	local steer = Guards.number(input.steer, -1, 1, 0)
	local throttle = Guards.number(input.throttle, 0, 1, 0)
	local brake = Guards.number(input.brake, 0, 1, 0)

	local stats = v.stats
	local surf = SurfaceConfig.get(track:surfaceAt(v.px, v.pz))

	-- Basis vectors for this heading.
	local h = v.heading
	local fx, fz = -math.sin(h), -math.cos(h)
	local rx, rz = math.cos(h), -math.sin(h)

	-- Decompose velocity into the truck's own frame. Everything longitudinal and lateral is
	-- reasoned about separately, which is the whole trick to arcade handling: they are
	-- different physical stories with different stats behind them.
	local vF = v.vx * fx + v.vz * fz
	local vL = v.vx * rx + v.vz * rz

	----------------------------------------------------------------------------
	-- 1. Nitro bookkeeping (runs airborne or not — you can boost off a jump)
	----------------------------------------------------------------------------

	if v.nitroCooldown > 0 then
		v.nitroCooldown = math.max(0, v.nitroCooldown - dt)
	end

	if input.nitro and v.nitroCount > 0 and v.nitroTimer <= 0 and v.nitroCooldown <= 0 then
		v.nitroCount -= 1
		v.nitroTimer = NITRO.duration
		v.nitroCooldown = NITRO.cooldown
		vF += NITRO.impulse
		v.nitroFiredThisStep = true
	end

	local nitroActive = v.nitroTimer > 0
	if nitroActive then
		v.nitroTimer = math.max(0, v.nitroTimer - dt)
	end

	----------------------------------------------------------------------------
	-- 2. Airborne vs grounded
	----------------------------------------------------------------------------

	if v.airborne then
		-- Steering input is ignored in the air, per spec. The truck keeps whatever heading
		-- and momentum it left the ramp with, which is what makes lining up a jump a skill.
		--
		-- Only vertical VELOCITY is advanced here. The vertical POSITION and the landing
		-- test happen in section 5, after the truck has moved horizontally, so they are
		-- resolved against the ground the truck is actually over rather than the ground it
		-- has just left.
		v.vy -= GRAVITY * dt

		vF -= vF * AIR_DRAG * dt
		vL -= vL * AIR_DRAG * dt
	else
		----------------------------------------------------------------------------
		-- 3. Grounded: steer, then drive, then scrub
		----------------------------------------------------------------------------

		local speed = math.abs(vF)
		local speedFrac = math.clamp(speed / math.max(stats.topSpeed, 1), 0, 1)

		-- Yaw rate falls as speed rises. This is the arcade convention that turns the
		-- throttle into a second steering input — lifting off tightens your line.
		local turn = stats.turnRate * (1 - (1 - stats.turnRateAtTopSpeed) * speedFrac)

		-- Already sliding? You get a little extra rotational authority, which is what lets
		-- a player hold a drift through a stadium hairpin instead of just understeering.
		local slipFrac = math.clamp(math.abs(vL) / FULL_SLIP_SPEED, 0, 1)
		turn *= (1 + stats.driftTurnBonus * slipFrac)

		-- No authority at a standstill, and the wheel reverses when reversing.
		local authority = math.clamp(speed / STEER_AUTHORITY_SPEED, 0, 1)
		local travelSign = (vF >= 0) and 1 or -1

		v.heading += steer * turn * authority * travelSign * dt
		h = v.heading
		fx, fz = -math.sin(h), -math.cos(h)
		rx, rz = math.cos(h), -math.sin(h)

		-- Drive.
		local accel = stats.accel * surf.accel * (nitroActive and NITRO.accelMult or 1)
		if throttle > 0 then
			vF += throttle * accel * dt
		end

		-- Brake, and reverse once stopped. Never let braking push you through zero in one
		-- step — that would make a tap of the brake reverse the truck at low speed.
		if brake > 0 then
			if vF > 0.5 then
				vF = math.max(0, vF - stats.brake * brake * dt)
			else
				vF = math.max(-stats.reverseSpeed, vF - stats.accel * 0.6 * brake * dt)
			end
		end

		-- Rolling and surface drag.
		vF -= vF * (stats.rollingDrag + surf.drag) * dt

		-- Speed cap. Nitro raises the ceiling rather than removing it, and an over-speed
		-- truck bleeds down instead of snapping, so the end of a boost is a decay, not a
		-- wall.
		local cap = stats.topSpeed * surf.topSpeed * (nitroActive and NITRO.topSpeedMult or 1)
		if vF > cap then
			vF = math.max(cap, vF - OVERSPEED_DECAY * dt)
		end

		-- Lateral scrub. Exponential decay, NOT a subtractive friction term: `exp(-k*dt)` is
		-- unconditionally stable and framerate-independent, where subtracting a constant
		-- overshoots through zero and oscillates once dt gets large. On a 30 fps phone that
		-- difference is the entire feel of the car, and it is why the fixed timestep and
		-- this line have to be designed together.
		local grip = stats.grip * surf.grip
		vL *= math.exp(-grip * dt)

		-- Moguls / washboard. Phase advances with distance travelled, so the jolt is a
		-- property of the ground rather than of the clock — two trucks crossing the same
		-- patch at the same speed get the same kick, and a replay reproduces it exactly.
		if surf.roughness > 0 and speed > 4 then
			v.roughPhase += speed * dt * ROUGH_FREQUENCY
			local resist = 1 - stats.roughnessResist
			local jolt = surf.roughness * resist * math.sin(v.roughPhase)
			if jolt > 0 then
				v.vy = jolt
				v.airborne = true
			end
			vF -= vF * 0.35 * resist * dt
		end

		-- Ramps launch. Checked after drive so you leave with the speed you built.
		local launch = track:rampAt(v.px, v.pz)
		if launch > 0 and speed > 12 then
			-- Launch scales with how fast you hit it: crawling over a ramp should not fling
			-- you across the stadium.
			v.vy = launch * math.clamp(speed / math.max(stats.topSpeed, 1), 0.35, 1.15)
			v.airborne = true
		end
	end

	----------------------------------------------------------------------------
	-- 4. Recompose and integrate
	----------------------------------------------------------------------------

	v.vx = fx * vF + rx * vL
	v.vz = fz * vF + rz * vL

	v.px += v.vx * dt
	v.pz += v.vz * dt

	-- Suspension relaxes toward rest. Visual only — the view layer reads it to squash the
	-- chassis on the wheels. Kept in the sim so it stays deterministic across a replay.
	v.susp = math.max(0, v.susp - dt * 3.2)
	v.wheelSpin += math.abs(vF) * dt * 0.35

	----------------------------------------------------------------------------
	-- 5. Vertical resolution — AFTER the horizontal move, on purpose.
	--
	-- `v.y` is the authoritative vertical state and is ABSOLUTE; `v.height` is derived from
	-- it for the view layer and the wire format. Doing it this way round is what makes a
	-- jump land correctly on sloped ground.
	--
	-- The first cut of this function integrated `height` (a value relative to the surface)
	-- while the truck was in the air, and never re-read the ground underneath it. A truck
	-- launched toward rising ground would therefore fly straight through the hill and land
	-- late, by exactly the elevation change — up to ~11 studs on these tracks, which is
	-- more than a truck is tall. selene flagged the leftover `groundY` as an unused local
	-- and that is how the bug surfaced: a dead variable was the visible symptom of a
	-- calculation that had been written and then not used.
	----------------------------------------------------------------------------

	local groundY = track:groundHeightAt(v.px, v.pz)

	if v.airborne then
		v.y += v.vy * dt

		if v.y <= groundY then
			------------------------------------------------------------------
			-- Landing. This is the entire payoff of the Shocks upgrade ladder.
			------------------------------------------------------------------
			local impact = math.max(0, -v.vy)
			v.y = groundY
			v.susp = 1

			local severity = math.clamp(impact / stats.landingReferenceSpeed, 0, 1)
			v.lastLandingSeverity = severity

			-- Speed you keep depends on how well the truck absorbs the hit. Applied to the
			-- planar velocity directly, since it has already been recomposed above — and a
			-- heavy landing scrubs momentum in every direction, not only forward.
			local keep = 1 - stats.landingSpeedLoss * severity
			v.vx *= keep
			v.vz *= keep

			-- Bounce is what the suspension fails to absorb.
			local bounce = impact * (1 - stats.landingDamp)
			if bounce > MIN_BOUNCE then
				v.vy = bounce
			else
				v.vy = 0
				v.airborne = false
			end
		end
	else
		-- Glued to the surface: follow the terrain rather than integrating through it.
		v.y = groundY
		v.vy = 0
	end

	v.height = math.max(0, v.y - groundY)

	----------------------------------------------------------------------------
	-- 6. Collision (walls only here; truck-vs-truck is resolved for the whole field
	--    at once by the caller, after every vehicle has been stepped)
	----------------------------------------------------------------------------

	if not v.airborne then
		local impact = Collision.resolveWalls(v, track)
		if impact > v.lastImpact then
			v.lastImpact = impact
		end
	end

	----------------------------------------------------------------------------
	-- 7. Track progress
	----------------------------------------------------------------------------

	VehicleSim._advanceProgress(v, track)

	----------------------------------------------------------------------------
	-- 8. Non-finite guard (Lesson B-03)
	--
	-- NaN satisfies `type(x) == "number"`, survives `math.clamp`, and makes every
	-- comparison false, so it would sail through any range check written above. One NaN
	-- here would corrupt this truck's position permanently AND replicate that corruption
	-- to all eight clients. So the last thing the step does is prove its own output.
	----------------------------------------------------------------------------

	if
		not (
			Guards.finite(v.px)
			and Guards.finite(v.pz)
			and Guards.finite(v.vx)
			and Guards.finite(v.vz)
			and Guards.finite(v.heading)
			and Guards.finite(v.height)
			and Guards.finite(v.y)
			and Guards.finite(v.vy)
		)
	then
		warn(string.format("[VehicleSim] non-finite state for %s; restoring last good position", v.id))
		v.px, v.pz = v.safePx, v.safePz
		v.vx, v.vz, v.vy = 0, 0, 0
		v.y = track:groundHeightAt(v.safePx, v.safePz)
		v.height = 0
		v.airborne = false
		if not Guards.finite(v.heading) then
			v.heading = 0
		end
	else
		v.safePx, v.safePz = v.px, v.pz
	end
end

--------------------------------------------------------------------------------
-- Progress / checkpoints
--------------------------------------------------------------------------------

function VehicleSim._advanceProgress(v, track)
	local prevX = v.prevProgressX or v.px
	local prevZ = v.prevProgressZ or v.pz
	v.prevProgressX, v.prevProgressZ = v.px, v.pz

	v.node = track:nearestNode(v.px, v.pz, v.node)

	-- Gates must be taken in order. A truck that cuts a corner simply does not advance,
	-- which makes cutting worthless without any heuristic anti-cheat and without ever
	-- teleporting a player back onto the track.
	local nextIndex = (v.cp % track.checkpointCount) + 1
	if track:crossedCheckpoint(nextIndex, prevX, prevZ, v.px, v.pz) then
		v.cp += 1
		v.cpTotal += 1
		if v.cp >= track.checkpointCount then
			v.cp = 0
			v.lap += 1
		end
	end
end

-- A single sortable scalar. Higher is further along; ties are broken by distance to the
-- next node, so two trucks abreast still get a stable order.
function VehicleSim.progress(v, track): number
	return v.cpTotal + (v.node / track.nodeCount) * 0.999
end

--------------------------------------------------------------------------------
-- Networking helpers
--------------------------------------------------------------------------------

-- Packs into a FLAT array of numbers, not a table per vehicle. Roblox charges per table in
-- a replicated payload, and at 8 trucks x 20 Hz that difference is most of the bandwidth
-- budget for the whole game.
local SNAPSHOT_FIELDS = 8

function VehicleSim.packInto(v, out: { number }, offset: number)
	out[offset + 1] = v.px
	out[offset + 2] = v.pz
	out[offset + 3] = v.heading
	out[offset + 4] = v.height
	out[offset + 5] = v.vx
	out[offset + 6] = v.vz
	out[offset + 7] = v.vy
	-- Flags packed into one number: airborne | nitro active | finished
	out[offset + 8] = (v.airborne and 1 or 0) + (v.nitroTimer > 0 and 2 or 0) + (v.finished and 4 or 0)
end

function VehicleSim.unpackInto(v, data: { number }, offset: number)
	v.px = data[offset + 1]
	v.pz = data[offset + 2]
	v.heading = data[offset + 3]
	v.height = data[offset + 4]
	v.y = v.height -- callers with a track rebase this; views only need the relative value
	v.vx = data[offset + 5]
	v.vz = data[offset + 6]
	v.vy = data[offset + 7]
	local flags = data[offset + 8]
	v.airborne = bit32.band(flags, 1) ~= 0
	v.finished = bit32.band(flags, 4) ~= 0
end

VehicleSim.SNAPSHOT_FIELDS = SNAPSHOT_FIELDS

-- Positional error between a local prediction and the server's truth, used to decide
-- between a soft correction and a hard snap + replay.
function VehicleSim.positionError(v, px: number, pz: number): number
	local dx, dz = v.px - px, v.pz - pz
	return math.sqrt(dx * dx + dz * dz)
end

--------------------------------------------------------------------------------
-- Fixed-timestep driver
--------------------------------------------------------------------------------

-- Consumes real frame time and runs whole physics steps.
--
-- Returns the number of steps run and the leftover fraction, so the view layer can
-- interpolate between the last two states instead of showing 60 Hz stutter on a 144 Hz
-- monitor. Capped at `MaxStepsPerFrame`: a hitch must not turn into a spiral of death where
-- catching up costs more time than it recovers.
function VehicleSim.advanceClock(accumulator: number, frameDt: number): (number, number)
	local step = GameConfig.PhysicsStep
	local acc = accumulator + math.min(frameDt, 0.25)
	local steps = math.floor(acc / step)
	if steps > GameConfig.MaxStepsPerFrame then
		steps = GameConfig.MaxStepsPerFrame
		acc = steps * step
	end
	return steps, acc - steps * step
end

return VehicleSim
