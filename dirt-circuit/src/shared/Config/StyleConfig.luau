--!nonstrict
-- StyleConfig — the entire visual language, as data.
--
-- Cosy minimalist voxel: flat colours, `SmoothPlastic` everywhere, no textures, no meshes,
-- no `SurfaceAppearance`, no uploads. That is the requested art direction AND the cheapest
-- thing a Roblox client can draw, which is the whole reason it survives contact with a weak
-- phone. (LESSONS.md H-04 and E-04.)
--
-- Nothing in TrackBuilder picks a colour or a size. It reads this file. Retheming the game
-- is editing one table.

local StyleConfig = {}

--------------------------------------------------------------------------------
-- Palette
--------------------------------------------------------------------------------

StyleConfig.Palette = {
	-- Racing surfaces. Two tones per surface so the trackbed can stripe subtly along its
	-- length; a single flat tan reads as a dead zone from a fixed overhead camera.
	dirt = Color3.fromRGB(201, 168, 118),
	dirtAlt = Color3.fromRGB(190, 157, 108),
	mud = Color3.fromRGB(112, 86, 58),
	mudAlt = Color3.fromRGB(100, 76, 51),
	puddle = Color3.fromRGB(132, 172, 190),
	puddleAlt = Color3.fromRGB(120, 160, 180),
	rumble = Color3.fromRGB(214, 176, 112),
	rumbleAlt = Color3.fromRGB(176, 140, 88),
	tarmac = Color3.fromRGB(128, 128, 136),
	tarmacAlt = Color3.fromRGB(118, 118, 126),

	infield = Color3.fromRGB(126, 176, 106),
	apron = Color3.fromRGB(150, 138, 118),

	wall = Color3.fromRGB(240, 234, 222),
	wallAccent = Color3.fromRGB(226, 92, 76),
	hayBale = Color3.fromRGB(226, 194, 112),

	startLineLight = Color3.fromRGB(246, 244, 238),
	startLineDark = Color3.fromRGB(58, 54, 62),

	rampFace = Color3.fromRGB(236, 186, 84),
	rampSide = Color3.fromRGB(206, 156, 66),

	floodPost = Color3.fromRGB(96, 100, 112),
	floodLamp = Color3.fromRGB(255, 246, 214),

	-- Crowd blocks. Cycled, not random, so a stadium looks designed rather than noisy.
	crowd = {
		Color3.fromRGB(232, 116, 100),
		Color3.fromRGB(246, 190, 96),
		Color3.fromRGB(122, 190, 160),
		Color3.fromRGB(138, 158, 224),
		Color3.fromRGB(232, 154, 196),
	},
}

-- Truck body colours by grid slot. Bright, distinct at a glance from a fixed wide camera —
-- readability at that distance is the constraint, not taste.
StyleConfig.TruckColors = {
	Color3.fromRGB(232, 92, 76), -- red
	Color3.fromRGB(84, 152, 232), -- blue
	Color3.fromRGB(246, 190, 72), -- yellow
	Color3.fromRGB(112, 200, 132), -- green
	Color3.fromRGB(238, 140, 208), -- pink
	Color3.fromRGB(150, 128, 236), -- violet
	Color3.fromRGB(250, 152, 72), -- orange
	Color3.fromRGB(112, 216, 226), -- cyan
}

--------------------------------------------------------------------------------
-- Geometry
--------------------------------------------------------------------------------

