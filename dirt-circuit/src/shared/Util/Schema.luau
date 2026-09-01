--!nonstrict
-- Schema — declarative persistence.
--
-- ★ This module exists to delete Stellar Dominion's single most reliable bug. (Lesson B-01)
--
-- There, adding one persisted field required FOUR separate edits — `makeDefault`,
-- `normalizeMeta`, the `SetAsync` payload in `saveData`, and the load block in
-- `onPlayerAdded`. Miss any one and the field silently does not persist. `bestNight` shipped
-- with two of the four: it updated in-session and reset on every rejoin, and the bug was
-- only found by reading the raw DataStore blob. Attribute-backed preferences were worse —
-- they needed THREE more lists in three more files, and two separate fields shipped missing
-- the third, found by two different people weeks apart.
--
-- Here, a field is ONE line in ONE table (`ProfileSchema`). Defaults, migration of older
-- blobs, validation, clamping, the save payload and the load path are all derived from that
-- declaration. There is no second place to forget.
--
-- The diagnostic signature worth memorising anyway: "works in-session, resets on rejoin"
-- means the field is missing from save and/or load.
--
-- Lesson B-02 is enforced here too: `coerce` REBUILDS every value from primitives, so a
-- crafted client table can never reach `SetAsync`. On Stellar Dominion one smuggled Vector3
-- made every future save for that account throw, silently, forever.

local Guards = require(script.Parent.Guards)

local Schema = {}

export type Field = {
	kind: string,
	default: any,
	min: number?,
	max: number?,
	maxLen: number?,
	allow: { [any]: boolean }?,
	of: Field?,
}

--------------------------------------------------------------------------------
-- Field constructors
--------------------------------------------------------------------------------

function Schema.number(default: number, min: number?, max: number?): Field
	return { kind = "number", default = default, min = min or -1e9, max = max or 1e9 }
end

function Schema.int(default: number, min: number?, max: number?): Field
	return { kind = "int", default = default, min = min or -1e9, max = max or 1e9 }
end

function Schema.bool(default: boolean): Field
	return { kind = "bool", default = default }
end

function Schema.str(default: string, maxLen: number?): Field
	return { kind = "str", default = default, maxLen = maxLen or 64 }
end

function Schema.enum(default: any, allow: { any }): Field
	local set = {}
	for _, v in allow do
		set[v] = true
	end
	return { kind = "enum", default = default, allow = set }
end

-- A string-keyed map of a uniform value type. Keys are coerced to bounded strings.
function Schema.map(of: Field, maxKeys: number?): Field
	return { kind = "map", default = {}, of = of, maxLen = maxKeys or 256 }
end

-- A dense array of a uniform value type.
function Schema.list(of: Field, maxLen: number?): Field
	return { kind = "list", default = {}, of = of, maxLen = maxLen or 256 }
end

--------------------------------------------------------------------------------
-- Coercion
--------------------------------------------------------------------------------

local coerceField

local function coerceContainer(field: Field, raw: any, isList: boolean): any
	local out = {}
	if type(raw) ~= "table" then
		return out
	end

	local limit = field.maxLen or 256
	local of = field.of
	if not of then
		return out
	end

	if isList then
		local n = math.min(#raw, limit)
		for i = 1, n do
			out[i] = coerceField(of, raw[i])
		end
		return out
	end

	local count = 0
	for k, v in raw do
		if count >= limit then
			break
		end
		-- Keys are rebuilt as bounded strings: a non-string key in a persisted table is
		-- exactly the class of value that made SetAsync throw on Stellar Dominion.
		if type(k) == "string" then
			local key = Guards.str(k, 64, "")
			if key ~= "" then
				out[key] = coerceField(of, v)
				count += 1
			end
		end
	end
	return out
end

-- Returns a value that is guaranteed valid, finite, in range, and built from primitives.
-- Used for BOTH directions: reading a stored blob (missing/legacy keys become defaults,
-- which is the migration path) and building the save payload.
function coerceField(field: Field, raw: any): any
	local kind = field.kind

	if kind == "number" then
		return Guards.number(raw, field.min, field.max, field.default)
	elseif kind == "int" then
		return Guards.int(raw, field.min, field.max, field.default)
	elseif kind == "bool" then
		return Guards.bool(raw, field.default)
	elseif kind == "str" then
		return Guards.str(raw, field.maxLen, field.default)
	elseif kind == "enum" then
		return Guards.enum(raw, field.allow, field.default)
	elseif kind == "map" then
		return coerceContainer(field, raw, false)
	elseif kind == "list" then
		return coerceContainer(field, raw, true)
	end

	-- An unknown kind is a programming error, not a data error. Fail loudly at boot.
	error(string.format("Schema: unknown field kind %q", tostring(kind)))
end

--------------------------------------------------------------------------------
-- Build
--------------------------------------------------------------------------------

export type Built = {
	fields: { [string]: Field },
	default: () -> { [string]: any },
	coerce: (any) -> { [string]: any },
	describe: () -> string,
}

-- Turns a `{ fieldName = Schema.<kind>(...) }` table into the four behaviours that used to
-- be four hand-maintained code sites.
function Schema.build(fields: { [string]: Field }): Built
	local built = {}
	built.fields = fields

	function built.default()
		local out = {}
		for name, field in fields do
			out[name] = coerceField(field, nil)
		end
		return out
	end

	-- Migration is not a separate code path: an old blob missing a key simply coerces that
	-- key from nil, which yields the declared default. A key we no longer declare is
	-- dropped, so retiring a field is also one line.
	function built.coerce(raw: any)
		local src = type(raw) == "table" and raw or {}
		local out = {}
		for name, field in fields do
			out[name] = coerceField(field, src[name])
		end
		return out
	end

	function built.describe()
		local names = {}
		for name, field in fields do
			table.insert(names, string.format("%s:%s", name, field.kind))
		end
		table.sort(names)
		return table.concat(names, ", ")
	end

	return built
end

return Schema
