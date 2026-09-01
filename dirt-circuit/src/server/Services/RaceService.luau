--!nonstrict
-- RaceService — the RaceManager. One `RaceSession` per bay.
--
-- Owns the race state machine, the authoritative physics loop, and the snapshot broadcast.
-- Bots and humans are the same array of vehicles; the only difference is where an input
-- frame comes from.
--
--   IDLE -> GARAGE -> GRID -> COUNTDOWN -> RACING -> PODIUM -> IDLE
--
-- Deliberately NOT a reserved server (LESSONS.md I-01). Roblox refuses friend-joins into a
-- reserved server BEFORE any game code runs — Stellar Dominion had to build a cross-server
-- player registry, an invite LaunchData round-trip and a whole JOIN FRIEND panel to route
-- around it. Bays are folders in a public server, so the platform's own Join button works
-- and none of that stack ever gets written.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)
local VehicleConfig = require(ReplicatedStorage.Shared.Config.VehicleConfig)
local EconomyConfig = require(ReplicatedStorage.Shared.Config.EconomyConfig)
local LeagueConfig = require(ReplicatedStorage.Shared.Config.LeagueConfig)
local VehicleSim = require(ReplicatedStorage.Shared.Sim.VehicleSim)
local Collision = require(ReplicatedStorage.Shared.Sim.Collision)
local ServiceLoop = require(ReplicatedStorage.Shared.Util.ServiceLoop)
local Remotes = require(ReplicatedStorage.Shared.Net.Remotes)
local Signal = require(ReplicatedStorage.Shared.Util.Signal)

local AIDriverService = require(script.Parent.AIDriverService)
local DataService = require(script.Parent.DataService)
local ProfileSchema = require(script.Parent.ProfileSchema)

local RaceService = {}

RaceService.State = {
	IDLE = "IDLE",
	GARAGE = "GARAGE",
	GRID = "GRID",
	COUNTDOWN = "COUNTDOWN",
	RACING = "RACING",
	PODIUM = "PODIUM",
}

RaceService.raceFinished = Signal.new("raceFinished")

local sessions: { [number]: any } = {}
-- Latest validated input frame per player. Overwritten, never queued: if a frame is late we
-- want the newest one, not a backlog that would make the truck replay stale intent.
local latestInput: { [Player]: any } = {}

--------------------------------------------------------------------------------
-- Session
--------------------------------------------------------------------------------

local Session = {}
Session.__index = Session

local function newSession(bayId: number)
	return setmetatable({
		bayId = bayId,
		state = RaceService.State.IDLE,
		stateEnteredAt = os.clock(),

		track = nil,
		vehicles = {}, -- flat array; humans and bots together
		vehicleCount = 0,
		bots = {},
		botCount = 0,
		byPlayer = {}, -- Player -> vehicle
		arena = nil, -- Folder

		accumulator = 0,
		raceStartedAt = 0,
		leaderFinishedAt = nil,
		finishOrder = {},

		snapshotAccum = 0,
		snapshotBuffer = {},
	}, Session)
end

function Session:setState(state: string)
	self.state = state
	self.stateEnteredAt = os.clock()
	self:broadcast("state", { state = state, bay = self.bayId })
end

function Session:elapsed(): number
	return os.clock() - self.stateEnteredAt
end

function Session:broadcast(kind: string, payload)
	local remote = Remotes.get("RaceEvent")
	for _, vehicle in self.vehicles do
		local player = vehicle.player
		if player and player.Parent then
			remote:FireClient(player, kind, payload)
		end
	end
end

--------------------------------------------------------------------------------
-- Grid
--------------------------------------------------------------------------------

