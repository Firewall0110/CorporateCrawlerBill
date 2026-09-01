--!nonstrict
-- shim.luau — loads Roblox-flavoured Luau modules under Lune.
--
-- Our source uses `require(script.Parent.Parent.Config.StyleConfig)` and
-- `game:GetService("ReplicatedStorage").Shared.X`, neither of which Lune understands. Rather
-- than fork the modules for testing (which would guarantee drift — LESSONS.md H-03), this
-- shim makes the REAL files run unmodified by giving them the `script`, `game` and `require`
-- they expect.
--
-- A proxy accumulates an instance path as you index it; `require` turns that path back into
-- a file under src/ and loads it. So the module under test is the exact byte sequence Rojo
-- ships to Studio.

local fs = require("@lune/fs")
local luau = require("@lune/luau")
local roblox = require("@lune/roblox")

local shim = {}

local SRC_ROOT = "src"

-- ReplicatedStorage.Shared -> src/shared, ServerScriptService.Server -> src/server, etc.
local SERVICE_ROOT = {
	ReplicatedStorage = { SRC_ROOT },
	ServerScriptService = { SRC_ROOT },
	Workspace = { SRC_ROOT },
}

local FOLDER_ALIAS = { Shared = "shared", Server = "server", Client = "client" }

local cache = {}

local function pathToFile(parts)
	local mapped = {}
	for i, p in parts do
		mapped[i] = FOLDER_ALIAS[p] or p
	end
	return table.concat(mapped, "/") .. ".luau"
end

local newProxy

local function proxyIndex(self, key)
	local parts = rawget(self, "__parts")
	if key == "Parent" then
		local up = table.clone(parts)
		table.remove(up)
		return newProxy(up)
	end
	local down = table.clone(parts)
	table.insert(down, key)
	return newProxy(down)
end

function newProxy(parts)
	return setmetatable({ __parts = parts }, { __index = proxyIndex })
end

local function loadModule(parts)
	local file = pathToFile(parts)
	if cache[file] then
		return cache[file]
	end

	local source = fs.readFile(file)
	local scriptProxy = newProxy(parts)

	local env = {}
	-- Roblox datatypes, straight from Lune's own implementations.
	env.Instance = roblox.Instance
	env.CFrame = roblox.CFrame
	env.Vector3 = roblox.Vector3
	env.Vector2 = roblox.Vector2
	env.Color3 = roblox.Color3
	env.UDim = roblox.UDim
	env.UDim2 = roblox.UDim2
	env.Enum = roblox.Enum
	env.typeof = typeof

	env.script = scriptProxy
	env.game = {
		GetService = function(_, name)
			local root = SERVICE_ROOT[name]
			assert(root, "shim: unmapped service " .. tostring(name))
			return newProxy(table.clone(root))
		end,
	}
	env.workspace = env.game

	env.require = function(target)
		if type(target) == "table" and rawget(target, "__parts") then
			return loadModule(rawget(target, "__parts"))
		end
		error("shim: cannot require " .. tostring(target))
	end

	-- Standard library passthrough.
	for _, name in { "math", "table", "string", "os", "task", "coroutine", "bit32", "utf8" } do
		env[name] = (_G :: any)[name] or getfenv and getfenv()[name] or nil
	end
	env.math, env.table, env.string, env.os = math, table, string, os
	env.bit32, env.utf8, env.coroutine = bit32, utf8, coroutine
	env.pcall, env.xpcall, env.select, env.type = pcall, xpcall, select, type
	env.tostring, env.tonumber, env.error, env.assert = tostring, tonumber, error, assert
	env.setmetatable, env.getmetatable, env.rawget, env.rawset = setmetatable, getmetatable, rawget, rawset
	env.ipairs, env.pairs, env.next, env.unpack = ipairs, pairs, next, unpack
	env.print, env.warn = print, warn
	env.task = { wait = function() end, spawn = function(f, ...) f(...) end, delay = function() end }

	local chunk = luau.load(source, { debugName = file, environment = env })
	local result = chunk()
	cache[file] = result
	return result
end

-- Loads a module by its path under src/, e.g. shim.require("shared", "Sim", "TrackBuilder")
function shim.require(...)
	return loadModule({ SRC_ROOT, ... })
end

return shim
