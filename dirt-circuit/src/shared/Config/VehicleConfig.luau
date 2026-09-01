--!nonstrict
-- VehicleConfig — base truck constants, the five upgrade ladders, and derived stats.
--
-- This is the whole balance surface of the game. It is data, and it is the ONLY thing
-- `VehicleSim` reads about a truck's capability, so tuning never means touching physics.
--
-- Monetization does not appear anywhere in this file, and must not. Cosmetics are the
-- product; handling is earned with race cash. (See LESSONS.md G-03 — a cosmetic-only,
-- non-random store also means the paid-random policy gate can never bite us.)

local VehicleConfig = {}

--------------------------------------------------------------------------------
-- Geometry & mass
--------------------------------------------------------------------------------

-- Collision radius. Trucks are circles to the solver — see ARCHITECTURE section 3.4.
VehicleConfig.Radius = 4.2
VehicleConfig.BodySize = Vector3.new(6.4, 4.0, 9.6)
VehicleConfig.RestHeight = 1.6 -- wheel centre to chassis bottom at rest

--------------------------------------------------------------------------------
-- Base handling (tier 0, on packed dirt)
--------------------------------------------------------------------------------

VehicleConfig.Base = {
	topSpeed = 108, -- studs/s
	accel = 58, -- studs/s^2 at full throttle
	brake = 132, -- studs/s^2
	reverseSpeed = 34,

	-- Lateral scrub rate. Velocity perpendicular to the truck decays as exp(-grip * dt).
	-- Exponential rather than subtractive: it is unconditionally stable and framerate
	-- independent, where a subtractive friction term overshoots into oscillation at low
	-- framerates. On a 30 fps phone that difference is the whole feel of the car.
	grip = 6.4,

	-- Radians/second of yaw at full steering lock, at a standstill.
	turnRate = 2.55,
	-- Yaw rate is multiplied by this at top speed. Arcade convention: you turn less the
	-- faster you go, which is what makes the throttle a steering input.
	turnRateAtTopSpeed = 0.42,
	-- Sliding sideways adds a little rotational authority — this is what lets a player
	-- hold a drift through a stadium hairpin.
	driftTurnBonus = 0.30,

	rollingDrag = 0.62, -- longitudinal drag coefficient (per second)

	-- Landing. `landingDamp` is the fraction of impact velocity removed on touchdown;
	-- `landingSpeedLoss` is the forward-speed penalty at a maximum-severity landing.
	landingDamp = 0.34,
	landingSpeedLoss = 0.34,
	-- Vertical impact speed treated as "as bad as it gets" when scaling the penalty.
	landingReferenceSpeed = 62,

	-- Rough-surface resistance, 0..1. Multiplies SurfaceConfig roughness downward.
	roughnessResist = 0.0,
}

VehicleConfig.Gravity = 178 -- studs/s^2. Tuned for hang time, not for realism.
VehicleConfig.AirDrag = 0.16
VehicleConfig.MaxAirborneHeight = 42 -- sanity ceiling; a launch above this is a bug

--------------------------------------------------------------------------------
-- Nitro
--------------------------------------------------------------------------------

VehicleConfig.Nitro = {
	duration = 1.5, -- seconds of uncapped top speed, per spec
	impulse = 46, -- instant forward studs/s added on trigger
	topSpeedMult = 1.42, -- the raised ceiling while active
	accelMult = 1.85,
	cooldown = 0.35, -- prevents double-tapping two charges into one burst
	maxStock = 8,
	enginePitchBoost = 0.35,
}

--------------------------------------------------------------------------------
-- Collision response
--------------------------------------------------------------------------------

VehicleConfig.Collision = {
	-- Truck vs truck: elastic-ish. Both trucks separate by half the penetration.
	truckRestitution = 0.55,
	-- The "trading paint" torque impulse, in radians/second of yaw per stud/second of
	-- tangential closing speed. Small on purpose: enough to unsettle, not enough to spin.
	truckYawImpulse = 0.020,
	maxTruckYawImpulse = 1.4,

	-- Wall: reflect the normal component, KEEP the tangential one. Keeping tangential
	-- velocity is exactly what makes a truck slide along a barrier instead of sticking,
	-- and it is why this cannot wedge the way a rigid-body solver does.
	wallRestitution = 0.32,
	wallTangentialScrub = 0.86, -- speed kept when scraping
	wallYawImpulse = 0.012,

	-- Anti-wedge: if a truck is still overlapping after resolution (an inside corner
	-- pinching it between two segments), push it toward the centreline instead.
	wedgeEscapeSpeed = 26,
	wedgePenetrationTolerance = 0.35,
}

