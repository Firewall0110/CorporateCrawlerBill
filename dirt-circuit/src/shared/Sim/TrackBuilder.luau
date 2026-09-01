--!nonstrict
-- TrackBuilder — turns a TrackModel into stadium geometry.
--
-- The geometry is a VIEW. It is built from the same `track.json` that the simulation reads,
-- and nothing here is ever consulted by physics: wall parts are `CanCollide = false`
-- decoration, and the collision truth stays the polyline inside TrackModel. One authored
-- source, several derived consumers, no chance of a barrier and its collider drifting apart.
-- (LESSONS.md C-01, H-03.)
--
-- Because the server never renders and its collision is analytic, THE SERVER NEVER NEEDS
-- THIS. In production the client builds its own track: zero replication cost for a few
-- hundred parts, and a low-tier device can skip decor entirely rather than being sent it and
-- then hiding it. The module works on either side; the caller decides.
--
-- Part count is the whole engineering problem here, and run merging is the answer: adjacent
-- lane segments collapse into one part while the surface is unchanged and the track has not
-- turned much. A long straight becomes one part instead of thirty; a hairpin tessellates
-- finely because it has to. See `mergeRuns`.

local StyleConfig = require(script.Parent.Parent.Config.StyleConfig)
local GameConfig = require(script.Parent.Parent.Config.GameConfig)

local TrackBuilder = {}

local T = StyleConfig.Track
local D = StyleConfig.Decor
local P = StyleConfig.Palette

--------------------------------------------------------------------------------
-- Primitives
--------------------------------------------------------------------------------

-- Properties are set BEFORE parenting, always. Parenting an instance and then mutating it
-- makes the engine re-evaluate it on every write; setting first and parenting last is the
-- difference between a track that builds in a frame and one that hitches.
local function makePart(
	name: string,
	size: Vector3,
	cf: CFrame,
	color: Color3,
	parent: Instance,
	castShadow: boolean?
)
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.CFrame = cf
	part.Color = color
	part.Material = Enum.Material.SmoothPlastic
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = false
	part.CastShadow = castShadow == true
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = parent
	return part
end

-- Heading such that the part's LookVector points along (dx, dz).
-- Convention, same as everywhere else: for CFrame.Angles(0, h, 0), LookVector is
-- (-sin h, 0, -cos h). So h = atan2(-dx, -dz).
local function headingTo(dx: number, dz: number): number
	return math.atan2(-dx, -dz)
end

local function shortestAngle(a: number, b: number): number
	return math.abs((b - a + math.pi) % (math.pi * 2) - math.pi)
end

--------------------------------------------------------------------------------
-- Lane sampling
--------------------------------------------------------------------------------

-- Centre of lane `lane` as a fraction of half-width, in [-1, 1].
local function laneFraction(lane: number, count: number): number
	return -1 + (2 * lane - 1) / count
end

local function lanePoint(track, node: number, frac: number): (number, number)
	local tx, tz = track:tangentAt(node)
	local nx, nz = -tz, tx
	local o = frac * track.halfWidth[node]
	return track.cx[node] + nx * o, track.cz[node] + nz * o
end

local function nextNode(track, i: number): number
	return (i % track.nodeCount) + 1
end

--------------------------------------------------------------------------------
-- Run merging
--
-- Walks a closed sequence and yields maximal runs over which `keyOf(i)` is constant and the
-- heading has not deviated past `maxDeviation`. This is what keeps a 220-node track in the
-- low hundreds of parts instead of the low thousands.
--------------------------------------------------------------------------------

local function mergeRuns(count: number, keyOf, headingOf, maxDeviation: number, maxNodes: number, emit)
	local i = 1
	while i <= count do
		local key = keyOf(i)
		local h0 = headingOf(i)
		local j = i

		while j < count and (j - i + 1) < maxNodes do
			local n = j + 1
			if keyOf(n) ~= key then
				break
			end
			if shortestAngle(h0, headingOf(n)) > maxDeviation then
				break
			end
			j = n
		end

		emit(i, j, key)
		i = j + 1
	end
