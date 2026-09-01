--!nonstrict
-- TrackModel — everything the simulation needs to ask about a track.
--
-- Built ONCE from a `track.json` blob when an arena is created, then queried thousands of
-- times per second by the integrator, the collision resolver and eight AI drivers. So the
-- whole design principle here is: pay at load, never at query.
--
-- Lesson E-01. Stellar Dominion's targeting ran `workspace:GetDescendants()` PER WEAPON PER
-- FRAME, and its turret service had 23 turrets each re-scanning every player and 84 mobs on
-- every tick. Both were fixed by building one snapshot per tick. Here we go further and bake
-- the answers at load time, because a track does not change during a race:
--
--   * surface / ground height / ramp  -> a flat cell grid, O(1) array index per query
--   * wall segments                   -> a spatial hash, only nearby segments are tested
--   * centreline                      -> uniformly resampled, so arc length is index * spacing
--
-- Coordinate convention, stated once and obeyed everywhere (VehicleSim, AIDriverService and
-- CameraController all depend on it): the track is on the XZ plane, Y is up, and a heading
-- `h` corresponds to `CFrame.Angles(0, h, 0)`, whose LookVector is `(-sin h, 0, -cos h)`.
-- Stellar Dominion got this wrong and then wrote the correction down; we start from the
-- correction.

local SurfaceConfig = require(script.Parent.Parent.Config.SurfaceConfig)
local Guards = require(script.Parent.Parent.Util.Guards)

local TrackModel = {}
TrackModel.__index = TrackModel

-- Cell size for the baked surface/height grid. 4 studs is finer than a truck is wide, so
-- surface transitions read as crisp without the grid getting large: a 700x500 stud stadium
-- is ~22k cells, three flat arrays, built in a few milliseconds.
local GRID_CELL = 4
-- Wall spatial hash. Coarser: we only need "which segments are plausibly near me".
local WALL_CELL = 24

--------------------------------------------------------------------------------
-- Small vector helpers (plain numbers — Vector3 allocation in a 60 Hz inner loop is
-- exactly the kind of per-frame garbage that costs a phone its frame budget)
--------------------------------------------------------------------------------

local function dist2(ax: number, az: number, bx: number, bz: number): number
	local dx, dz = ax - bx, az - bz
	return dx * dx + dz * dz
end

-- Closest point on segment AB to P, returned as (x, z, t) with t in [0,1].
local function closestOnSegment(px, pz, ax, az, bx, bz)
	local abx, abz = bx - ax, bz - az
	local len2 = abx * abx + abz * abz
	if len2 <= 1e-9 then
		return ax, az, 0
	end
	local t = ((px - ax) * abx + (pz - az) * abz) / len2
	t = math.clamp(t, 0, 1)
	return ax + abx * t, az + abz * t, t
end

-- Do segments P1->P2 and Q1->Q2 properly cross? Used for checkpoint gates, where a
-- touch-but-not-cross must not count.
local function segmentsCross(p1x, p1z, p2x, p2z, q1x, q1z, q2x, q2z): boolean
	local function side(ax, az, bx, bz, cx, cz)
		return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
	end
	local d1 = side(q1x, q1z, q2x, q2z, p1x, p1z)
	local d2 = side(q1x, q1z, q2x, q2z, p2x, p2z)
	local d3 = side(p1x, p1z, p2x, p2z, q1x, q1z)
	local d4 = side(p1x, p1z, p2x, p2z, q2x, q2z)
	return ((d1 > 0) ~= (d2 > 0)) and ((d3 > 0) ~= (d4 > 0))
end

local function pointInPolygon(px: number, pz: number, poly: { { number } }): boolean
	local inside = false
	local n = #poly
	local j = n
	for i = 1, n do
		local xi, zi = poly[i][1], poly[i][2]
		local xj, zj = poly[j][1], poly[j][2]
		if (zi > pz) ~= (zj > pz) then
			local x = xi + (pz - zi) / (zj - zi) * (xj - xi)
			if px < x then
				inside = not inside
			end
		end
		j = i
	end
	return inside
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

