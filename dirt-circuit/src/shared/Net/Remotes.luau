--!nonstrict
-- Remotes — every remote declared in one table, with its payload validator.
--
-- Two Stellar Dominion lessons meet here.
--
-- D-01: a remote is a trust boundary. Its handlers there had to be retrofitted with NaN
-- guards (a `0/0` difficulty poisoned mob HP and reward scaling; a `0/0` build placement
-- put a structure at a NaN position), an allowlist for a teleport target name that could
-- otherwise reach any lobby descendant, and the removal of an uncapped prestige exploit.
-- Validating at declaration means a handler can only ever receive a payload that already
-- passed, so "did I remember to check this one" stops being a question.
--
-- And a smaller, sharper one: on that project some remotes were created at the DataStore
-- root and some inside a `Remotes` folder, and two of them (`AbilityState`, `Tutorial`)
-- were silently unreachable for a whole release because the client was `WaitForChild`-ing
-- in the folder while the server had created them at the root. One accessor, one location,
-- no ambiguity.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Guards = require(ReplicatedStorage.Shared.Util.Guards)
local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)

local Remotes = {}

local FOLDER_NAME = "DirtCircuitRemotes"

--------------------------------------------------------------------------------
-- Validators
--
-- Each returns a CLEANED payload, or nil to drop the message. Returning a cleaned copy
-- rather than a boolean means the handler cannot accidentally use the raw input.
--------------------------------------------------------------------------------

local Validate = {}

-- Client -> server, 30 Hz. The single hottest remote in the game, so it is a flat array
-- rather than a table of named fields: fewer allocations per send, and a smaller packet.
-- { seq, steer, throttle, brake, nitroFlag }
function Validate.inputFrame(raw)
	local a = Guards.numberArray(raw, 5)
	if not a then
		return nil
	end
	return {
		seq = Guards.int(a[1], 0, 2 ^ 31, 0),
		steer = Guards.number(a[2], -1, 1, 0),
		throttle = Guards.number(a[3], 0, 1, 0),
		brake = Guards.number(a[4], 0, 1, 0),
		nitro = a[5] >= 0.5,
	}
end

function Validate.buyUpgrade(raw)
	if type(raw) ~= "table" then
		return nil
	end
	local ladder = Guards.enum(raw.ladder, {
		tires = true,
		shocks = true,
		acceleration = true,
		topSpeed = true,
		nitro = true,
	}, nil)
	if not ladder then
		return nil
	end
	return { ladder = ladder }
end

function Validate.equipCosmetic(raw)
	if type(raw) ~= "table" then
		return nil
	end
	local slot = Guards.enum(raw.slot, { skin = true, horn = true, dust = true }, nil)
	if not slot then
		return nil
	end
	local id = Guards.str(raw.id, 48, "")
	if id == "" then
		return nil
	end
	return { slot = slot, id = id }
end

function Validate.enterBay(raw)
	if type(raw) ~= "table" then
		return nil
	end
	local bay = Guards.int(raw.bay, 1, 8, 0)
	if bay == 0 then
		return nil
	end
	return { bay = bay }
end

function Validate.setPref(raw)
	if type(raw) ~= "table" then
		return nil
	end
	local key = Guards.enum(raw.key, {
		prefDetailTier = true,
		prefUiScale = true,
		prefSteerMode = true,
		prefMusicOff = true,
		prefSfxVolume = true,
	}, nil)
	if not key then
		return nil
	end
	-- The value is validated a second time by the schema on write. Two gates, because this
	-- one knows the allowed KEYS and the schema knows the allowed VALUES, and neither
	-- should have to know the other's job.
	return { key = key, value = raw.value }
end

function Validate.feedback(raw)
	if type(raw) ~= "table" then
		return nil
	end
	local text = Guards.str(raw.text, 600, "")
	if #text < 4 then
		return nil
	end
	return {
		category = Guards.enum(raw.category, { bug = true, idea = true, praise = true, other = true }, "other"),
		text = text,
	}
end

--------------------------------------------------------------------------------
-- Declarations
--------------------------------------------------------------------------------

