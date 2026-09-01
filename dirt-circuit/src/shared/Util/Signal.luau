--!nonstrict
-- Signal — a minimal typed event.
--
-- Exists so client coordination is explicit rather than a bag of globals plus a poller.
-- Stellar Dominion carried `_G.AerialCameraActive`, `_G.requestShipCameraSwitch`,
-- `_G.forceStoreOpen` and a `while true do task.wait(0.1)` watcher looking at them, and
-- replaced the lot with a state module and signals. We start there. (Lesson C-09)

local Signal = {}
Signal.__index = Signal

export type Connection = { disconnect: (Connection) -> () }

function Signal.new(name: string?)
	return setmetatable({
		_name = name or "Signal",
		_handlers = {},
	}, Signal)
end

function Signal:connect(fn: (...any) -> ()): Connection
	local handlers = self._handlers
	handlers[fn] = true

	return {
		disconnect = function()
			handlers[fn] = nil
		end,
	}
end

-- Fires every handler. A throwing handler warns and does NOT stop the others.
--
-- Lesson C-04 in miniature: one bad listener must never silently take out the rest of
-- the dispatch. Stellar Dominion lost whole services to exactly this shape of failure.
function Signal:fire(...)
	for fn in self._handlers do
		local ok, err = pcall(fn, ...)
		if not ok then
			warn(string.format("[Signal:%s] handler error: %s", self._name, tostring(err)))
		end
	end
end

function Signal:destroy()
	table.clear(self._handlers)
end

return Signal
