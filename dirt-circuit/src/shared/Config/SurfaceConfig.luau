--!nonstrict
-- SurfaceConfig — how each track surface modifies the vehicle integrator.
--
-- Multiplicative modifiers only. VehicleSim reads these and never branches on a surface
-- name, so adding a surface is a table entry, not a code change.

local SurfaceConfig = {}

SurfaceConfig.Id = {
	DIRT = 1,
	MUD = 2,
	PUDDLE = 3,
	RUMBLE = 4, -- moguls / washboard
	TARMAC = 5, -- start-finish apron
}

-- grip       multiplies the lateral-velocity scrub rate. Lower = slides more.
-- accel      multiplies drive force.
-- topSpeed   multiplies the speed cap.
-- roughness  vertical jolt amplitude (studs/s of |vy| impulse per second of contact).
-- drag       extra longitudinal drag coefficient.
SurfaceConfig.Modifiers = {
	[SurfaceConfig.Id.DIRT] = {
		name = "Packed Dirt",
		grip = 1.0,
		accel = 1.0,
		topSpeed = 1.0,
		roughness = 0.0,
		drag = 0.0,
		dustColor = Color3.fromRGB(196, 164, 116),
	},
	[SurfaceConfig.Id.MUD] = {
		name = "Mud",
		grip = 0.55, -- increases slip angle, per spec
		accel = 0.62,
		topSpeed = 0.78,
		roughness = 0.0,
		drag = 1.6,
		dustColor = Color3.fromRGB(102, 82, 58),
	},
	[SurfaceConfig.Id.PUDDLE] = {
		name = "Puddle",
		grip = 0.40,
		accel = 0.70,
		topSpeed = 0.85,
		roughness = 0.0,
		drag = 2.2,
		dustColor = Color3.fromRGB(148, 176, 190),
	},
	[SurfaceConfig.Id.RUMBLE] = {
		name = "Moguls",
		grip = 0.85,
		accel = 0.92,
		topSpeed = 0.94,
		roughness = 26.0, -- the Shocks stat is what makes this survivable
		drag = 0.6,
		dustColor = Color3.fromRGB(178, 150, 108),
	},
	[SurfaceConfig.Id.TARMAC] = {
		name = "Apron",
		grip = 1.45,
		accel = 1.08,
		topSpeed = 1.05,
		roughness = 0.0,
		drag = 0.0,
		dustColor = Color3.fromRGB(120, 120, 128),
	},
}

SurfaceConfig.Default = SurfaceConfig.Modifiers[SurfaceConfig.Id.DIRT]

function SurfaceConfig.get(id: number?)
	return SurfaceConfig.Modifiers[id or SurfaceConfig.Id.DIRT] or SurfaceConfig.Default
end

return SurfaceConfig