--------------------------------------------------------------------------------
-- Upgrade ladders
--
-- Five ladders, per the spec. Index 0 is stock; `Tiers` is the count ABOVE stock.
-- Each entry is the ABSOLUTE value at that tier, not a delta, so a glance at the table
-- tells you the real spread between a stock truck and a maxed one.
--------------------------------------------------------------------------------

VehicleConfig.Tiers = 7

VehicleConfig.Upgrades = {
	tires = {
		label = "Tires",
		blurb = "Sharper turn-in, less slide.",
		grip = { 6.4, 7.5, 8.6, 9.7, 10.8, 11.9, 13.0, 14.2 },
		turnMult = { 1.00, 1.04, 1.08, 1.12, 1.17, 1.22, 1.28, 1.35 },
	},
	shocks = {
		label = "Shocks",
		blurb = "Softer landings, calmer over moguls.",
		landingDamp = { 0.34, 0.42, 0.50, 0.57, 0.64, 0.71, 0.78, 0.86 },
		landingSpeedLoss = { 0.34, 0.30, 0.26, 0.22, 0.18, 0.14, 0.10, 0.06 },
		roughnessResist = { 0.00, 0.12, 0.24, 0.36, 0.48, 0.60, 0.72, 0.84 },
	},
	acceleration = {
		label = "Acceleration",
		blurb = "Off the line and out of corners.",
		accel = { 58, 66, 74, 83, 92, 102, 113, 126 },
	},
	topSpeed = {
		label = "Top Speed",
		blurb = "Raises the ceiling on the long straight.",
		topSpeed = { 108, 116, 124, 132, 141, 150, 160, 172 },
	},
	nitro = {
		label = "Nitro",
		blurb = "Charges you carry into the race.",
		-- Not a handling stat: this ladder buys consumable stock, so it resets per race.
		stock = { 1, 2, 3, 4, 5, 6, 7, 8 },
	},
}

VehicleConfig.UpgradeOrder = { "tires", "shocks", "acceleration", "topSpeed", "nitro" }

--------------------------------------------------------------------------------
-- Derived stats
--------------------------------------------------------------------------------

local function pick(ladder: { number }, tier: number): number
	local i = math.clamp(math.floor(tier + 0.5), 0, #ladder - 1) + 1
	return ladder[i]
end

export type Stats = {
	topSpeed: number,
	accel: number,
	brake: number,
	reverseSpeed: number,
	grip: number,
	turnRate: number,
	turnRateAtTopSpeed: number,
	driftTurnBonus: number,
	rollingDrag: number,
	landingDamp: number,
	landingSpeedLoss: number,
	landingReferenceSpeed: number,
	roughnessResist: number,
	nitroStock: number,
}

-- Resolves an upgrade tier table into the flat stat block `VehicleSim` consumes.
--
-- Called ONCE, when a truck is seated on the grid, and the result is frozen into the race
-- session. A mid-race purchase can therefore never change physics, and the simulation never
-- does a table lookup per step. (Lesson E-02: cache immutable per-entity data at first
-- sight — Stellar Dominion's mob AI re-read five attributes per drone per frame at 60 Hz.)
function VehicleConfig.resolve(tiers: { [string]: number }?): Stats
	local t = tiers or {}
	local base = VehicleConfig.Base
	local up = VehicleConfig.Upgrades

	local tireTier = t.tires or 0
	local shockTier = t.shocks or 0

	return {
		topSpeed = pick(up.topSpeed.topSpeed, t.topSpeed or 0),
		accel = pick(up.acceleration.accel, t.acceleration or 0),
		brake = base.brake,
		reverseSpeed = base.reverseSpeed,

		grip = pick(up.tires.grip, tireTier),
		turnRate = base.turnRate * pick(up.tires.turnMult, tireTier),
		turnRateAtTopSpeed = base.turnRateAtTopSpeed,
		driftTurnBonus = base.driftTurnBonus,
		rollingDrag = base.rollingDrag,

		landingDamp = pick(up.shocks.landingDamp, shockTier),
		landingSpeedLoss = pick(up.shocks.landingSpeedLoss, shockTier),
		landingReferenceSpeed = base.landingReferenceSpeed,
		roughnessResist = pick(up.shocks.roughnessResist, shockTier),

		nitroStock = pick(up.nitro.stock, t.nitro or 0),
	}
end

-- Bot stat blocks are the same shape, so bots and players are the same code path all the
-- way down. `skill` is 0..1 and maps onto the same ladders players climb — which means a
-- bot can never have handling a player cannot eventually buy.
function VehicleConfig.resolveForBot(skill: number): Stats
	local s = math.clamp(skill, 0, 1)
	local tier = math.floor(s * VehicleConfig.Tiers + 0.5)
	return VehicleConfig.resolve({
		tires = tier,
		shocks = tier,
		acceleration = tier,
		topSpeed = tier,
		nitro = math.max(1, math.floor(s * 4 + 0.5)),
	})
end

return VehicleConfig