end

--------------------------------------------------------------------------------
-- Ground
--------------------------------------------------------------------------------

local function buildGround(track, parent)
	local b = track.bounds
	local pad = T.apronPadding
	local sizeX = (b.maxX - b.minX) + pad * 2
	local sizeZ = (b.maxZ - b.minZ) + pad * 2
	local cx = (b.minX + b.maxX) * 0.5
	local cz = (b.minZ + b.maxZ) * 0.5

	-- The one part in the whole track that collides, so a stray character has a floor rather
	-- than an infinite fall. Everything else is pure decoration.
	local ground = makePart(
		"Ground",
		Vector3.new(sizeX, 4, sizeZ),
		CFrame.new(cx, (b.minY or 0) - 2.6, cz),
		P.infield,
		parent
	)
	ground.CanCollide = true
	ground.CanQuery = true
	return 1
end

--------------------------------------------------------------------------------
-- Trackbed
--------------------------------------------------------------------------------

local function buildSurface(track, parent)
	local n = track.nodeCount
	local lanes = T.laneCount
	local parts = 0

	local folder = Instance.new("Folder")
	folder.Name = "Surface"

	for lane = 1, lanes do
		local frac = laneFraction(lane, lanes)

		-- Cached per lane so the merge walk does not recompute a point three times per node.
		local px, pz = table.create(n), table.create(n)
		local surf = table.create(n)
		for i = 1, n do
			local x, z = lanePoint(track, i, frac)
			px[i], pz[i] = x, z
			surf[i] = track:surfaceAt(x, z)
		end

		local headings = table.create(n)
		for i = 1, n do
			local k = nextNode(track, i)
			headings[i] = headingTo(px[k] - px[i], pz[k] - pz[i])
		end

		mergeRuns(
			n,
			function(i)
				return surf[i]
			end,
			function(i)
				return headings[i]
			end,
			T.maxRunDeviation,
			T.maxRunNodes,
			function(a, b, key)
				local endNode = nextNode(track, b)
				local ax, az = px[a], pz[a]
				local bx, bz = px[endNode], pz[endNode]

				local dx, dz = bx - ax, bz - az
				local length = math.sqrt(dx * dx + dz * dz)
				if length < 0.05 then
					return
				end

				-- Lane width and elevation are averaged over the run. Both vary slowly along a
				-- track, and the deviation gate above already caps how long a run can get, so the
				-- error stays well under a stud.
				local widthSum, ySum, samples = 0, 0, 0
				for k = a, b do
					widthSum += (2 * track.halfWidth[k]) / lanes
					ySum += track.cy[k]
					samples += 1
				end
				local width = widthSum / samples
				local y = ySum / samples

				local cf = CFrame.new((ax + bx) * 0.5, y + T.surfaceThickness * 0.5, (az + bz) * 0.5)
					* CFrame.Angles(0, headingTo(dx, dz), 0)

				-- Stripe by node index rather than by run index, so the banding lines up ACROSS
				-- lanes and reads as track sections instead of per-lane noise.
				local alternate = (math.floor((a - 1) / 4) % 2) == 1

				makePart(
					"Bed",
					Vector3.new(width, T.surfaceThickness, length * T.segmentOverlap),
					cf,
					StyleConfig.surfaceColor(key, alternate),
					folder
				)
				parts += 1
			end
		)
	end

	folder.Parent = parent
	return parts
end

--------------------------------------------------------------------------------
-- Walls
--------------------------------------------------------------------------------

