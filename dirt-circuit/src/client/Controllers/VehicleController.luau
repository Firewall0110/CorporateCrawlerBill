--!nonstrict
-- VehicleController — local prediction, reconciliation, and remote interpolation.
--
-- The client predicts ONLY its own truck, and it does so by calling the same
-- `Shared.Sim.VehicleSim` the server calls, with the same fixed timestep and the same
-- constants. Not a port of it, not a "close enough" client model — the same file.
-- (LESSONS.md C-02.)
--
-- That is the whole trick. Stellar Dominion's movement went client-authoritative because
-- split authority stuttered, and then needed a `MovementGuard` service bolted on to catch
-- speed-hackers after the fact. Here the server already ran the truth, so validation costs
-- nothing extra and the client is only ever guessing at latency, never at rules.
--
-- Other trucks are INTERPOLATED, never predicted. A mispredicted opponent that snaps into
-- place is much worse to race against than one rendered a tenth of a second late.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)
local VehicleSim = require(ReplicatedStorage.Shared.Sim.VehicleSim)
local Remotes = require(ReplicatedStorage.Shared.Net.Remotes)
local ClientState = require(script.Parent.Parent.ClientState)

local VehicleController = {}

local player = Players.LocalPlayer

local accumulator = 0
local sendAccumulator = 0
local sequence = 0

-- Unacknowledged input frames, kept so a correction can be replayed exactly.
-- Bounded: at 60 Hz this is one second of history, which is far more latency than a race
-- is playable at anyway. An unbounded buffer is a slow memory leak that only shows up in
-- long sessions.
local MAX_PENDING = 60
local pending: { { seq: number, input: any } } = {}

-- Snapshot buffer for remote trucks: two samples bracketing the render time.
local snapshotBuffer: { { t: number, data: { number } } } = {}
local MAX_SNAPSHOTS = 8

local localVehicle = nil
local localIndex = 1
local remoteViews: { [number]: any } = {}

--------------------------------------------------------------------------------

function VehicleController.attach(vehicle, track, indexInField: number)
	localVehicle = vehicle
	localIndex = indexInField
	ClientState.localVehicle = vehicle
	ClientState.track = track
	table.clear(pending)
	table.clear(snapshotBuffer)
	accumulator = 0
	sequence = 0
end

function VehicleController.detach()
	localVehicle = nil
	ClientState.localVehicle = nil
	ClientState.track = nil
	table.clear(pending)
	table.clear(snapshotBuffer)
end

--------------------------------------------------------------------------------
-- Prediction
--------------------------------------------------------------------------------

local function stepPrediction(frameDt: number)
	local track = ClientState.track
	if not localVehicle or not track then
		return
	end

	local steps, leftover = VehicleSim.advanceClock(accumulator, frameDt)
	accumulator = leftover

	for _ = 1, steps do
		sequence += 1
		-- Copy the input: `ClientState.input` is mutated in place by InputController every
		-- frame, so storing the reference would make every pending frame alias the newest
		-- one and a replay would be meaningless.
		local frame = {
			steer = ClientState.input.steer,
			throttle = ClientState.input.throttle,
			brake = ClientState.input.brake,
			nitro = ClientState.input.nitro,
		}

		VehicleSim.step(localVehicle, frame, track, GameConfig.PhysicsStep)

		table.insert(pending, { seq = sequence, input = frame })
		if #pending > MAX_PENDING then
			table.remove(pending, 1)
		end
	end
end

--------------------------------------------------------------------------------
-- Reconciliation
--------------------------------------------------------------------------------