StyleConfig.Track = {
	-- The trackbed is split into this many lengthwise lanes so a mud patch can occupy one
	-- side of the track rather than colouring its whole width. More lanes = finer surface
	-- detail and more parts; this is the main part-count dial.
	laneCount = 5,

	surfaceThickness = 1.2,
	-- Segments overlap slightly along their length so no camera angle finds a seam.
	segmentOverlap = 1.04,

	-- Run merging. Consecutive segments on one lane collapse into a single part while the
	-- surface is unchanged AND the track has not turned more than this. On a long straight
	-- that turns ~30 parts into one; through a hairpin it tessellates finely. This is the
	-- single biggest reason a track is a few hundred parts instead of a few thousand.
	maxRunDeviation = math.rad(5),
	maxRunNodes = 14,

	wallHeight = 4.4,
	wallThickness = 1.6,
	-- Every Nth wall segment is drawn in the accent colour — cheap visual rhythm that also
	-- helps a player judge distance around a corner.
	wallAccentEvery = 7,

	hayBaleEvery = 11,
	hayBaleSize = Vector3.new(3.2, 2.6, 5.4),

	-- Ramps are built as stacked steps rather than a WedgePart: correct by construction
	-- (no wedge-orientation guessing), on-style for voxel, and still only a few parts.
	rampSteps = 4,
	rampStepHeight = 0.85,

	startLineStripes = 12,
	startLineDepth = 5,

	infieldInset = 2.0,
	apronPadding = 46,
}

StyleConfig.Decor = {
	floodlightCount = 6,
	floodlightHeight = 34,
	floodlightPostSize = Vector3.new(2.2, 34, 2.2),
	floodlightLampSize = Vector3.new(9, 2.4, 4),

	-- Crowd stands ring the outside. Blocks, not seats — at this camera distance a stand is
	-- a colour band, and anything finer is parts nobody can resolve.
	crowdRows = 3,
	crowdBlockSize = Vector3.new(14, 3.2, 8),
	crowdGap = 3,
	crowdRise = 2.6,
	-- Total crowd blocks across ALL rows. TrackBuilder spends this budget by WIDENING the
	-- spacing until a full ring fits, never by stopping partway: a complete sparse ring
	-- looks like a stadium, a truncated dense one looks like a bug.
	crowdMaxBlocks = 300,
}

StyleConfig.Truck = {
	bodySize = Vector3.new(5.6, 2.2, 8.4),
	cabSize = Vector3.new(4.6, 2.0, 3.2),
	cabOffset = Vector3.new(0, 2.0, -0.6),
	rollBarSize = Vector3.new(4.8, 0.5, 0.5),
	rollBarOffset = Vector3.new(0, 3.3, 1.0),
	wheelSize = Vector3.new(1.6, 2.6, 2.6),
	wheelInset = 3.0,
	wheelForward = 2.7,
	wheelDrop = 0.6,
	wheelColor = Color3.fromRGB(46, 44, 52),
	glassColor = Color3.fromRGB(120, 190, 214),
	-- How far the chassis squats onto the wheels at full suspension compression.
	suspensionTravel = 0.9,
}

--------------------------------------------------------------------------------
-- Budget
--------------------------------------------------------------------------------

-- Not a hard cap — a warning threshold. A track that blows past this is a content bug
-- (probably a pathological width or spacing) and should be caught at build time rather
-- than as a frame-rate complaint from a player on a five-year-old phone.
StyleConfig.PartBudget = {
	trackWarn = 1600,
	decorWarn = 400,
}

--------------------------------------------------------------------------------

-- Surface id -> (primary, alternate) colour. Keyed by SurfaceConfig.Id, resolved lazily so
-- this module has no dependency on SurfaceConfig (and no require cycle).
StyleConfig.SurfaceColorNames = {
	[1] = { "dirt", "dirtAlt" },
	[2] = { "mud", "mudAlt" },
	[3] = { "puddle", "puddleAlt" },
	[4] = { "rumble", "rumbleAlt" },
	[5] = { "tarmac", "tarmacAlt" },
}

function StyleConfig.surfaceColor(surfaceId: number, alternate: boolean): Color3
	local names = StyleConfig.SurfaceColorNames[surfaceId] or StyleConfig.SurfaceColorNames[1]
	return StyleConfig.Palette[names[alternate and 2 or 1]]
end

return StyleConfig