function Session:seatGrid(entrants: { Player }, track, league: string)
	self.track = track
	table.clear(self.vehicles)
	table.clear(self.bots)
	table.clear(self.byPlayer)
	self.vehicleCount = 0
	self.botCount = 0

	local grid = track.startGrid
	local slot = 0

	----------------------------------------------------------------------------
	-- Humans first, best-placed slots by league standing.
	--
	-- Lesson C-07: EVERY placement is individually pcall-guarded and the racer list is
	-- built from successful placements only. On Stellar Dominion an unguarded per-player
	-- deploy loop meant one player's spawn crash aborted the whole loop — the first players
	-- got ships and everyone after was stranded in the lobby. That is the classic "works
	-- solo, breaks in a party" multiplayer symptom, and it is entirely a missing pcall.
	----------------------------------------------------------------------------
	for _, player in entrants do
		if slot >= GameConfig.MaxRacers then
			break
		end
		local ok, err = pcall(function()
			local profile = DataService.get(player)
			assert(profile, "no profile loaded")
			local stats = VehicleConfig.resolve(ProfileSchema.upgradeTiers(profile))
			local spawn = grid[slot + 1]
			assert(spawn, "no grid slot")

			local vehicle = VehicleSim.create("p_" .. tostring(player.UserId), stats, spawn)
			vehicle.player = player
			vehicle.displayName = player.DisplayName
			vehicle.isBot = false

			slot += 1
			self.vehicleCount += 1
			self.vehicles[self.vehicleCount] = vehicle
			self.byPlayer[player] = vehicle
		end)
		if not ok then
			warn(string.format("[RaceService] could not seat %s: %s", player.Name, tostring(err)))
			-- They stay in the lobby. The race continues for everyone else.
		end
	end

	----------------------------------------------------------------------------
	-- Fill the rest with bots, so a solo player always races a full field of eight.
	----------------------------------------------------------------------------
	local leagueDef = LeagueConfig.forTrophies(0)
	for _, def in LeagueConfig.Leagues do
		if def.id == league then
			leagueDef = def
		end
	end

	while slot < GameConfig.MaxRacers do
		local spawn = grid[slot + 1]
		if not spawn then
			break
		end
		local lo, hi = leagueDef.botSkill[1], leagueDef.botSkill[2]
		local skill = lo + math.random() * (hi - lo)

		local ok, err = pcall(function()
			local bot = AIDriverService.createBot(slot + 1, skill, spawn, league)
			slot += 1
			self.vehicleCount += 1
			self.vehicles[self.vehicleCount] = bot.vehicle
			self.botCount += 1
			self.bots[self.botCount] = bot
		end)
		if not ok then
			warn(string.format("[RaceService] bot seat failed: %s", tostring(err)))
			break -- a failing bot factory would otherwise spin this loop forever
		end
	end

	return self.vehicleCount
end

--------------------------------------------------------------------------------
-- Physics
--------------------------------------------------------------------------------

-- One fixed step for the whole field.
--
-- Order matters and is the same order the client's prediction uses: every vehicle is
-- integrated independently first, and only then are trucks resolved against each other.
-- Interleaving them would make the result depend on array order, which would diverge
-- between client and server the moment the field re-sorted.
function Session:stepPhysics(dt: number)
	local track = self.track
	local vehicles = self.vehicles
	local n = self.vehicleCount

	-- Leader progress, computed ONCE per step and handed to every bot. Lesson E-01: do the
	-- shared work once rather than letting each of eight bots rescan the field.
	local leaderProgress = 0
	for i = 1, n do
		local p = VehicleSim.progress(vehicles[i], track)
		if p > leaderProgress then
			leaderProgress = p
		end
	end

	local ctx = {
		now = os.clock(),
		leaderProgress = leaderProgress,
		totalLaps = GameConfig.Laps,
	}

	-- Humans
	for i = 1, n do
		local v = vehicles[i]
		if not v.isBot and v.active then
			local player = v.player
			local input = VehicleSim.NEUTRAL_INPUT
			if player and player.Parent then
				input = latestInput[player] or VehicleSim.NEUTRAL_INPUT
			end
			-- Per-vehicle pcall, same reasoning as the grid loop.
			local ok, err = pcall(function()
				VehicleSim.step(v, input, track, dt)
			end)
			if not ok then
				warn(string.format("[RaceService] step failed for %s: %s", v.id, tostring(err)))
			end
		end
	end

	-- Bots (one shared call, never a loop per bot — Lesson C-03)
	AIDriverService.stepAll(self.bots, self.botCount, track, vehicles, n, ctx, dt)

	-- Truck-vs-truck, once, for the whole field.
	Collision.resolveTrucks(vehicles, n)

	self:checkFinishes()
