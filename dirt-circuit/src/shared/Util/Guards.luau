--!nonstrict
-- Guards — validation primitives for anything crossing a trust boundary.
--
-- Lesson B-03 / D-01. `0/0` satisfies `type(x) == "number"`, survives `math.clamp`, and
-- makes EVERY comparison false, so it slips through range checks that look airtight.
-- On Stellar Dominion it poisoned mob-HP and reward scaling and built a structure at a NaN
-- position. Here it would corrupt a truck's position irrecoverably and then replicate that
-- corruption to all eight players, so the guard is load-bearing.

local Guards = {}

local NAN_SAFE_MAX = 1e12

-- The only correct finiteness test. `x ~= x` is true only for NaN.
function Guards.finite(x: any): boolean
	return type(x) == "number" and x == x and x ~= math.huge and x ~= -math.huge
end

-- A finite number inside [min, max], else `fallback`. Never returns NaN.
function Guards.number(x: any, min: number, max: number, fallback: number): number
	if not Guards.finite(x) then
		return fallback
	end
	return math.clamp(x, min, max)
end

function Guards.int(x: any, min: number, max: number, fallback: number): number
	local n = Guards.number(x, min, max, fallback)
	return math.floor(n + 0.5)
end

function Guards.bool(x: any, fallback: boolean): boolean
	if type(x) == "boolean" then
		return x
	end
	return fallback
end

-- Trims, caps length, and rejects anything non-string. Lesson D-03.
function Guards.str(x: any, maxLen: number, fallback: string): string
	if type(x) ~= "string" then
		return fallback
	end
	local trimmed = (x:gsub("^%s+", ""):gsub("%s+$", ""))
	if #trimmed > maxLen then
		trimmed = trimmed:sub(1, maxLen)
	end
	return trimmed
end

-- Membership in an allowlist. Prefer this to a blocklist — but audit the legitimate
-- off-convention values first: Stellar Dominion's `DeckTarget$` allowlist broke the
-- basement lift, whose real target was named `BasementTarget`. (Lesson D-02)
function Guards.enum(x: any, allow: { [any]: boolean }, fallback: any): any
	if allow[x] then
		return x
	end
	return fallback
end

-- A finite Vector3 with every component bounded. Returns nil if it cannot be trusted;
-- callers must handle nil rather than substituting a "safe" position silently.
function Guards.vector3(v: any, maxMagnitude: number?): Vector3?
	if typeof(v) ~= "Vector3" then
		return nil
	end
	if not (Guards.finite(v.X) and Guards.finite(v.Y) and Guards.finite(v.Z)) then
		return nil
	end
	local limit = maxMagnitude or NAN_SAFE_MAX
	if v.Magnitude > limit then
		return nil
	end
	return v
end

-- Asserts a table is a plain array of `n` finite numbers. Used on the wire format for
-- input frames and snapshots, where a malformed payload must be dropped, not clamped.
function Guards.numberArray(t: any, n: number): { number }?
	if type(t) ~= "table" or #t ~= n then
		return nil
	end
	for i = 1, n do
		if not Guards.finite(t[i]) then
			return nil
		end
	end
	return t
end

return Guards