-- `data` is a decoded track.json. See docs/TRACK_FORMAT.md.
-- `reverse` races the same geometry backwards, which doubles the track pool for free.
function TrackModel.fromData(data, reverse: boolean?)
	assert(type(data) == "table", "TrackModel: data must be a table")
	assert(type(data.centerline) == "table" and #data.centerline >= 8, "TrackModel: centerline too short")

	local self = setmetatable({}, TrackModel)

	self.id = tostring(data.id or "unknown")
	self.name = tostring(data.name or self.id)
	self.reverse = reverse == true
	self.nodeSpacing = Guards.number(data.nodeSpacing, 0.5, 64, 8)

	-- Centreline, and elevation per node. Reversing is a table flip, not a second dataset.
	local src = data.centerline
	local srcElev = data.elevation
	local n = #src
	local cx, cz, cy = table.create(n), table.create(n), table.create(n)
	for i = 1, n do
		local j = self.reverse and (n - i + 1) or i
		local p = src[j]
		cx[i] = Guards.number(p[1], -1e5, 1e5, 0)
		cz[i] = Guards.number(p[2], -1e5, 1e5, 0)
		cy[i] = srcElev and Guards.number(srcElev[j], -1e4, 1e4, 0) or 0
	end
	self.cx, self.cz, self.cy = cx, cz, cy
	self.nodeCount = n
	-- The centreline is resampled to a uniform spacing by the generator, so arc length is
	-- just index arithmetic. That is worth enforcing at the tool, because it turns every
	-- "how far ahead" query in the AI into an integer add.
	self.length = n * self.nodeSpacing

	-- Half-width per node (drives the anti-wedge push and AI line clamping).
	local widths = data.halfWidth
	local hw = table.create(n)
	for i = 1, n do
		local j = self.reverse and (n - i + 1) or i
		hw[i] = widths and Guards.number(widths[j], 4, 400, 30) or 30
	end
	self.halfWidth = hw

	self:_bakeBounds(data)
	self:_bakeGrid(data)
	self:_bakeWalls(data)
	self:_bakeCheckpoints(data)
	self:_bakeGrid_pickupNodes(data)
	self:_bakeStartGrid(data)
	self:_bakeCentrelineHash()

	return self
end

function TrackModel:_bakeBounds(data)
	local minX, maxX = math.huge, -math.huge
	local minZ, maxZ = math.huge, -math.huge
	local minY, maxY = math.huge, -math.huge

	local function eat(x, z, y)
		minX = math.min(minX, x)
		maxX = math.max(maxX, x)
		minZ = math.min(minZ, z)
		maxZ = math.max(maxZ, z)
		minY = math.min(minY, y)
		maxY = math.max(maxY, y)
	end

	for i = 1, self.nodeCount do
		local pad = self.halfWidth[i]
		eat(self.cx[i] - pad, self.cz[i] - pad, self.cy[i])
		eat(self.cx[i] + pad, self.cz[i] + pad, self.cy[i])
	end

	-- The generator may declare a wider apron for decor; respect it so the camera frames
	-- the stadium, not just the racing surface.
	local b = data.bounds
	if type(b) == "table" then
		eat(Guards.number(b.minX, -1e5, 1e5, minX), Guards.number(b.minZ, -1e5, 1e5, minZ), minY)
		eat(Guards.number(b.maxX, -1e5, 1e5, maxX), Guards.number(b.maxZ, -1e5, 1e5, maxZ), maxY)
	end

	self.bounds = { minX = minX, maxX = maxX, minZ = minZ, maxZ = maxZ, minY = minY, maxY = maxY }
end

--------------------------------------------------------------------------------
-- Baked cell grid: surface id, ground height, ramp launch strength
--------------------------------------------------------------------------------

function TrackModel:_bakeGrid(data)
	local b = self.bounds
	local gw = math.max(1, math.ceil((b.maxX - b.minX) / GRID_CELL) + 1)
	local gh = math.max(1, math.ceil((b.maxZ - b.minZ) / GRID_CELL) + 1)

	self.gridW, self.gridH = gw, gh
	self.gridOriginX, self.gridOriginZ = b.minX, b.minZ

	local cells = gw * gh
	local surf = table.create(cells, SurfaceConfig.Id.DIRT)
	local height = table.create(cells, 0)
	local ramp = table.create(cells, 0)

	-- Ground height comes from the nearest centreline node's elevation. Banking is a
	-- visual-only rotation applied by TrackBuilder; the sim stays flat-plane, which is what
	-- keeps it cheap and deterministic.
	for gz = 0, gh - 1 do
		for gx = 0, gw - 1 do
			local wx = b.minX + gx * GRID_CELL
			local wz = b.minZ + gz * GRID_CELL
			local ni = self:_nearestNodeBruteforce(wx, wz)
			height[gz * gw + gx + 1] = self.cy[ni]
		end
	end

	-- Surface polygons are painted over the default in declaration order, so a puddle
	-- declared after a mud patch wins inside the overlap. Deterministic and easy to author.
	local surfaces = data.surfaces
	if type(surfaces) == "table" then
		for _, patch in surfaces do
			local id = SurfaceConfig.Id[string.upper(tostring(patch.type or "DIRT"))]
			local poly = patch.poly
			if id and type(poly) == "table" and #poly >= 3 then
				local pminX, pmaxX = math.huge, -math.huge
				local pminZ, pmaxZ = math.huge, -math.huge
				for _, p in poly do
					pminX = math.min(pminX, p[1])
					pmaxX = math.max(pmaxX, p[1])
					pminZ = math.min(pminZ, p[2])
					pmaxZ = math.max(pmaxZ, p[2])
				end
				-- Only rasterise the polygon's own bounding box, not the whole track.
				local gx0 = math.max(0, math.floor((pminX - b.minX) / GRID_CELL))
				local gx1 = math.min(gw - 1, math.ceil((pmaxX - b.minX) / GRID_CELL))
				local gz0 = math.max(0, math.floor((pminZ - b.minZ) / GRID_CELL))
				local gz1 = math.min(gh - 1, math.ceil((pmaxZ - b.minZ) / GRID_CELL))
				for gz = gz0, gz1 do
					for gx = gx0, gx1 do
						local wx = b.minX + gx * GRID_CELL
						local wz = b.minZ + gz * GRID_CELL
						if pointInPolygon(wx, wz, poly) then
							surf[gz * gw + gx + 1] = id
						end
					end
				end
			end
		end
	end

	-- Ramps are stored as a launch impulse per cell so the integrator needs no ramp list.
	local ramps = data.ramps
	if type(ramps) == "table" then
		for _, r in ramps do
			local a, bb = r.a, r.b
			if type(a) == "table" and type(bb) == "table" then
				local launch = Guards.number(r.launch, 0, 120, 34)
				local halfW = Guards.number(r.width, 2, 200, 18) * 0.5
				local minx = math.min(a[1], bb[1]) - halfW
				local maxx = math.max(a[1], bb[1]) + halfW
				local minz = math.min(a[2], bb[2]) - halfW
				local maxz = math.max(a[2], bb[2]) + halfW
				local gx0 = math.max(0, math.floor((minx - b.minX) / GRID_CELL))
				local gx1 = math.min(gw - 1, math.ceil((maxx - b.minX) / GRID_CELL))
				local gz0 = math.max(0, math.floor((minz - b.minZ) / GRID_CELL))
				local gz1 = math.min(gh - 1, math.ceil((maxz - b.minZ) / GRID_CELL))
				for gz = gz0, gz1 do
					for gx = gx0, gx1 do
						local wx = b.minX + gx * GRID_CELL
						local wz = b.minZ + gz * GRID_CELL
						local _, _, t = closestOnSegment(wx, wz, a[1], a[2], bb[1], bb[2])
						local qx = a[1] + (bb[1] - a[1]) * t
						local qz = a[2] + (bb[2] - a[2]) * t
						if dist2(wx, wz, qx, qz) <= halfW * halfW then
							ramp[gz * gw + gx + 1] = launch
						end
					end
				end
			end
		end
	end

	self.gridSurface = surf
	self.gridHeight = height
	self.gridRamp = ramp
end

-- Only used during baking, where O(n) per cell is fine and correctness beats speed.
function TrackModel:_nearestNodeBruteforce(x: number, z: number): number
	local best, bestD = 1, math.huge
	for i = 1, self.nodeCount do
		local d = dist2(x, z, self.cx[i], self.cz[i])
		if d < bestD then
			bestD, best = d, i
		end
	end
	return best
end

function TrackModel:_cellIndex(x: number, z: number): number
	local gx = math.clamp(math.floor((x - self.gridOriginX) / GRID_CELL), 0, self.gridW - 1)
	local gz = math.clamp(math.floor((z - self.gridOriginZ) / GRID_CELL), 0, self.gridH - 1)
	return gz * self.gridW + gx + 1
end

--------------------------------------------------------------------------------
-- Walls: spatial hash of segments
--------------------------------------------------------------------------------

function TrackModel:_bakeWalls(data)
	local segs = {} -- flat: ax, az, bx, bz per 4 entries
	-- Where each closed polyline starts and ends within `segs`. Collision does not care —
	-- it only ever asks "what is near me" — but TrackBuilder walks the loops IN ORDER to
	-- merge consecutive wall segments into single parts, and it cannot do that without
	-- knowing where one loop stops and the next begins.
	local loops = {}

	local function addPolyline(poly, closed: boolean)
		if type(poly) ~= "table" or #poly < 2 then
			return
		end
		local startSeg = #segs // 4
		local count = closed and #poly or (#poly - 1)
		for i = 1, count do
			local a = poly[i]
			local bpt = poly[(i % #poly) + 1]
			table.insert(segs, a[1])
			table.insert(segs, a[2])
			table.insert(segs, bpt[1])
			table.insert(segs, bpt[2])
		end
		table.insert(loops, { start = startSeg, count = count, closed = closed })
	end

	local walls = data.walls
	if type(walls) == "table" then
		addPolyline(walls.inner, true)
		addPolyline(walls.outer, true)
		if type(walls.extra) == "table" then
			for _, p in walls.extra do
				addPolyline(p, p.closed == true)
			end
		end
	end

	self.wallSegs = segs
	self.wallSegCount = #segs // 4
	self.wallLoops = loops

	-- Bucket each segment into every cell its bounding box touches.
	local hash = {}
	for s = 0, self.wallSegCount - 1 do
		local o = s * 4
		local ax, az, bx, bz = segs[o + 1], segs[o + 2], segs[o + 3], segs[o + 4]
		local gx0 = math.floor(math.min(ax, bx) / WALL_CELL)
		local gx1 = math.floor(math.max(ax, bx) / WALL_CELL)
		local gz0 = math.floor(math.min(az, bz) / WALL_CELL)
		local gz1 = math.floor(math.max(az, bz) / WALL_CELL)
		for gz = gz0, gz1 do
			for gx = gx0, gx1 do
				local key = gx * 100003 + gz
				local bucket = hash[key]
				if not bucket then
					bucket = {}
					hash[key] = bucket
				end
				table.insert(bucket, s)
			end
		end
	end
	self.wallHash = hash
end

-- Appends the indices of wall segments plausibly within `radius` of (x,z) into `out`.
-- `out` is caller-owned and reused across the whole step, so this allocates nothing in the
-- hot path. (Lesson E-03 — pool it rather than build a fresh table per query.)
function TrackModel:gatherWallSegments(x: number, z: number, radius: number, out: { number }): number
	table.clear(out)
	local r = math.max(radius, 1)
	local gx0 = math.floor((x - r) / WALL_CELL)
	local gx1 = math.floor((x + r) / WALL_CELL)
	local gz0 = math.floor((z - r) / WALL_CELL)
	local gz1 = math.floor((z + r) / WALL_CELL)
	local seen = {}
	local count = 0
	for gz = gz0, gz1 do
		for gx = gx0, gx1 do
			local bucket = self.wallHash[gx * 100003 + gz]
			if bucket then
				for _, s in bucket do
					if not seen[s] then
						seen[s] = true
						count += 1
						out[count] = s
					end
				end
			end
		end
	end
	return count
end

function TrackModel:wallSegment(index: number)
	local o = index * 4
	local s = self.wallSegs
	return s[o + 1], s[o + 2], s[o + 3], s[o + 4]
end

--------------------------------------------------------------------------------
-- Centreline lookup hash (for nearest-node queries at runtime)
--------------------------------------------------------------------------------

function TrackModel:_bakeCentrelineHash()
	local hash = {}
	for i = 1, self.nodeCount do
		local gx = math.floor(self.cx[i] / WALL_CELL)
		local gz = math.floor(self.cz[i] / WALL_CELL)
		local key = gx * 100003 + gz
		local bucket = hash[key]
		if not bucket then
			bucket = {}
			hash[key] = bucket
		end
		table.insert(bucket, i)
	end
	self.nodeHash = hash
end

-- Nearest centreline node index. `hint` is the caller's last known node: checking a small
-- window around it first turns the common case into ~9 distance tests instead of a hash
-- lookup, and a truck only ever moves a node or two per step.
function TrackModel:nearestNode(x: number, z: number, hint: number?): number
	if hint then
		local best, bestD = hint, math.huge
		for d = -4, 4 do
			local i = ((hint - 1 + d) % self.nodeCount) + 1
			local dd = dist2(x, z, self.cx[i], self.cz[i])
			if dd < bestD then
				bestD, best = dd, i
			end
		end
		-- Trust the local window only if we are genuinely near the line; a truck that has
		-- been flung across the infield needs the global search below.
		if bestD < (self.nodeSpacing * 6) ^ 2 then
			return best
		end
	end

	local gx = math.floor(x / WALL_CELL)
	local gz = math.floor(z / WALL_CELL)
	local best, bestD = 1, math.huge
	for dz = -2, 2 do
		for dx = -2, 2 do
			local bucket = self.nodeHash[(gx + dx) * 100003 + (gz + dz)]
			if bucket then
				for _, i in bucket do
					local dd = dist2(x, z, self.cx[i], self.cz[i])
					if dd < bestD then
						bestD, best = dd, i
					end
				end
			end
		end
	end
	if bestD < math.huge then
		return best
	end
	return self:_nearestNodeBruteforce(x, z)
end

--------------------------------------------------------------------------------
-- Checkpoints
--------------------------------------------------------------------------------

function TrackModel:_bakeCheckpoints(data)
	local raw = data.checkpoints
	local gates = {}
	if type(raw) == "table" then
		local n = #raw
		for i = 1, n do
			local j = self.reverse and (n - i + 1) or i
			local g = raw[j]
			if type(g) == "table" and type(g.a) == "table" and type(g.b) == "table" then
				table.insert(gates, {
					ax = g.a[1],
					az = g.a[2],
					bx = g.b[1],
					bz = g.b[2],
					node = g.node,
				})
			end
		end
	end
	assert(#gates >= 3, "TrackModel: a track needs at least 3 checkpoint gates")
	self.checkpoints = gates
	self.checkpointCount = #gates
end

-- Did a truck moving from (px,pz) to (x,z) cross gate `index`?
--
-- Gates must be crossed IN ORDER, which is what makes corner-cutting worthless without any
-- heuristic anti-cheat: skip a gate and your progress scalar simply stops advancing.
function TrackModel:crossedCheckpoint(index: number, px, pz, x, z): boolean
	local g = self.checkpoints[index]
	if not g then
		return false
	end
	return segmentsCross(px, pz, x, z, g.ax, g.az, g.bx, g.bz)
end

--------------------------------------------------------------------------------
-- Pickup nodes and the starting grid
--------------------------------------------------------------------------------

function TrackModel:_bakeGrid_pickupNodes(data)
	local out = {}
	local raw = data.pickupNodes
	if type(raw) == "table" then
		for _, p in raw do
			if type(p) == "table" and Guards.finite(p[1]) and Guards.finite(p[2]) then
				table.insert(out, { p[1], p[2] })
			end
		end
	end
	self.pickupNodes = out
end

function TrackModel:_bakeStartGrid(data)
	local out = {}
	local raw = data.grid
	if type(raw) == "table" then
		for _, p in raw do
			if type(p) == "table" then
				table.insert(out, {
					x = Guards.number(p[1], -1e5, 1e5, 0),
					z = Guards.number(p[2], -1e5, 1e5, 0),
					heading = Guards.number(p[3], -100, 100, 0),
				})
			end
		end
	end

	-- Fall back to generating a grid behind the first checkpoint so a track that omits one
	-- is still raceable. Content should never be able to brick a session.
	if #out < 8 then
		local startNode = 1
		for i = 1, 8 do
			local ni = ((startNode - 1 - i * 2) % self.nodeCount) + 1
			local nx, nz = self.cx[ni], self.cz[ni]
			local ax, az = self:tangentAt(ni)
			local rx, rz = -az, ax -- right-hand normal in XZ
			local lane = (i % 2 == 0) and 1 or -1
			local offset = self.halfWidth[ni] * 0.35 * lane
			table.insert(out, {
				x = nx + rx * offset,
				z = nz + rz * offset,
				heading = math.atan2(-ax, -az),
			})
		end
	end

	self.startGrid = out
end

--------------------------------------------------------------------------------
-- Runtime queries (the hot path)
--------------------------------------------------------------------------------

function TrackModel:surfaceAt(x: number, z: number): number
	return self.gridSurface[self:_cellIndex(x, z)] or SurfaceConfig.Id.DIRT
end

function TrackModel:groundHeightAt(x: number, z: number): number
	return self.gridHeight[self:_cellIndex(x, z)] or 0
end

-- Launch impulse (studs/s of upward velocity) if this cell is a ramp, else 0.
function TrackModel:rampAt(x: number, z: number): number
	return self.gridRamp[self:_cellIndex(x, z)] or 0
end

-- Unit tangent at a node, pointing along the racing direction.
function TrackModel:tangentAt(node: number): (number, number)
	local n = self.nodeCount
	local i0 = ((node - 2) % n) + 1
	local i1 = (node % n) + 1
	local dx = self.cx[i1] - self.cx[i0]
	local dz = self.cz[i1] - self.cz[i0]
	local len = math.sqrt(dx * dx + dz * dz)
	if len < 1e-6 then
		return 0, 1
	end
	return dx / len, dz / len
end

-- Node `ahead` studs further along the track from `node`.
function TrackModel:nodeAhead(node: number, ahead: number): number
	local steps = math.floor(ahead / self.nodeSpacing + 0.5)
	return ((node - 1 + steps) % self.nodeCount) + 1
end

-- Signed curvature at a node, in radians per stud. Positive turns one way, negative the
-- other; the AI only ever uses the magnitude, but the sign is there for racing-line offset.
function TrackModel:curvatureAt(node: number): number
	local n = self.nodeCount
	local i0 = ((node - 2) % n) + 1
	local i1 = node
	local i2 = (node % n) + 1

	local ax, az = self.cx[i1] - self.cx[i0], self.cz[i1] - self.cz[i0]
	local bx, bz = self.cx[i2] - self.cx[i1], self.cz[i2] - self.cz[i1]
	local la = math.sqrt(ax * ax + az * az)
	local lb = math.sqrt(bx * bx + bz * bz)
	if la < 1e-6 or lb < 1e-6 then
		return 0
	end
	ax, az = ax / la, az / la
	bx, bz = bx / lb, bz / lb

	local cross = ax * bz - az * bx
	local dot = math.clamp(ax * bx + az * bz, -1, 1)
	local angle = math.atan2(cross, dot)
	return angle / self.nodeSpacing
end

-- Worst curvature over the next `distance` studs. This is what turns "there is a corner
-- coming" into a number the AI can brake against.
function TrackModel:maxCurvatureAhead(node: number, distance: number): number
	local steps = math.max(1, math.floor(distance / self.nodeSpacing))
	local worst = 0
	for s = 0, steps do
		local k = math.abs(self:curvatureAt(self:nodeAhead(node, s * self.nodeSpacing)))
		if k > worst then
			worst = k
		end
	end
	return worst
end

-- A point offset laterally from the centreline at `node`. `offset` is in studs, positive to
-- the right of the racing direction, and is clamped inside the track so an AI racing line
-- can never be authored off the circuit.
function TrackModel:pointAt(node: number, offset: number): (number, number)
	local tx, tz = self:tangentAt(node)
	local rx, rz = -tz, tx
	local limit = self.halfWidth[node] - 3
	local o = math.clamp(offset, -limit, limit)
	return self.cx[node] + rx * o, self.cz[node] + rz * o
end

-- Progress as a single sortable scalar. See ARCHITECTURE section 4.
function TrackModel:progressOf(lap: number, cpIndex: number, node: number): number
	return lap * self.checkpointCount + cpIndex + (node / self.nodeCount)
end

return TrackModel
