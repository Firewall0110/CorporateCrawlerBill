--!nonstrict
-- DataService — player profile persistence.
--
-- Thin on purpose. All the knowledge about WHAT is persisted lives in `ProfileSchema`; this
-- file only knows how to move a coerced blob between memory and a DataStore. That split is
-- what makes adding a field a one-line change (LESSONS.md B-01).
--
-- Behaviours inherited straight from Stellar Dominion's hardening pass:
--   * `save` RETURNS a success boolean. A bare `pcall` that discards its result makes
--     `SetAsync` failures invisible, and there it falsely acked a Robux grant that could
--     not persist. (B-04)
--   * Every value written is rebuilt from validated primitives by `Schema.coerce`, so a
--     crafted client table can never reach `SetAsync`. One smuggled Vector3 there made
--     every future save for that account throw, silently, forever. (B-02)
--   * Writes are gated off Studio, so a Play test can never touch a real profile. (I-07)
--   * `isLoaded` is exposed, because "the data reads as zero" is almost always "the async
--     load has not finished yet" and diagnosing it as anything else wastes a session.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ServiceLoop = require(ReplicatedStorage.Shared.Util.ServiceLoop)
local Signal = require(ReplicatedStorage.Shared.Util.Signal)
local ProfileSchema = require(script.Parent.ProfileSchema)

local DataService = {}

local AUTOSAVE_INTERVAL = 120
local LOAD_RETRIES = 4
local LOAD_RETRY_BACKOFF = 1.5

local store = nil
local profiles: { [Player]: any } = {}
local loaded: { [Player]: boolean } = {}
local dirty: { [Player]: boolean } = {}

DataService.profileLoaded = Signal.new("profileLoaded")
-- Fired on every cash/trophy movement so Analytics can log an economy event without every
-- call site remembering to. A single hook beats N call sites that must not forget.
DataService.economyEvent = Signal.new("economyEvent")

--------------------------------------------------------------------------------

local function keyFor(player: Player): string
	return ProfileSchema.KEY_PREFIX .. tostring(player.UserId)
end

-- Writes are disabled in Studio. The owner tests in the published game (LESSONS.md I-07),
-- and a Play test that writes a real profile is a corruption risk with no upside.
function DataService.writesEnabled(): boolean
	return not RunService:IsStudio() and store ~= nil
end

function DataService.isLoaded(player: Player): boolean
	return loaded[player] == true
end

function DataService.get(player: Player)
	return profiles[player]
end

--------------------------------------------------------------------------------
-- Load
--------------------------------------------------------------------------------

local function loadProfile(player: Player)
	local defaults = ProfileSchema.fields.default()

	if not store then
		profiles[player] = defaults
		loaded[player] = true
		DataService.profileLoaded:fire(player, defaults)
		return
	end

	local raw = nil
	local lastErr = nil

	for attempt = 1, LOAD_RETRIES do
		local ok, result = pcall(function()
			return store:GetAsync(keyFor(player))
		end)
		if ok then
			raw = result
			lastErr = nil
			break
		end
		lastErr = result
		task.wait(LOAD_RETRY_BACKOFF * attempt)
		if not player.Parent then
			return -- they left mid-retry
		end
	end

	if lastErr then
		-- A failed LOAD must not be followed by a save, or we overwrite a real profile with
		-- defaults. Mark the player unloaded and let them play a throwaway session.
		warn(string.format("[DataService] load failed for %s: %s", player.Name, tostring(lastErr)))
		profiles[player] = defaults
		loaded[player] = false
		DataService.profileLoaded:fire(player, defaults)
		return
	end

	-- Coercion IS the migration. An older blob missing a key gets that key's declared
	-- default; a key we no longer declare is dropped. No hand-written normalise pass, and
	-- therefore no chance of one drifting from the field list.
	local profile = ProfileSchema.fields.coerce(raw)

	local now = os.time()
	if profile.firstSeen == 0 then
		profile.firstSeen = now
	end
	profile.lastSeen = now

	profiles[player] = profile
	loaded[player] = true
	DataService.profileLoaded:fire(player, profile)
end

--------------------------------------------------------------------------------
-- Save
--------------------------------------------------------------------------------