local function buildWalls(track, parent)
	local parts = 0
	local folder = Instance.new("Folder")
	folder.Name = "Walls"

	local loops = track.wallLoops or {}

	for _, loop in loops do
		local count = loop.count
		if count >= 2 then
			-- Segment-local accessors, so mergeRuns can stay generic.
			local function segAt(k: number)
				return track:wallSegment(loop.start + (k - 1))
			end
			local function headingOf(k: number)
				local ax, az, bx, bz = segAt(k)
				return headingTo(bx - ax, bz - az)
			end

			mergeRuns(
				count,
				function()
					return 0 -- walls have no per-segment key; merge purely on straightness
				end,
				headingOf,
				T.maxRunDeviation,
				T.maxRunNodes,
				function(a, b)
					local ax, az = segAt(a)
					local _, _, bx, bz = segAt(b)

					local dx, dz = bx - ax, bz - az
					local length = math.sqrt(dx * dx + dz * dz)
					if length < 0.05 then
						return
					end

					local mx, mz = (ax + bx) * 0.5, (az + bz) * 0.5
					local groundY = track:groundHeightAt(mx, mz)

					local accent = (a % T.wallAccentEvery) == 0
					makePart(
						"Barrier",
						Vector3.new(T.wallThickness, T.wallHeight, length * T.segmentOverlap),
						CFrame.new(mx, groundY + T.wallHeight * 0.5, mz)
							* CFrame.Angles(0, headingTo(dx, dz), 0),
						accent and P.wallAccent or P.wall,
						folder,
						true
					)
					parts += 1

					-- Hay bales, tucked against the inside face. "Inside" is resolved by walking
					-- toward the nearest centreline node rather than by assuming a winding
					-- direction — the inner and outer loops wind opposite ways, and guessing
					-- would put half the bales outside the stadium.
					if (a % T.hayBaleEvery) == 0 then
						local node = track:nearestNode(mx, mz)
						local tox, toz = track.cx[node] - mx, track.cz[node] - mz
						local len = math.sqrt(tox * tox + toz * toz)
						if len > 1e-3 then
							local ox, oz = tox / len, toz / len
							local bxp = mx + ox * (T.wallThickness + T.hayBaleSize.Z * 0.5)
							local bzp = mz + oz * (T.wallThickness + T.hayBaleSize.Z * 0.5)
							makePart(
								"HayBale",
								T.hayBaleSize,
								CFrame.new(bxp, groundY + T.hayBaleSize.Y * 0.5, bzp)
									* CFrame.Angles(0, headingTo(dx, dz), 0),
								P.hayBale,
								folder,
								true
							)
							parts += 1
						end
					end
				end
			)
		end
	end

	folder.Parent = parent
	return parts
end

--------------------------------------------------------------------------------
-- Ramps
--------------------------------------------------------------------------------

