--!nonstrict
-- Logger — level-gated logging, quiet by default.
--
-- Replaces the `_G.DebugPrint` family (Lesson C-09) and the habit of leaving raw prints in
-- shipped services. `warn` for real problems stays a plain `warn` so it is never filtered.

local Logger = {}

local enabled: { [string]: boolean } = {}
local globalEnabled = false

function Logger.setEnabled(on: boolean, channel: string?)
	if channel then
		enabled[channel] = on
	else
		globalEnabled = on
	end
end

function Logger.isEnabled(channel: string?): boolean
	if channel and enabled[channel] ~= nil then
		return enabled[channel]
	end
	return globalEnabled
end

function Logger.print(channel: string, fmt: string, ...)
	if not Logger.isEnabled(channel) then
		return
	end
	print(string.format("[%s] " .. fmt, channel, ...))
end

-- Always emitted. A real problem is not a debug channel.
function Logger.warn(channel: string, fmt: string, ...)
	warn(string.format("[%s] " .. fmt, channel, ...))
end

return Logger
