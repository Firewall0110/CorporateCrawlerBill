--!nonstrict
-- DevRace — a one-liner that builds a track, fills the grid with bots and races them.
--
-- Paste into the Studio command bar (Play Solo, server context):
--
--     require(game.ServerScriptService.Server.Dev.DevRace).start()
--     require(game.ServerScriptService.Server.Dev.DevRace).start({ track = "stadium_07", reverse = true })
--     require(game.ServerScriptService.Server.Dev.DevRace).stop()
--
-- ⚠️ THIS IS A DEV HARNESS, NOT THE PRODUCTION PATH. It differs from the real thing in two
-- ways, both deliberate and both wrong for shipping:
--
--   * It builds geometry and drives truck models ON THE SERVER, so everything replicates.
--     Production builds the track and renders trucks client-side, because the server never
--     renders and its collision is analytic — see TrackBuilder's header.
--   * It frames the camera with a simplified fit. CameraController owns the real one,
--     including the letterbox mask.
--
-- What it IS good for: proving the simulation, the AI, the track pipeline and the geometry
-- all agree with each other, without needing a lobby, an input controller or a HUD — none of
-- which exist yet.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)
local TrackBuilder = require(ReplicatedStorage.Shared.Sim.TrackBuilder)
local TruckBuilder = require(ReplicatedStorage.Shared.Sim.TruckBuilder)

local RaceService = require(script.Parent.Parent.Services.RaceService)
local TrackService = require(script.Parent.Parent.Services.TrackService)

local DevRace = {}

local BAY_ID = 99

local state = {
	arena = nil,
	trucks = {},
	session = nil,
	track = nil,
	renderConn = nil,
	reportConn = nil,
}

--------------------------------------------------------------------------------

-- A simplified version of CameraController's fit: place the camera on a fixed isometric
-- heading at the distance where the track's bounding box fills the vertical FOV. No
-- letterbox mask, no aspect clamping — that is the real controller's job.
local function frameCamera(track)
	local camera = Workspace.CurrentCamera
	if not camera then
		return
	end

	local b = track.bounds
	local pitch = math.rad(GameConfig.Camera.PitchDegrees)
	local worldW = b.maxX - b.minX
	local worldD = (b.maxZ - b.minZ) * math.sin(pitch)

	local halfV = math.rad(GameConfig.Camera.FieldOfView) * 0.5
	local tanV = math.tan(halfV)
	local aspect = camera.ViewportSize.X / math.max(camera.ViewportSize.Y, 1)

	local distance = math.max((worldD * 0.5) / tanV, (worldW * 0.5) / (tanV * aspect)) * 1.12

	local centre = Vector3.new((b.minX + b.maxX) * 0.5, b.minY or 0, (b.minZ + b.maxZ) * 0.5)
	local offset = Vector3.new(0, math.sin(pitch), math.cos(pitch)) * distance

	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = GameConfig.Camera.FieldOfView
	camera.CFrame = CFrame.lookAt(centre + offset, centre)
end

--------------------------------------------------------------------------------

export type Options = { track: string?, reverse: boolean?, league: string?, decor: boolean? }