-- Returns whether the write actually landed. Callers with something at stake (a purchase,
-- a payout) MUST check this. (LESSONS.md B-04)
function DataService.save(player: Player): boolean
	local profile = profiles[player]
	if not profile then
		return false
	end
	if not loaded[player] then
		return false -- never write over a profile we failed to read
	end
	if not DataService.writesEnabled() then
		dirty[player] = false
		return true -- Studio: pretend success so callers exercise the happy path
	end

	profile.lastSeen = os.time()

	-- Rebuild from primitives on the way OUT as well as on the way in. Anything that
	-- reached the in-memory table by an unvalidated path is scrubbed here before it can
	-- poison the account's future writes.
	local payload = ProfileSchema.fields.coerce(profile)

	local ok, err = pcall(function()
		store:SetAsync(keyFor(player), payload)
	end)

	if not ok then
		warn(string.format("[DataService] SAVE FAILED for %s: %s", player.Name, tostring(err)))
		return false
	end

	dirty[player] = false
	return true
end

function DataService.markDirty(player: Player)
	dirty[player] = true
end

--------------------------------------------------------------------------------
-- Mutation helpers
--------------------------------------------------------------------------------

-- `reason` is a required tag, not an optional nicety: it is what makes the economy feed
-- readable when you are trying to work out where currency is entering the game.
function DataService.addCash(player: Player, amount: number, reason: string): number
	local profile = profiles[player]
	if not profile then
		return 0
	end
	local delta = math.floor(amount)
	profile.cash = math.max(0, profile.cash + delta)
	if delta > 0 then
		profile.lifetimeCash += delta
	end
	dirty[player] = true
	DataService.economyEvent:fire(player, "cash", delta, reason)
	return profile.cash
end

function DataService.addTrophies(player: Player, amount: number, reason: string): number
	local profile = profiles[player]
	if not profile then
		return 0
	end
	profile.trophies = math.max(0, profile.trophies + math.floor(amount))
	dirty[player] = true
	DataService.economyEvent:fire(player, "trophies", amount, reason)
	return profile.trophies
end

-- Grants a cosmetic exactly once. Named `grantUnique` rather than `grant` because on
-- Stellar Dominion an idempotent `grantItem` silently no-opped for something already owned
-- while the caller had ALREADY charged premium currency for it. Making idempotency explicit
-- in the name forces the call site to have an opinion. (LESSONS.md B-06)
function DataService.grantUnique(player: Player, category: string, id: string): boolean
	local profile = profiles[player]
	if not profile then
		return false
	end
	local bag = profile[category]
	if type(bag) ~= "table" then
		warn(string.format("[DataService] grantUnique: unknown category %q", category))
		return false
	end
	if bag[id] then
		return false -- already owned; the caller must not have charged
	end
	bag[id] = true
	dirty[player] = true
	return true
end

--------------------------------------------------------------------------------
-- Lifecycle
--------------------------------------------------------------------------------

function DataService.start()
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(ProfileSchema.STORE_NAME)
	end)
	store = ok and result or nil
	if not ok then
		warn("[DataService] DataStore unavailable; running in-memory only: " .. tostring(result))
	end

	local function onAdded(player: Player)
		-- Lesson C-06: a bare pcall around a lifecycle handler MUST warn. On Stellar
		-- Dominion a silent one hid a throw in the argument expression itself, and every
		-- training beat that read the player's ship died on entry for months with no log.
		local ok2, err = pcall(function()
			loadProfile(player)
		end)
		if not ok2 then
			warn(string.format("[DataService] onPlayerAdded failed for %s: %s", player.Name, tostring(err)))
		end
	end

	Players.PlayerAdded:Connect(onAdded)
	for _, player in Players:GetPlayers() do
		task.spawn(onAdded, player)
	end

	Players.PlayerRemoving:Connect(function(player)
		local ok2, err = pcall(function()
			DataService.save(player)
		end)
		if not ok2 then
			warn(string.format("[DataService] save-on-leave failed for %s: %s", player.Name, tostring(err)))
		end
		profiles[player] = nil
		loaded[player] = nil
		dirty[player] = nil
	end)

	-- Autosave. Per-player pcall so one bad profile cannot stop the sweep (Lesson C-07),
	-- inside a ServiceLoop so a throw cannot end the loop entirely (Lesson C-04).
	ServiceLoop.spawn("DataService.autosave", AUTOSAVE_INTERVAL, function()
		for player, isDirty in dirty do
			if isDirty and player.Parent then
				pcall(function()
					DataService.save(player)
				end)
			end
		end
	end)

	game:BindToClose(function()
		for _, player in Players:GetPlayers() do
			pcall(function()
				DataService.save(player)
			end)
		end
	end)
end

return DataService
