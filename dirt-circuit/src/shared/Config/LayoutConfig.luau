--!nonstrict
-- LayoutConfig — ★ every HUD reserve constant, in one table, restated nowhere.
--
-- Lesson F-02. On Stellar Dominion these lived in `ClientState.LAYOUT` and the rule was
-- written as "ONE source of truth — never restate them", because restating one is a bug by
-- construction: a constant changed in one file and not the other produced overlapping HUD
-- on exactly the devices nobody was testing on.
--
-- THE BINDING CONSTRAINT IS LANDSCAPE HEIGHT, NOT WIDTH (F-01). A landscape phone viewport
-- is 360-430 px TALL. Stellar Dominion's virtual joystick was a fixed 260 px, i.e. 68-82%
-- of the screen height, and every "nothing fits at the bottom" bug downstream traced back
-- to that one number. Mobile was over 60% of its players.
--
-- Dirt Circuit's HUD is deliberately tiny, because the camera is fixed and the whole track
-- is always on screen: cover the track and you have broken the game, not just the layout.

local LayoutConfig = {}

-- The resolution every offset below is authored against. Anything measured on a desktop at
-- this exact size proves nothing about a phone (F-04) — that is why the audit tool exists.
LayoutConfig.BaselineViewport = Vector2.new(1280, 720)

-- Viewport heights at or below this get the compact HUD. Chosen to sit just above the
-- 430 px landscape-phone ceiling.
LayoutConfig.CompactHeightThreshold = 460

--------------------------------------------------------------------------------
-- Reserved bands, in design pixels at the baseline
--------------------------------------------------------------------------------

LayoutConfig.Bands = {
	-- Top strip: lap counter, race timer, position. Never wider than a third of the screen
	-- so the stadium's top rail stays visible.
	topStripHeight = 44,
	topStripCompactHeight = 34,

	-- Bottom-left: steering control on touch.
	steerPadSize = 132,
	steerPadCompactSize = 108,
	steerPadMargin = 10,

	-- Bottom-right: throttle / brake / nitro column.
	pedalWidth = 96,
	pedalHeight = 120,
	pedalCompactHeight = 96,
	pedalMargin = 10,

	-- The nitro button sits above the pedals and is the one control that must never be
	-- occluded: it is the only consumable resource in a race.
	nitroButtonSize = 64,
	nitroButtonCompactSize = 54,

	-- Right edge: the position tower (8 rows). Collapses to the top 3 + you on compact.
	positionTowerWidth = 128,
	positionTowerRowHeight = 22,
}

--------------------------------------------------------------------------------
-- Letterbox / pillarbox
--------------------------------------------------------------------------------

LayoutConfig.Viewport = {
	-- Fraction of the shorter axis kept as apron around the track's bounding box.
	fitMargin = 0.08,
	-- Bars are drawn in the camera's own ScreenGui so no cross-ScreenGui coordinate maths
	-- is ever needed. F-03/F-04 are both entirely avoided rather than carefully handled.
	barColor = Color3.fromRGB(18, 16, 22),
	barTransparency = 0,
	-- Ultrawide is allowed to show more stadium apron; it must never crop the track.
	maxAspect = 3.0,
	minAspect = 1.1,
}

--------------------------------------------------------------------------------
-- Scaling
--------------------------------------------------------------------------------

LayoutConfig.Scale = {
	-- The player-facing "Text & UI Size" setting.
	userMin = 1.0,
	userMax = 2.0,
	-- Console defaults higher: ten-foot interfaces genuinely need it, and Stellar Dominion
	-- shipped console text too small until it added exactly this.
	consoleDefault = 1.5,
	desktopDefault = 1.0,

	-- The user multiplier folds in BEFORE the fit cap, so a 2x request can never push an
	-- element off screen. Stellar Dominion had this backwards in three places and had to
	-- retro-fix all of them.
	--
	-- Short viewports absorb the request instead of honouring it: at or below
	-- rampMinHeight the extra scale is fully damped, so a landscape phone keeps the exact
	-- layout the audit proved clean at any setting.
	rampMinHeight = 430,
	rampMaxHeight = 1000,
}

--------------------------------------------------------------------------------
-- Derived helpers — the ONLY sanctioned readers of the raw numbers above
--------------------------------------------------------------------------------

function LayoutConfig.isCompact(viewport: Vector2): boolean
	return viewport.Y <= LayoutConfig.CompactHeightThreshold
end

function LayoutConfig.steerPadSize(viewport: Vector2): number
	local b = LayoutConfig.Bands
	return LayoutConfig.isCompact(viewport) and b.steerPadCompactSize or b.steerPadSize
end

-- Total pixels reserved along the bottom edge. Any element that must sit above the controls
-- asks for this rather than restating a number.
function LayoutConfig.bottomReserve(viewport: Vector2): number
	local b = LayoutConfig.Bands
	local pad = LayoutConfig.steerPadSize(viewport)
	local pedal = LayoutConfig.isCompact(viewport) and b.pedalCompactHeight or b.pedalHeight
	return math.max(pad + b.steerPadMargin, pedal + b.pedalMargin) + 8
end

function LayoutConfig.topReserve(viewport: Vector2): number
	local b = LayoutConfig.Bands
	return (LayoutConfig.isCompact(viewport) and b.topStripCompactHeight or b.topStripHeight) + 6
end

-- How much of the user's requested scale actually applies at this viewport height.
function LayoutConfig.effectiveUserScale(requested: number, viewport: Vector2): number
	local s = LayoutConfig.Scale
	local r = math.clamp(requested, s.userMin, s.userMax)
	if r <= 1 then
		return 1
	end
	local t = math.clamp(
		(viewport.Y - s.rampMinHeight) / math.max(s.rampMaxHeight - s.rampMinHeight, 1),
		0,
		1
	)
	return 1 + (r - 1) * t
end

return LayoutConfig