-- Stacked steps rather than a WedgePart. A wedge would be one part instead of four, but its
-- slope orientation is a thing you have to get right by experiment, and getting it backwards
-- puts a wall across the track. Steps are correct by construction and read better in a voxel
-- style anyway.
local function buildRamps(track, rampData, parent)
	if type(rampData) ~= "table" then
		return 0
	end

	local parts = 0
	local folder = Instance.new("Folder")
	folder.Name = "Ramps"

	for _, ramp in rampData do
		local a, b = ramp.a, ramp.b
		if type(a) == "table" and type(b) == "table" then
			local mx, mz = (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5
			local crossLen = math.sqrt((b[1] - a[1]) ^ 2 + (b[2] - a[2]) ^ 2)

			-- The ramp spans ACROSS the track; the racing direction is the centreline
			-- tangent at that point, and that is the direction the steps must climb.
			local node = track:nearestNode(mx, mz)
			local tx, tz = track:tangentAt(node)
			local groundY = track:groundHeightAt(mx, mz)

			local depth = math.max(ramp.width or 18, 6)
			local stepDepth = depth / T.rampSteps

			for k = 1, T.rampSteps do
				local height = k * T.rampStepHeight
				local along = (k - 0.5) * stepDepth - depth * 0.5
				local cx = mx + tx * along
				local cz = mz + tz * along
				makePart(
					"RampStep",
					Vector3.new(crossLen, height, stepDepth * 1.02),
					CFrame.new(cx, groundY + height * 0.5, cz) * CFrame.Angles(0, headingTo(tx, tz), 0),
					(k == T.rampSteps) and P.rampFace or P.rampSide,
					folder,
					true
				)
				parts += 1
			end
		end
	end

	folder.Parent = parent
	return parts
end

--------------------------------------------------------------------------------
-- Start / finish line
--------------------------------------------------------------------------------

local function buildStartLine(track, parent)
	local gate = track.checkpoints[1]
	if not gate then
		return 0
	end

	local folder = Instance.new("Folder")
	folder.Name = "StartLine"

	local ax, az, bx, bz = gate.ax, gate.az, gate.bx, gate.bz
	local dx, dz = bx - ax, bz - az
	local span = math.sqrt(dx * dx + dz * dz)
	local ux, uz = dx / span, dz / span

	local stripes = T.startLineStripes
	local stripeW = span / stripes
	local node = track:nearestNode((ax + bx) * 0.5, (az + bz) * 0.5)
	local tx, tz = track:tangentAt(node)

	for i = 1, stripes do
		local t = (i - 0.5) * stripeW
		local cx = ax + ux * t
		local cz = az + uz * t
		local groundY = track:groundHeightAt(cx, cz)
		makePart(
			"Stripe",
			Vector3.new(stripeW * 1.02, 0.3, T.startLineDepth),
			CFrame.new(cx, groundY + T.surfaceThickness + 0.15, cz) * CFrame.Angles(0, headingTo(tx, tz), 0),
			(i % 2 == 0) and P.startLineLight or P.startLineDark,
			folder
		)
	end

	folder.Parent = parent
	return stripes
end

--------------------------------------------------------------------------------
-- Decor
--------------------------------------------------------------------------------

local function buildDecor(track, parent)
	local parts = 0
	local folder = Instance.new("Folder")
	folder.Name = "Decor"

	local b = track.bounds
	local cx = (b.minX + b.maxX) * 0.5
	local cz = (b.minZ + b.maxZ) * 0.5
	local halfX = (b.maxX - b.minX) * 0.5
	local halfZ = (b.maxZ - b.minZ) * 0.5
	local baseY = b.minY or 0

	-- Floodlights on a circle comfortably outside everything.
	local radius = math.max(halfX, halfZ) + 26
	for i = 1, D.floodlightCount do
		local angle = (i / D.floodlightCount) * math.pi * 2
		local x = cx + math.cos(angle) * radius
		local z = cz + math.sin(angle) * radius
		local facing = headingTo(cx - x, cz - z)

		makePart(
			"FloodPost",
			D.floodlightPostSize,
			CFrame.new(x, baseY + D.floodlightHeight * 0.5, z),
			P.floodPost,
			folder,
			true
		)
		makePart(
			"FloodLamp",
			D.floodlightLampSize,
			CFrame.new(x, baseY + D.floodlightHeight + 1, z) * CFrame.Angles(0, facing, 0),
			P.floodLamp,
			folder
		)
		parts += 2
	end

	-- Crowd stands on the BOUNDING RECTANGLE, not on a circle. The bounds enclose every
	-- piece of track by definition, so a rectangle can never intrude onto the racing
	-- surface no matter how squashed the oval is — a circle fitted to the long axis would.
	--
	-- Spacing is derived from the budget rather than fixed. The first cut used a fixed
	-- 17-stud step and a hard "stop at N parts" cap, and the headless audit showed every
	-- one of the thirty tracks reporting EXACTLY the cap — which meant row one was eating
	-- the entire allowance and rows two and three never placed a single block, leaving a
	-- ring that stopped halfway round. Widening the spacing to fit is the right spend: a
	-- complete sparse ring reads as a stadium, a truncated dense one reads as a bug.
	local palette = P.crowd
	local rowBudget = math.max(8, math.floor((D.crowdMaxBlocks - parts) / D.crowdRows))

	for row = 1, D.crowdRows do
		local out = 16 + (row - 1) * (D.crowdBlockSize.Z + 1.5)
		local y = baseY + D.crowdRise * row
		local rx = halfX + out
		local rz = halfZ + out

		-- Four sides; each gets its share of the row proportional to its length.
		local perimeter = 4 * (rx + rz)
		local step = math.max(D.crowdBlockSize.X + D.crowdGap, perimeter / rowBudget)

		local function place(x: number, z: number, facing: number, index: number)
			makePart(
				"Stand",
				D.crowdBlockSize,
				CFrame.new(x, y, z) * CFrame.Angles(0, facing, 0),
				palette[((index + row) % #palette) + 1],
				folder
			)
			parts += 1
		end

		local acrossX = math.max(1, math.floor((rx * 2) / step))
		local stepX = (rx * 2) / acrossX
		for i = 0, acrossX do
			local x = cx - rx + i * stepX
			place(x, cz - rz, 0, i)
			place(x, cz + rz, math.pi, i + 1)
		end

		local acrossZ = math.max(1, math.floor((rz * 2) / step))
		local stepZ = (rz * 2) / acrossZ
		-- Skip the first and last slot on the Z edges: the corners were already placed by
		-- the X pass above, and doubling a block on itself is visible as a dark seam.
		for i = 1, acrossZ - 1 do
			local z = cz - rz + i * stepZ
			place(cx - rx, z, math.pi * 0.5, i)
			place(cx + rx, z, -math.pi * 0.5, i + 1)
		end
	end

	folder.Parent = parent
	return parts
end

--------------------------------------------------------------------------------
-- Entry point
--------------------------------------------------------------------------------

export type BuildOptions = {
	parent: Instance?,
	detailTier: number?,
	includeDecor: boolean?,
	rampData: { any }?,
}

-- Builds the whole track. Returns the Model and a part-count breakdown.
--
-- The model is assembled fully detached and parented ONCE at the end, so the engine never
-- sees a partially-built track and no intermediate state replicates.
function TrackBuilder.build(track, opts: BuildOptions?)
	local options = opts or {}
	local tier = options.detailTier or GameConfig.DefaultDetailTier

	local model = Instance.new("Model")
	model.Name = string.format("Track_%s", track.id)

	local stats = {
		ground = buildGround(track, model),
		surface = buildSurface(track, model),
		walls = buildWalls(track, model),
		ramps = buildRamps(track, options.rampData, model),
		startLine = buildStartLine(track, model),
		decor = 0,
	}

	-- Decor is the first thing a weak device does without. Note it is not BUILT and hidden —
	-- it is never constructed at all, which is the only version of this that actually saves
	-- anything. (LESSONS.md E-04.)
	local wantDecor = options.includeDecor
	if wantDecor == nil then
		wantDecor = tier > GameConfig.DetailTier.POTATO
	end
	if wantDecor then
		stats.decor = buildDecor(track, model)
	end

	stats.total = stats.ground + stats.surface + stats.walls + stats.ramps + stats.startLine + stats.decor

	-- A budget overrun is a content bug — a pathological width or node spacing — and it
	-- should surface here, at build time, rather than as a frame-rate complaint from a
	-- player on a five-year-old phone.
	local trackParts = stats.total - stats.decor
	if trackParts > StyleConfig.PartBudget.trackWarn then
		warn(
			string.format(
				"[TrackBuilder] %s: %d track parts exceeds the %d budget (surface %d, walls %d)",
				track.id,
				trackParts,
				StyleConfig.PartBudget.trackWarn,
				stats.surface,
				stats.walls
			)
		)
	end
	if stats.decor > StyleConfig.PartBudget.decorWarn then
		warn(
			string.format(
				"[TrackBuilder] %s: %d decor parts exceeds the %d budget",
				track.id,
				stats.decor,
				StyleConfig.PartBudget.decorWarn
			)
		)
	end

	model.Parent = options.parent
	return model, stats
end

return TrackBuilder