local function reconcile(data: { number }, ackSeq: number)
	local track = ClientState.track
	if not localVehicle or not track then
		return
	end

	local fields = VehicleSim.SNAPSHOT_FIELDS
	local offset = (localIndex - 1) * fields

	local serverX = data[offset + 1]
	local serverZ = data[offset + 2]
	if serverX == nil then
		return
	end

	local error = VehicleSim.positionError(localVehicle, serverX, serverZ)

	-- Drop the frames the server has already folded in.
	while #pending > 0 and pending[1].seq <= ackSeq do
		table.remove(pending, 1)
	end

	if error <= GameConfig.ReconcileEpsilon then
		-- Small disagreement: ease toward the server rather than snapping. A visible snap
		-- on every packet is worse than a few studs of lag that nobody can perceive.
		local blend = math.min(1, GameConfig.ReconcileSoftRate * (1 / GameConfig.SnapshotHz))
		localVehicle.px += (serverX - localVehicle.px) * blend
		localVehicle.pz += (serverZ - localVehicle.pz) * blend
		return
	end

	-- Large disagreement: adopt the server state wholesale, then REPLAY every input the
	-- server has not seen yet. Because the replay runs the identical module with the
	-- identical timestep, the result is exact rather than approximate — which is the entire
	-- reason the sim is shared rather than duplicated.
	VehicleSim.unpackInto(localVehicle, data, offset)
	for _, frame in pending do
		VehicleSim.step(localVehicle, frame.input, track, GameConfig.PhysicsStep)
	end
end

--------------------------------------------------------------------------------
-- Remote interpolation
--------------------------------------------------------------------------------

local function sampleRemotes(renderTime: number)
	local count = #snapshotBuffer
	if count == 0 then
		return
	end

	-- Find the pair bracketing renderTime.
	local older, newer = snapshotBuffer[1], snapshotBuffer[count]
	for i = 1, count - 1 do
		if snapshotBuffer[i].t <= renderTime and snapshotBuffer[i + 1].t >= renderTime then
			older, newer = snapshotBuffer[i], snapshotBuffer[i + 1]
			break
		end
	end

	local span = newer.t - older.t
	local alpha = span > 1e-4 and math.clamp((renderTime - older.t) / span, 0, 1) or 1

	local fields = VehicleSim.SNAPSHOT_FIELDS
	local vehicleCount = #older.data // fields

	for i = 1, vehicleCount do
		if i ~= localIndex then
			local o = (i - 1) * fields
			local view = remoteViews[i]
			if view then
				view.px = older.data[o + 1] + (newer.data[o + 1] - older.data[o + 1]) * alpha
				view.pz = older.data[o + 2] + (newer.data[o + 2] - older.data[o + 2]) * alpha
				view.height = older.data[o + 4] + (newer.data[o + 4] - older.data[o + 4]) * alpha

				-- Headings must interpolate the SHORT way round, or a truck crossing the
				-- +/-pi seam spins a full turn in one snapshot interval.
				local a = older.data[o + 3]
				local b = newer.data[o + 3]
				local delta = (b - a + math.pi) % (math.pi * 2) - math.pi
				view.heading = a + delta * alpha
			end
		end
	end
end

function VehicleController.registerRemoteView(index: number, view)
	remoteViews[index] = view
end

function VehicleController.clearRemoteViews()
	table.clear(remoteViews)
end

--------------------------------------------------------------------------------
-- Wiring
--------------------------------------------------------------------------------

function VehicleController.start()
	local snapshotRemote = Remotes.get("RaceSnapshot")
	local inputRemote = Remotes.get("InputFrame")

	snapshotRemote.OnClientEvent:Connect(function(data, ackSeq)
		if type(data) ~= "table" then
			return
		end
		table.insert(snapshotBuffer, { t = os.clock(), data = data })
		if #snapshotBuffer > MAX_SNAPSHOTS then
			table.remove(snapshotBuffer, 1)
		end
		reconcile(data, ackSeq or 0)
	end)

	RunService.RenderStepped:Connect(function(dt)
		if ClientState.mode ~= "race" then
			return
		end

		stepPrediction(dt)
		sampleRemotes(os.clock() - GameConfig.InterpolationDelay)

		-- Input goes out on its own clock, well below the physics rate. Sending one packet
		-- per physics step would triple the uplink for no additional fidelity: the server
		-- holds the newest frame and applies it to every step until a newer one lands.
		sendAccumulator += dt
		local sendStep = 1 / GameConfig.InputSendHz
		if sendAccumulator >= sendStep then
			sendAccumulator = 0
			local i = ClientState.input
			-- Flat array, matching Remotes.Validate.inputFrame.
			inputRemote:FireServer({
				sequence,
				i.steer,
				i.throttle,
				i.brake,
				i.nitro and 1 or 0,
			})
		end
	end)
end

return VehicleController
