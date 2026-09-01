--!nonstrict
-- TrackService — loads track data and picks what to race on.
--
-- Rojo turns each `src/shared/Tracks/*.json` file into a ModuleScript returning the decoded
-- table, so loading a track is a `require` and nothing is parsed at runtime. (See
-- docs/TRACK_FORMAT.md.)
--
-- Models are cached per (track, direction). Baking a TrackModel walks a few thousand grid
-- cells; doing that once per server rather than once per race is free and obviously correct.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local TrackModel = require(ReplicatedStorage.Shared.Sim.TrackModel)
local Logger = require(ReplicatedStorage.Shared.Util.Logger)

local TrackService = {}

local CHANNEL = "TrackService"

local folder = ReplicatedStorage.Shared:FindFirstChild("Tracks")
local cache: { [string]: any } = {}
local ids: { string } = {}
-- Which tracks have been raced this server, so a rotation does not repeat until it has to.
local recent: { [string]: boolean } = {}

local function ensureIds()
	if #ids > 0 then
		return
	end
	if not folder then
		warn("[TrackService] ReplicatedStorage.Shared.Tracks is missing — no tracks to race")
		return
	end
	for _, child in folder:GetChildren() do
		-- The manifest is metadata, not a track. Matching on the id convention rather than
		-- excluding known non-tracks means a new metadata file cannot accidentally be raced.
		if child:IsA("ModuleScript") and child.Name:match("^stadium_%d+$") then
			table.insert(ids, child.Name)
		end
	end
	table.sort(ids)
	Logger.print(CHANNEL, "found %d tracks", #ids)
end

function TrackService.count(): number
	ensureIds()
	return #ids
end

function TrackService.allIds(): { string }
	ensureIds()
	return table.clone(ids)
end

-- Returns a baked TrackModel, or nil with a reason. Never throws: a malformed track must
-- cost one race, not the server.
function TrackService.load(id: string, reverse: boolean?)
	ensureIds()
	local key = id .. (reverse and "_rev" or "")
	if cache[key] then
		return cache[key]
	end

	if not folder then
		return nil, "no Tracks folder"
	end
	local module = folder:FindFirstChild(id)
	if not module or not module:IsA("ModuleScript") then
		return nil, string.format("unknown track %q", id)
	end

	-- Lesson C-06: the require goes INSIDE the closure. A throw while evaluating the
	-- argument expression would escape a `pcall(require, module)` entirely.
	local ok, result = pcall(function()
		return require(module)
	end)
	if not ok then
		warn(string.format("[TrackService] failed to require %s: %s", id, tostring(result)))
		return nil, "require failed"
	end

	local built
	ok, built = pcall(function()
		return TrackModel.fromData(result, reverse)
	end)
	if not ok then
		warn(string.format("[TrackService] failed to bake %s: %s", id, tostring(built)))
		return nil, "bake failed"
	end

	cache[key] = built
	Logger.print(
		CHANNEL,
		"baked %s%s (%d nodes, %d checkpoints)",
		id,
		reverse and " reversed" or "",
		built.nodeCount,
		built.checkpointCount
	)
	return built
end

-- Picks the next track. Every track is raced once before any repeats, and direction is a
-- coin flip — which doubles the effective pool for free, since reverse is a table flip at
-- load rather than a second dataset.
function TrackService.pickNext(): (any, string, boolean)
	ensureIds()
	if #ids == 0 then
		return nil, "", false
	end

	local pool = {}
	for _, id in ids do
		if not recent[id] then
			table.insert(pool, id)
		end
	end
	if #pool == 0 then
		table.clear(recent)
		pool = table.clone(ids)
	end

	local id = pool[math.random(1, #pool)]
	recent[id] = true

	local reverse = math.random() < 0.5
	local model = TrackService.load(id, reverse)
	if not model then
		-- One bad track must not stall the rotation. Mark it used and try the next.
		recent[id] = true
		for _, other in ids do
			if not recent[other] then
				local fallback = TrackService.load(other, false)
				if fallback then
					recent[other] = true
					return fallback, other, false
				end
			end
		end
		return nil, id, reverse
	end

	return model, id, reverse
end

return TrackService
