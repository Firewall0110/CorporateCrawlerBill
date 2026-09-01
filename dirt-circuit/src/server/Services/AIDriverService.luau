--!nonstrict
-- AIDriverService — bot drivers.
--
-- Bots are NOT a parallel implementation of driving. Each one owns an ordinary `VehicleSim`
-- state and this service only produces the same `Input` table a human's controller sends:
-- `{ steer, throttle, brake, nitro }`. Everything downstream — physics, collision, laps,
-- pickups, payouts — is one code path for humans and bots alike.
--
-- That is a deliberate structural choice with two payoffs. Tuning the handling model tunes
-- the bots for free and can never desync them from players. And it makes a whole class of
-- bug impossible: on Stellar Dominion, bots existed outside the systems that tracked real
-- participants, and "bots are never in `participants`" had to be written down as a warning
-- in two separate memory files because things kept breaking on the seam.
--
-- Per-bot state is cached at creation and never re-read from attributes (Lesson E-02:
-- Stellar Dominion's mob AI re-read five attributes plus a stats lookup plus an `IsA` per
-- drone, every frame, at 60 Hz). All bots step from ONE shared loop (Lesson C-03).
--
-- Determinism note: bots run on the server only and their decisions never need to be
-- replayed, so `math.random` is fine here. `VehicleSim` itself stays deterministic; the
-- randomness lives entirely in what the bot *asks for*, exactly like a human's thumbs.

local VehicleConfig = require(game:GetService("ReplicatedStorage").Shared.Config.VehicleConfig)
local VehicleSim = require(game:GetService("ReplicatedStorage").Shared.Sim.VehicleSim)

local AIDriverService = {}

--------------------------------------------------------------------------------
-- Tuning
--------------------------------------------------------------------------------

local TUNING = {
	-- Pure pursuit: how far up the road the bot aims. Scales with speed, because a fixed
	-- lookahead either wobbles at speed or cuts corners when slow.
	lookaheadBase = 26,
	lookaheadPerSpeed = 0.34, -- studs of lookahead per stud/s of speed
	lookaheadMin = 18,
	lookaheadMax = 96,
	steerGain = 1.9,

	-- Corner speed. `cornerGrip` converts the truck's lateral grip stat into an effective
	-- maximum lateral acceleration, so a bot on better tyres genuinely carries more speed
	-- through a corner rather than being handed a scripted advantage.
	cornerGrip = 210,
	cornerLookahead = 130, -- studs of road scanned for the worst corner
	brakeBand = 14, -- how far over target speed before it brakes rather than lifts

	-- Racing line. Each bot gets a personality offset that drifts slowly along the lap, so
	-- eight bots do not drive one identical line nose-to-tail. This is most of what makes
	-- the pack look alive, and it is also the cheapest pile-up prevention there is.
	laneAmplitude = 0.42, -- fraction of half-width
	laneWavelength = 340, -- studs per full weave cycle

	-- Avoidance
	avoidRadius = 26,
	avoidCone = 0.55, -- dot-product threshold: only things roughly ahead count
	avoidStrength = 22,
	avoidBrakeDistance = 13,

	-- Nitro
	nitroStraightness = 0.0042, -- max curvature (rad/stud) still counted as "a straight"
	nitroLookahead = 150,
	nitroMinSpeedFrac = 0.55,
	nitroTrailingMargin = 0.35, -- progress units behind the leader before it bothers
	nitroCooldown = 3.5,
	nitroReactionMin = 0.15, -- bots are not frame-perfect
	nitroReactionMax = 0.55,

	-- Rubber-banding. Mild, and clamped hard in both directions: the pack should stay
	-- chaotic, not scripted. A bot that is ahead is slowed slightly; one that is behind is
	-- helped slightly. Never enough to overturn a well-driven lap.
	bandMax = 1.10,
	bandMin = 0.93,
	bandPerLapGap = 0.14, -- multiplier change per full lap of gap

	-- Human error, so bots are beatable and readable.
	steerNoiseAmplitude = 0.05,
	steerNoiseRate = 0.7,
	mistakeChancePerSecond = 0.035, -- brief throttle lift
	mistakeDuration = 0.45,
}

AIDriverService.TUNING = TUNING

