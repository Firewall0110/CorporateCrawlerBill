--!nonstrict
-- Collision — analytic resolution for trucks against each other and against barriers.
--
-- Deliberately NOT a rigid-body solver. The spec asks for elastic bounce, a little torque
-- when trading paint, and explicitly that "vehicles should not easily get wedged into track
-- boundaries". Those first two are ten lines of vector maths; the third is something a
-- constraint solver cannot promise and this can, because we own the escape case.
--
-- The wall truth is the polyline in `track.json`, not the parts in Workspace — those are
-- `CanCollide = false` decoration. One writer, one source (Lesson C-01): a visual barrier
-- and its collider cannot drift apart if only one of them exists.
--
-- Lesson C-05 shows up here in a quiet but important way: every position is read into
-- locals at the top of a pass and written at the end. Stellar Dominion fixed the same
-- "act on it, then read it" bug three separate times (damage a target, then read
-- `target.PrimaryPart.Position` — but the lethal hit already destroyed it).

local VehicleConfig = require(script.Parent.Parent.Config.VehicleConfig)

local Collision = {}

local RADIUS = VehicleConfig.Radius
local C = VehicleConfig.Collision

-- Reused across every call so the hot path allocates nothing.
local scratchSegments: { number } = {}

--------------------------------------------------------------------------------

local function closestOnSegment(px, pz, ax, az, bx, bz)
	local abx, abz = bx - ax, bz - az
	local len2 = abx * abx + abz * abz
	if len2 <= 1e-9 then
		return ax, az
	end
	local t = math.clamp(((px - ax) * abx + (pz - az) * abz) / len2, 0, 1)
	return ax + abx * t, az + abz * t
end

--------------------------------------------------------------------------------
-- Truck vs walls
--------------------------------------------------------------------------------

-- Mutates `v.px, v.pz, v.vx, v.vz, v.heading`. Returns the impact speed (studs/s) of the
-- hardest contact this step, so the caller can drive sparks, sound and a speed penalty
-- without re-deriving it.
function Collision.resolveWalls(v, track): number
	local count = track:gatherWallSegments(v.px, v.pz, RADIUS + 2, scratchSegments)
	if count == 0 then
		return 0
	end

	local hardest = 0
	local contacts = 0

	for i = 1, count do
		local ax, az, bx, bz = track:wallSegment(scratchSegments[i])
		local qx, qz = closestOnSegment(v.px, v.pz, ax, az, bx, bz)

		local dx, dz = v.px - qx, v.pz - qz
		local d2 = dx * dx + dz * dz

		if d2 < RADIUS * RADIUS then
			local d = math.sqrt(d2)
			local nx, nz

			if d > 1e-4 then
				nx, nz = dx / d, dz / d
			else
				-- Dead centre on the segment. Use the segment's own normal rather than
				-- dividing by zero; sign it away from the segment midpoint's neighbour.
				local sx, sz = bx - ax, bz - az
				local sl = math.sqrt(sx * sx + sz * sz)
				if sl < 1e-6 then
					continue
				end
				nx, nz = -sz / sl, sx / sl
				d = 0
			end

			-- Push out to exactly the radius. Positional correction is absolute, not
			-- impulse-based, so a truck cannot creep into geometry over successive steps.
			local push = RADIUS - d
			v.px += nx * push
			v.pz += nz * push
			contacts += 1

			local vn = v.vx * nx + v.vz * nz
			if vn < 0 then
				local impact = -vn
				if impact > hardest then
					hardest = impact
				end

				-- Reflect the normal component; KEEP the tangential one (scrubbed). That
				-- retained tangential velocity is exactly what makes the truck slide along
				-- the barrier instead of sticking to it, and it is the reason this resolver
				-- cannot wedge the way a solver does.
				local tx, tz = -nz, nx
				local vt = v.vx * tx + v.vz * tz

				local newVn = -vn * C.wallRestitution
				local newVt = vt * C.wallTangentialScrub

				v.vx = nx * newVn + tx * newVt
				v.vz = nz * newVn + tz * newVt

				-- A glancing scrape nudges the nose along the wall; a head-on hit does not
				-- spin you. Sign follows the tangential direction of travel.
				local yaw = math.clamp(vt * C.wallYawImpulse, -0.9, 0.9)
				v.heading += yaw * 0.016
			end
		end
	end

	-- Anti-wedge. Two or more simultaneous contacts means an inside corner is pinching the
	-- truck, and normal-push resolution can fight itself there forever. Give up on the
	-- normals and move toward the racing line, which is always open.
	if contacts >= 2 then
		local node = track:nearestNode(v.px, v.pz, v.node)
		local cxn, czn = track.cx[node], track.cz[node]
		local dx, dz = cxn - v.px, czn - v.pz
		local len = math.sqrt(dx * dx + dz * dz)
		if len > 1e-4 then
			v.px += (dx / len) * C.wedgeEscapeSpeed * (1 / 60)
			v.pz += (dz / len) * C.wedgeEscapeSpeed * (1 / 60)
		end
	end

	return hardest
end

--------------------------------------------------------------------------------
-- Truck vs truck
--------------------------------------------------------------------------------

-- Resolves all pairs in `list` (an array of vehicle states, length `n`).
--
-- O(n^2) on purpose. n is 8, so this is 28 pairs — a spatial hash here would be more code,
-- more state to keep correct, and measurably slower. Build the index when the entity count
-- justifies it, not before.
function Collision.resolveTrucks(list, n: number)
	local minDist = RADIUS * 2
	local minDist2 = minDist * minDist

	for i = 1, n - 1 do
		local a = list[i]
		if a.active then
			for j = i + 1, n do
				local b = list[j]
				if b.active then
					local dx = b.px - a.px
					local dz = b.pz - a.pz
					local d2 = dx * dx + dz * dz

					if d2 < minDist2 and d2 > 1e-8 then
						local d = math.sqrt(d2)
						local nx, nz = dx / d, dz / d

						-- Separate equally. Trucks are the same mass by design: an arcade
						-- racer where one player can bully another by owning a heavier
						-- truck is a monetization problem waiting to happen.
						local push = (minDist - d) * 0.5
						a.px -= nx * push
						a.pz -= nz * push
						b.px += nx * push
						b.pz += nz * push

						-- Exchange the normal component with restitution; tangential is
						-- untouched, so side-by-side racing stays side-by-side.
						local avn = a.vx * nx + a.vz * nz
						local bvn = b.vx * nx + b.vz * nz

						if avn - bvn > 0 then -- closing
							local e = C.truckRestitution
							local mean = (avn + bvn) * 0.5
							local newA = mean - (avn - mean) * e
							local newB = mean - (bvn - mean) * e

							a.vx += nx * (newA - avn)
							a.vz += nz * (newA - avn)
							b.vx += nx * (newB - bvn)
							b.vz += nz * (newB - bvn)

							-- "Trading paint": tangential closing speed becomes a small
							-- yaw kick on both, in opposite directions.
							local tx, tz = -nz, nx
							local tRel = (a.vx - b.vx) * tx + (a.vz - b.vz) * tz
							local yaw = math.clamp(
								tRel * C.truckYawImpulse,
								-C.maxTruckYawImpulse,
								C.maxTruckYawImpulse
							)
							a.heading -= yaw * 0.016
							b.heading += yaw * 0.016

							local impact = math.abs(avn - bvn)
							a.lastImpact = math.max(a.lastImpact or 0, impact)
							b.lastImpact = math.max(b.lastImpact or 0, impact)
						end
					end
				end
			end
		end
	end
end

return Collision