function DevRace.start(options: Options?)
	local opts = options or {}
	DevRace.stop()

	----------------------------------------------------------------------------
	-- Track
	----------------------------------------------------------------------------
	local track, id, reverse
	if opts.track then
		reverse = opts.reverse == true
		track = TrackService.load(opts.track, reverse)
		id = opts.track
	else
		track, id, reverse = TrackService.pickNext()
	end

	if not track then
		warn(
			string.format("[DevRace] could not load a track (%s). Is src/shared/Tracks synced?", tostring(id))
		)
		return nil
	end

	local arena = Instance.new("Folder")
	arena.Name = "DevArena"

	local t0 = os.clock()
	local _model, stats = TrackBuilder.build(track, {
		parent = arena,
		detailTier = opts.decor == false and GameConfig.DetailTier.POTATO or GameConfig.DetailTier.MEDIUM,
	})
	local buildMs = (os.clock() - t0) * 1000

	arena.Parent = Workspace
	state.arena = arena
	state.track = track

	print(
		string.format(
			"[DevRace] %s%s — %s | %d parts in %.0f ms (surface %d, walls %d, ramps %d, decor %d)",
			id,
			reverse and " (reverse)" or "",
			track.name,
			stats.total,
			buildMs,
			stats.surface,
			stats.walls,
			stats.ramps,
			stats.decor
		)
	)

	----------------------------------------------------------------------------
	-- Race — a real RaceService session with an empty entrant list, so the grid
	-- fills with eight bots through exactly the same code a live race uses.
	----------------------------------------------------------------------------
	local session = RaceService.createSession(BAY_ID)
	local seated = session:seatGrid({}, track, opts.league or "clubman")
	state.session = session

	if seated == 0 then
		warn("[DevRace] nothing was seated on the grid")
		return nil
	end

	local truckFolder = Instance.new("Folder")
	truckFolder.Name = "Trucks"
	for i = 1, session.vehicleCount do
		local vehicle = session.vehicles[i]
		local truck = TruckBuilder.build(vehicle.displayName or ("Truck" .. i), i, truckFolder)
		state.trucks[i] = truck
	end
	truckFolder.Parent = arena

	session:setState(RaceService.State.COUNTDOWN)
	frameCamera(track)

	----------------------------------------------------------------------------
	-- View loop. Production does this on the client, from interpolated snapshots.
	----------------------------------------------------------------------------
	state.renderConn = RunService.Heartbeat:Connect(function()
		for i = 1, session.vehicleCount do
			local vehicle = session.vehicles[i]
			local truck = state.trucks[i]
			if truck and truck.Parent then
				TruckBuilder.apply(truck, vehicle, track:groundHeightAt(vehicle.px, vehicle.pz))
			end
		end
	end)

	-- A standings readout every two seconds, so a headless run is still legible in the
	-- output window if you are not watching the viewport.
	local lastReport = os.clock()
	state.reportConn = RunService.Heartbeat:Connect(function()
		if os.clock() - lastReport < 2 then
			return
		end
		lastReport = os.clock()

		if session.state ~= RaceService.State.RACING then
			return
		end
		local order = session:standings()
		local parts = {}
		for pos = 1, math.min(4, #order) do
			local v = order[pos]
			table.insert(parts, string.format("%d.%s L%d", pos, v.displayName or v.id, v.lap + 1))
		end
		print(string.format("[DevRace] %s  |  %s", session.state, table.concat(parts, "  ")))
	end)

	print(
		string.format(
			"[DevRace] racing %d trucks over %d laps — stop with DevRace.stop()",
			session.vehicleCount,
			GameConfig.Laps
		)
	)

	return session
end

function DevRace.stop()
	if state.renderConn then
		state.renderConn:Disconnect()
		state.renderConn = nil
	end
	if state.reportConn then
		state.reportConn:Disconnect()
		state.reportConn = nil
	end

	-- Destroy by direct reference to what we created. Never by sweeping Workspace for a
	-- name pattern — a `find("Arena")` sweep is exactly how the last project destroyed a
	-- live shipped script and, separately, an owner's backup folder. (LESSONS.md A-04.)
	for _, truck in state.trucks do
		if truck and truck.Parent then
			TruckBuilder.destroy(truck)
		end
	end
	table.clear(state.trucks)

	if state.arena then
		state.arena:Destroy()
		state.arena = nil
	end

	if state.session then
		state.session.state = RaceService.State.IDLE
		state.session.vehicleCount = 0
		table.clear(state.session.vehicles)
		table.clear(state.session.bots)
		state.session.botCount = 0
		state.session = nil
	end

	state.track = nil
end

-- Builds every track in the pool and reports part counts, without racing. The cheap way to
-- find the one track whose geometry blows the budget.
function DevRace.auditAllTracks()
	local ids = TrackService.allIds()
	print(string.format("[DevRace] auditing %d tracks", #ids))

	local worst, worstId = 0, ""
	local totalMs = 0

	for _, id in ids do
		local track = TrackService.load(id, false)
		if track then
			local t0 = os.clock()
			local _model, stats = TrackBuilder.build(track, { detailTier = GameConfig.DetailTier.MEDIUM })
			local ms = (os.clock() - t0) * 1000
			totalMs += ms
			model:Destroy()

			if stats.total > worst then
				worst, worstId = stats.total, id
			end
			print(
				string.format(
					"  %s  %5d parts  %6.1f ms   surface %4d  walls %4d  decor %3d",
					id,
					stats.total,
					ms,
					stats.surface,
					stats.walls,
					stats.decor
				)
			)
		end
	end

	print(string.format("[DevRace] worst: %s at %d parts | %.0f ms total", worstId, worst, totalMs))
end

return DevRace