local BOT_NAMES = {
	"Ironman",
	"Ratchet",
	"Bandit",
	"Muddy",
	"Sprocket",
	"Dizzy",
	"Boomer",
	"Tumble",
	"Gravel",
	"Wrench",
	"Skid",
	"Nitro",
	"Hazard",
	"Clutch",
	"Dozer",
	"Piston",
}

--------------------------------------------------------------------------------
-- Creation
--------------------------------------------------------------------------------

-- `skill` is 0..1 and maps onto the SAME upgrade ladders a player buys, so a bot can never
-- have handling that a player could not eventually own. (See VehicleConfig.resolveForBot.)
function AIDriverService.createBot(index: number, skill: number, spawn, league: string?)
	local stats = VehicleConfig.resolveForBot(skill)
	local vehicle = VehicleSim.create(string.format("bot_%d", index), stats, spawn)
	vehicle.isBot = true
	vehicle.displayName = BOT_NAMES[((index - 1) % #BOT_NAMES) + 1]

	return {
		vehicle = vehicle,

		-- Immutable, cached once. Nothing in the hot loop looks these up again.
		skill = skill,
		league = league,
		baseAccel = stats.accel,
		baseTopSpeed = stats.topSpeed,

		-- Personality
		lanePhase = math.random() * math.pi * 2,
		laneBias = (math.random() - 0.5) * 2 * TUNING.laneAmplitude,
		aggression = 0.45 + skill * 0.5 + math.random() * 0.2,
		noisePhase = math.random() * 100,

		-- Volatile
		nitroTimer = 0,
		nitroArmedAt = nil,
		mistakeUntil = 0,
		bandMult = 1,
	}
end

--------------------------------------------------------------------------------
-- Perception helpers
--------------------------------------------------------------------------------

-- Where the bot wants to be, `lookahead` studs up the road, including its personality
-- weave and any avoidance offset applied this step.
local function targetPoint(bot, track, lookahead: number, avoidOffset: number)
	local v = bot.vehicle
	local node = track:nodeAhead(v.node, lookahead)

	-- Slow lateral weave keyed to position on the lap, so the line varies but repeats —
	-- which reads as a driver with a preferred line rather than one who is drunk.
	local s = (node / track.nodeCount) * track.length
	local weave = math.sin(s / TUNING.laneWavelength * math.pi * 2 + bot.lanePhase)
	local offset = (bot.laneBias + weave * TUNING.laneAmplitude * 0.5) * track.halfWidth[node]

	return track:pointAt(node, offset + avoidOffset)
end

-- Lateral push away from nearby traffic, plus whether something is close enough dead ahead
-- to warrant lifting off. `field` is the array of every active vehicle in the race.
local function surveyTraffic(bot, field, fieldCount: number): (number, boolean)
	local v = bot.vehicle
	local fx, fz = -math.sin(v.heading), -math.cos(v.heading)
	local rx, rz = math.cos(v.heading), -math.sin(v.heading)

	local offset = 0
	local mustLift = false

	for i = 1, fieldCount do
		local other = field[i]
		if other ~= v and other.active then
			local dx = other.px - v.px
			local dz = other.pz - v.pz
			local d2 = dx * dx + dz * dz

			if d2 < TUNING.avoidRadius * TUNING.avoidRadius and d2 > 1e-6 then
				local d = math.sqrt(d2)
				local ux, uz = dx / d, dz / d

				-- Only care about things roughly in front. Being overtaken from behind is
				-- the overtaker's problem to solve.
				local ahead = ux * fx + uz * fz
				if ahead > TUNING.avoidCone then
					-- Steer away from whichever side they are on.
					local side = ux * rx + uz * rz
					local urgency = 1 - (d / TUNING.avoidRadius)
					offset -= math.sign(side) * TUNING.avoidStrength * urgency

					if d < TUNING.avoidBrakeDistance and math.abs(side) < 0.4 then
						mustLift = true
					end
				end
			end
		end
	end

	return offset, mustLift
end

--------------------------------------------------------------------------------
-- Nitro decision
--------------------------------------------------------------------------------

-- Fires on a straight, at speed, when it will actually gain something — and never dumps
-- the last charge early, so a bot always has an answer on the final lap.
local function wantsNitro(bot, track, leaderProgress: number, myProgress: number, totalLaps: number): boolean
	local v = bot.vehicle

	if v.nitroCount <= 0 or v.nitroTimer > 0 or bot.nitroTimer > 0 then
		return false
	end

	local speedFrac = math.sqrt(v.vx * v.vx + v.vz * v.vz) / math.max(v.stats.topSpeed, 1)
	if speedFrac < TUNING.nitroMinSpeedFrac then
		return false -- boosting into a corner exit you have not reached yet is wasted
	end

	-- Is there actually road to use it on?
	local curvature = track:maxCurvatureAhead(v.node, TUNING.nitroLookahead)
	if curvature > TUNING.nitroStraightness then
		return false
	end

	local finalLap = v.lap >= totalLaps - 1
	local trailing = (leaderProgress - myProgress) > TUNING.nitroTrailingMargin

	-- Hold one back for the last lap unless already there.
	if not finalLap and v.nitroCount <= 1 then
		return false
	end

	return trailing or finalLap or (math.random() < bot.aggression * 0.25)
end

--------------------------------------------------------------------------------
-- The think step
--------------------------------------------------------------------------------

-- Produces one `Input` for one bot. Called once per physics step, immediately before
-- `VehicleSim.step` for that bot — exactly where a human's input frame would arrive.
function AIDriverService.think(bot, track, field, fieldCount: number, ctx, dt: number): VehicleSim.Input
	local v = bot.vehicle

	if v.finished or not v.active then
		-- Coast to a stop rather than freezing mid-corner; a bot standing on the racing
		-- line at the end of a race is a hazard for whoever is still racing.
		return { steer = 0, throttle = 0, brake = 0.5, nitro = false }
	end

	local speed = math.sqrt(v.vx * v.vx + v.vz * v.vz)

	----------------------------------------------------------------------------
	-- 1. Rubber-banding
	--
	-- Applied by adjusting this bot's OWN stat block, not by special-casing the physics.
	-- The sim never learns that a bot exists.
	----------------------------------------------------------------------------

	local myProgress = VehicleSim.progress(v, track)
	local gapLaps = (ctx.leaderProgress - myProgress) / math.max(track.checkpointCount, 1)
	local band = math.clamp(1 + gapLaps * TUNING.bandPerLapGap, TUNING.bandMin, TUNING.bandMax)
	bot.bandMult = band
	v.stats.accel = bot.baseAccel * band
	v.stats.topSpeed = bot.baseTopSpeed * band

	----------------------------------------------------------------------------
	-- 2. Traffic
	----------------------------------------------------------------------------

	local avoidOffset, trafficLift = surveyTraffic(bot, field, fieldCount)

	----------------------------------------------------------------------------
	-- 3. Steering — pure pursuit toward a point up the road
	----------------------------------------------------------------------------

	local lookahead = math.clamp(
		TUNING.lookaheadBase + speed * TUNING.lookaheadPerSpeed,
		TUNING.lookaheadMin,
		TUNING.lookaheadMax
	)

	local tx, tz = targetPoint(bot, track, lookahead, avoidOffset)

	local dx, dz = tx - v.px, tz - v.pz
	local fx, fz = -math.sin(v.heading), -math.cos(v.heading)
	local rx, rz = math.cos(v.heading), -math.sin(v.heading)

	-- Bearing to the target in the truck's own frame. `atan2` of (lateral, longitudinal)
	-- gives a signed angle that is already the right sign for the steering axis.
	local forwardComponent = dx * fx + dz * fz
	local lateralComponent = dx * rx + dz * rz
	local bearing = math.atan2(lateralComponent, forwardComponent)

	local steer = math.clamp(bearing * TUNING.steerGain, -1, 1)

	-- A little hand-tremor so bots do not track a spline like a train.
	bot.noisePhase += dt * TUNING.steerNoiseRate
	steer += math.sin(bot.noisePhase * 3.1) * TUNING.steerNoiseAmplitude * (1 - bot.skill * 0.6)
	steer = math.clamp(steer, -1, 1)

	----------------------------------------------------------------------------
	-- 4. Throttle / brake — target speed from the worst corner ahead
	--
	-- v_max = sqrt(a_lat / kappa) is the real cornering limit for a given lateral
	-- acceleration budget and curvature, so a bot brakes for a hairpin and not for a kink
	-- without anyone hand-authoring a braking marker on any of the thirty tracks.
	----------------------------------------------------------------------------

	local curvature = track:maxCurvatureAhead(v.node, TUNING.cornerLookahead)
	local cornerGrip = TUNING.cornerGrip * (v.stats.grip / VehicleConfig.Base.grip)

	local targetSpeed
	if curvature > 1e-5 then
		targetSpeed = math.sqrt(cornerGrip / curvature)
	else
		targetSpeed = math.huge
	end
	targetSpeed = math.min(targetSpeed, v.stats.topSpeed * 1.4)

	-- Lower-skill bots are simply more cautious; that is a more honest difficulty knob than
	-- capping their top speed, because it shows up as slower corners rather than as a truck
	-- that mysteriously will not accelerate on the straight.
	targetSpeed *= (0.82 + bot.skill * 0.20)

	local throttle, brake = 1, 0
	if speed > targetSpeed + TUNING.brakeBand then
		throttle, brake = 0, math.clamp((speed - targetSpeed) / TUNING.brakeBand, 0.25, 1)
	elseif speed > targetSpeed then
		throttle = 0.35 -- lift, do not stamp
	end

	if trafficLift then
		throttle = math.min(throttle, 0.3)
	end

	-- Occasional mistakes keep the pack tight and make a win feel earned.
	if bot.mistakeUntil > ctx.now then
		throttle *= 0.4
	elseif math.random() < TUNING.mistakeChancePerSecond * dt * (1 - bot.skill) then
		bot.mistakeUntil = ctx.now + TUNING.mistakeDuration
	end

	-- Airborne: steering does nothing anyway (VehicleSim ignores it), but zeroing it here
	-- means the bot is not fighting a heading it cannot change on touchdown.
	if v.airborne then
		steer = 0
	end

	----------------------------------------------------------------------------
	-- 5. Nitro
	----------------------------------------------------------------------------

	if bot.nitroTimer > 0 then
		bot.nitroTimer = math.max(0, bot.nitroTimer - dt)
	end

	local nitro = false
	if bot.nitroArmedAt then
		-- A reaction delay was rolled; fire once it elapses and the road is still clear.
		if ctx.now >= bot.nitroArmedAt then
			bot.nitroArmedAt = nil
			if track:maxCurvatureAhead(v.node, TUNING.nitroLookahead * 0.6) <= TUNING.nitroStraightness then
				nitro = true
				bot.nitroTimer = TUNING.nitroCooldown
			end
		end
	elseif wantsNitro(bot, track, ctx.leaderProgress, myProgress, ctx.totalLaps) then
		bot.nitroArmedAt = ctx.now
			+ TUNING.nitroReactionMin
			+ math.random() * (TUNING.nitroReactionMax - TUNING.nitroReactionMin)
	end

	return { steer = steer, throttle = throttle, brake = brake, nitro = nitro }
end

--------------------------------------------------------------------------------
-- Shared step for the whole bot field
--------------------------------------------------------------------------------

-- One call, all bots. Never one connection or one loop per bot. (Lesson C-03: Stellar
-- Dominion replaced a per-missile Heartbeat with a single shared stepper for exactly this
-- reason, and the same pattern later fixed its damage-number GUIs.)
--
-- `field` is the flat array of every vehicle in the race, bots and humans alike, so
-- avoidance sees players too.
function AIDriverService.stepAll(bots, botCount: number, track, field, fieldCount: number, ctx, dt: number)
	for i = 1, botCount do
		local bot = bots[i]
		-- Per-entity pcall. Lesson C-07: on Stellar Dominion one player's spawn failure
		-- aborted the whole deploy loop and stranded everyone after them in the lobby. One
		-- bot's bad think step must not stop the other seven from driving.
		local ok, err = pcall(function()
			local input = AIDriverService.think(bot, track, field, fieldCount, ctx, dt)
			VehicleSim.step(bot.vehicle, input, track, dt)
		end)
		if not ok then
			warn(string.format("[AIDriverService] bot %d think/step failed: %s", i, tostring(err)))
			-- Keep it in the race but coasting, rather than leaving a frozen obstacle.
			VehicleSim.step(bot.vehicle, VehicleSim.NEUTRAL_INPUT, track, dt)
		end
	end
end

return AIDriverService