end

function Session:checkFinishes()
	local now = os.clock()
	for i = 1, self.vehicleCount do
		local v = self.vehicles[i]
		if v.active and not v.finished and v.lap >= GameConfig.Laps then
			v.finished = true
			v.finishTime = now - self.raceStartedAt
			table.insert(self.finishOrder, v)

			if not self.leaderFinishedAt then
				self.leaderFinishedAt = now
			end

			self:broadcast("finish", {
				id = v.id,
				name = v.displayName,
				position = #self.finishOrder,
				time = v.finishTime,
			})
		end
	end
end

-- Live standings, cheapest correct form: one scalar per truck, one sort.
function Session:standings()
	local order = table.create(self.vehicleCount)
	for i = 1, self.vehicleCount do
		order[i] = self.vehicles[i]
	end
	local track = self.track
	table.sort(order, function(a, b)
		-- Finishers always outrank runners, and among finishers the earlier one wins.
		if a.finished ~= b.finished then
			return a.finished
		end
		if a.finished and b.finished then
			return (a.finishTime or 0) < (b.finishTime or 0)
		end
		return VehicleSim.progress(a, track) > VehicleSim.progress(b, track)
	end)
	return order
end

--------------------------------------------------------------------------------
-- Snapshots
--------------------------------------------------------------------------------

function Session:broadcastSnapshot()
	local buffer = self.snapshotBuffer
	table.clear(buffer)

	local fields = VehicleSim.SNAPSHOT_FIELDS
	for i = 1, self.vehicleCount do
		VehicleSim.packInto(self.vehicles[i], buffer, (i - 1) * fields)
	end

	local remote = Remotes.get("RaceSnapshot")
	for i = 1, self.vehicleCount do
		local v = self.vehicles[i]
		local player = v.player
		if player and player.Parent then
			-- `ackSeq` tells this client which of its own input frames the server has
			-- already folded in, so it knows exactly how much to replay.
			local input = latestInput[player]
			remote:FireClient(player, buffer, input and input.seq or 0)
		end
	end
end

--------------------------------------------------------------------------------
-- Payout
--------------------------------------------------------------------------------

function Session:payout(league: string)
	local order = self:standings()

	for position, v in order do
		local player = v.player
		if player and player.Parent and not v.isBot then
			-- Per-player pcall: one bad profile must not stop the rest of the field being
			-- paid. A player who is not paid because someone else errored is the worst
			-- possible bug in an economy.
			local ok, err = pcall(function()
				local cash = EconomyConfig.positionCash(position, league)
				local trophies = EconomyConfig.positionTrophies(position)

				DataService.addCash(player, cash, "race_finish")
				if trophies > 0 then
					DataService.addTrophies(player, trophies, "race_podium")
				end

				local profile = DataService.get(player)
				if profile then
					profile.racesEntered += 1
					if position == 1 then
						profile.racesWon += 1
					end
					if position <= 3 then
						profile.podiums += 1
					end
					if profile.bestFinish == 0 or position < profile.bestFinish then
						profile.bestFinish = position
					end
					profile.league = LeagueConfig.forTrophies(profile.trophies).id
				end

				-- Force the write and CHECK it. A payout that cannot persist must be
				-- visible, not silently lost. (LESSONS.md B-04)
				if not DataService.save(player) then
					warn(
						string.format(
							"[RaceService] payout for %s did not persist (cash=%d trophies=%d)",
							player.Name,
							cash,
							trophies
						)
					)
				end
			end)
			if not ok then
				warn(string.format("[RaceService] payout failed for %s: %s", player.Name, tostring(err)))
			end
		end
	end

	RaceService.raceFinished:fire(self, order, league)
	return order