-- kind: "event" (RemoteEvent) or "function" (RemoteFunction)
-- dir:  "c2s" | "s2c" | "both"
-- validate: applied to the payload on the RECEIVING side of a c2s message
local DEFS = {
	-- Racing (hot path)
	InputFrame = { kind = "event", dir = "c2s", validate = Validate.inputFrame },
	RaceSnapshot = { kind = "event", dir = "s2c" },
	RaceEvent = { kind = "event", dir = "s2c" },

	-- Lobby & bays
	EnterBay = { kind = "event", dir = "c2s", validate = Validate.enterBay },
	LeaveBay = { kind = "event", dir = "c2s" },
	BayState = { kind = "event", dir = "s2c" },

	-- Garage
	BuyUpgrade = { kind = "function", dir = "c2s", validate = Validate.buyUpgrade },
	EquipCosmetic = { kind = "function", dir = "c2s", validate = Validate.equipCosmetic },
	ProfileState = { kind = "event", dir = "s2c" },

	-- Meta
	SetPref = { kind = "event", dir = "c2s", validate = Validate.setPref },
	Feedback = { kind = "function", dir = "c2s", validate = Validate.feedback },
	Leaderboard = { kind = "function", dir = "c2s" },
}

Remotes.DEFS = DEFS

--------------------------------------------------------------------------------
-- Access
--------------------------------------------------------------------------------

local folder: Folder? = nil

local function ensureFolder(): Folder
	if folder then
		return folder
	end
	if RunService:IsServer() then
		local existing = ReplicatedStorage:FindFirstChild(FOLDER_NAME)
		if not existing then
			existing = Instance.new("Folder")
			existing.Name = FOLDER_NAME
			existing.Parent = ReplicatedStorage
		end
		folder = existing
	else
		folder = ReplicatedStorage:WaitForChild(FOLDER_NAME, 30)
		assert(folder, "Remotes: folder never replicated")
	end
	return folder
end

-- Server-only. Creates every declared remote up front, so a client can `WaitForChild` any
-- of them immediately after the folder appears rather than racing individual creations.
function Remotes.init()
	assert(RunService:IsServer(), "Remotes.init is server-only")
	local f = ensureFolder()
	for name, def in DEFS do
		if not f:FindFirstChild(name) then
			local inst = Instance.new(def.kind == "function" and "RemoteFunction" or "RemoteEvent")
			inst.Name = name
			inst.Parent = f
		end
	end
end

function Remotes.get(name: string)
	assert(DEFS[name], string.format("Remotes: %q is not declared", name))
	local f = ensureFolder()
	local inst = f:FindFirstChild(name)
	if not inst and not RunService:IsServer() then
		inst = f:WaitForChild(name, 15)
	end
	assert(inst, string.format("Remotes: %q does not exist", name))
	return inst
end

--------------------------------------------------------------------------------
-- Server-side binding
--------------------------------------------------------------------------------

-- Binds a handler that only ever sees validated payloads. A message that fails validation
-- is dropped here and never reaches game logic.
--
-- Also rate-limits per player. `maxPerSecond` defaults generously for the input channel and
-- should be tightened for anything that touches money.
function Remotes.bind(name: string, handler: (Player, any) -> any, maxPerSecond: number?)
	assert(RunService:IsServer(), "Remotes.bind is server-only")

	local def = DEFS[name]
	local inst = Remotes.get(name)
	local limit = maxPerSecond or (GameConfig.InputSendHz * 2)

	local budget: { [Player]: number } = {}
	local windowStart: { [Player]: number } = {}

	local function guard(player: Player, raw: any)
		local now = os.clock()
		if not windowStart[player] or now - windowStart[player] >= 1 then
			windowStart[player] = now
			budget[player] = 0
		end
		budget[player] += 1
		if budget[player] > limit then
			return nil, false
		end

		if def.validate then
			local clean = def.validate(raw)
			if clean == nil then
				return nil, false
			end
			return clean, true
		end
		return raw, true
	end

	if def.kind == "function" then
		inst.OnServerInvoke = function(player, raw)
			local clean, ok = guard(player, raw)
			if not ok then
				return { ok = false, reason = "rejected" }
			end
			-- Lesson C-06: the receiver expression goes INSIDE the closure, so a throw
			-- while building the arguments cannot escape the guard.
			local success, result = pcall(function()
				return handler(player, clean)
			end)
			if not success then
				warn(string.format("[Remotes:%s] handler error: %s", name, tostring(result)))
				return { ok = false, reason = "error" }
			end
			return result
		end
	else
		inst.OnServerEvent:Connect(function(player, raw)
			local clean, ok = guard(player, raw)
			if not ok then
				return
			end
			local success, err = pcall(function()
				handler(player, clean)
			end)
			if not success then
				warn(string.format("[Remotes:%s] handler error: %s", name, tostring(err)))
			end
		end)
	end
end

return Remotes
