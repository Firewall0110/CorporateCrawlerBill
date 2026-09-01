--!nonstrict
-- GameConfig — race format, tick rates, and the device-detail tier.

local GameConfig = {}

--------------------------------------------------------------------------------
-- Race format (Super Off-Road: 8 trucks, 4 laps, single screen)
--------------------------------------------------------------------------------

GameConfig.MaxRacers = 8
GameConfig.Laps = 4
GameConfig.GaragePhaseSeconds = 30
GameConfig.CountdownSeconds = 4
GameConfig.PodiumSeconds = 12
-- Every session must terminate. Stragglers are DNF'd this long after the leader finishes.
GameConfig.DnfGraceSeconds = 45
-- Absolute ceiling, in case a truck ends up somewhere the checkpoint logic never advances.
GameConfig.RaceHardTimeoutSeconds = 480

--------------------------------------------------------------------------------
-- Tick rates
--
-- Lesson E-06: throttle what does not need 60 Hz, and never throttle what does. A 30 Hz
-- aim throttle on Stellar Dominion's missiles doubled the coast between corrections and
-- made fast missiles overshoot and whip around to re-acquire; it was reverted. Physics is
-- not a place to save frames.
--------------------------------------------------------------------------------

GameConfig.PhysicsHz = 60
GameConfig.PhysicsStep = 1 / 60
-- A hitch must not spiral: cap catch-up steps rather than trying to simulate a 2s stall.
GameConfig.MaxStepsPerFrame = 5

GameConfig.InputSendHz = 30
GameConfig.SnapshotHz = 20
GameConfig.HudRefreshHz = 10

-- Remote trucks render this far in the past so interpolation always has two samples to
-- work between. Slightly over one snapshot interval.
GameConfig.InterpolationDelay = 0.1

-- Prediction error above this (studs) forces a snap + replay rather than a soft correct.
GameConfig.ReconcileEpsilon = 3.0
GameConfig.ReconcileSoftRate = 6.0

--------------------------------------------------------------------------------
-- Detail tiers
--
-- Lesson E-04: gate cosmetics behind a tier and DEFAULT IT LOW. Stellar Dominion's default
-- was POTATO, and the single biggest mobile-GPU win was removing transient PointLights.
--------------------------------------------------------------------------------

GameConfig.DetailTier = {
	POTATO = 1,
	LOW = 2,
	MEDIUM = 3,
	HIGH = 4,
}

GameConfig.DefaultDetailTier = GameConfig.DetailTier.POTATO

-- What each tier is allowed to create at all. Read once at boot by DetailController; the
-- point is that lower tiers never construct the object, not that they hide it.
GameConfig.DetailBudget = {
	[GameConfig.DetailTier.POTATO] = {
		dustParticles = false,
		tyreMarks = false,
		nitroFlame = true, -- gameplay-readable: you must be able to see who boosted
		dynamicLights = false,
		shadows = false,
		-- Tilt-shift as a flat vignette ImageLabel. Costs nothing; reads the same.
		depthOfField = false,
		crowdAnimation = false,
	},
	[GameConfig.DetailTier.LOW] = {
		dustParticles = true,
		tyreMarks = false,
		nitroFlame = true,
		dynamicLights = false,
		shadows = false,
		depthOfField = false,
		crowdAnimation = false,
	},
	[GameConfig.DetailTier.MEDIUM] = {
		dustParticles = true,
		tyreMarks = true,
		nitroFlame = true,
		dynamicLights = false,
		shadows = true,
		depthOfField = true,
		crowdAnimation = false,
	},
	[GameConfig.DetailTier.HIGH] = {
		dustParticles = true,
		tyreMarks = true,
		nitroFlame = true,
		dynamicLights = true,
		shadows = true,
		depthOfField = true,
		crowdAnimation = true,
	},
}

--------------------------------------------------------------------------------
-- Camera (see docs/ARCHITECTURE.md section 5)
--------------------------------------------------------------------------------

GameConfig.Camera = {
	PitchDegrees = 55,
	FieldOfView = 55,
	-- Fraction of the viewport left as apron around the track's bounding box.
	FitMargin = 0.08,
}

return GameConfig