end

--------------------------------------------------------------------------------
-- Tick
--------------------------------------------------------------------------------

function Session:tick(frameDt: number)
	local S = RaceService.State

	if self.state == S.COUNTDOWN then
		-- The sim runs during the countdown so trucks settle onto the grid, but inputs are
		-- ignored: this is where a truck that spawned half-inside a barrier resolves out.
		local steps, leftover = VehicleSim.advanceClock(self.accumulator, frameDt)
		self.accumulator = leftover
		for _ = 1, steps do
			for i = 1, self.vehicleCount do
				VehicleSim.step(
					self.vehicles[i],
					VehicleSim.NEUTRAL_INPUT,
					self.track,
					GameConfig.PhysicsStep
				)
			end
			Collision.resolveTrucks(self.vehicles, self.vehicleCount)
		end

		if self:elapsed() >= GameConfig.CountdownSeconds then
			self.raceStartedAt = os.clock()
			self:setState(S.RACING)
		end
		return
	end

	if self.state ~= S.RACING then
		return
	end

	local steps, leftover = VehicleSim.advanceClock(self.accumulator, frameDt)
	self.accumulator = leftover
	for _ = 1, steps do
		self:stepPhysics(GameConfig.PhysicsStep)
	end

	-- Snapshot on its own clock, at a fraction of the physics rate. Lesson E-06: know which
	-- things need 60 Hz and which do not. Physics does. Replication does not.
	self.snapshotAccum += frameDt
	local snapshotStep = 1 / GameConfig.SnapshotHz
	if self.snapshotAccum >= snapshotStep then
		self.snapshotAccum = 0
		self:broadcastSnapshot()
	end

	-- Termination. Three independent guarantees, because a session that never ends holds a
	-- bay hostage for the whole server's lifetime.
	local allDone = #self.finishOrder >= self.vehicleCount
	local graceExpired = self.leaderFinishedAt
		and (os.clock() - self.leaderFinishedAt) > GameConfig.DnfGraceSeconds
	local hardTimeout = (os.clock() - self.raceStartedAt) > GameConfig.RaceHardTimeoutSeconds

	if allDone or graceExpired or hardTimeout then
		if hardTimeout and not allDone then
			warn(string.format("[RaceService] bay %d hit the hard timeout; ending race", self.bayId))
		end
		self:setState(S.PODIUM)
	end
end

--------------------------------------------------------------------------------
-- Module surface
--------------------------------------------------------------------------------

function RaceService.getSession(bayId: number)
	return sessions[bayId]
end

function RaceService.createSession(bayId: number)
	local session = newSession(bayId)
	sessions[bayId] = session
	return session
end

function RaceService.start()
	Remotes.bind("InputFrame", function(player, frame)
		-- Newest wins. No queue: a backlog would make the truck act on stale intent, which
		-- feels far worse than dropping a frame.
		local existing = latestInput[player]
		if existing and frame.seq < existing.seq then
			return -- out-of-order UDP-ish arrival
		end
		latestInput[player] = frame
	end, GameConfig.InputSendHz * 2)

	Players.PlayerRemoving:Connect(function(player)
		latestInput[player] = nil
		for _, session in sessions do
			local v = session.byPlayer[player]
			if v then
				-- Do NOT destroy the vehicle mid-step. Mark it and let the loop drop it, so
				-- nothing is reading a table another thread just cleared. (Lesson C-05)
				v.active = false
				v.player = nil
				session.byPlayer[player] = nil
			end
		end
	end)

	-- ONE loop for every bay. Lesson C-03 and C-04 together: a shared stepper, wrapped so
	-- one bad session tick warns instead of ending racing for the whole server.
	ServiceLoop.heartbeat("RaceService.tick", function(dt)
		for _, session in sessions do
			local ok, err = pcall(function()
				session:tick(dt)
			end)
			if not ok then
				warn(string.format("[RaceService] bay %d tick failed: %s", session.bayId, tostring(err)))
			end
		end
	end)
end

RaceService.Session = Session

return RaceService
