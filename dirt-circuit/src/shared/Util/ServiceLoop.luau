--!nonstrict
-- ServiceLoop — named, pcall-wrapped, long-lived loops.
--
-- Lesson C-04. On Stellar Dominion a single `attempt to index nil` inside a top-level
-- `while true` loop SILENTLY ENDED THE LOOP, stopping a whole service for the rest of the
-- match. It happened independently to TurretService (it beam-killed its target and then
-- read `target.PrimaryPart.Position`) and to WaveService. Nothing errored to the output in
-- a way anyone noticed; the service just stopped existing.
--
-- Every long-lived loop in this project goes through here. A failing tick warns, names
-- itself, and the loop keeps running.

local RunService = game:GetService("RunService")

local ServiceLoop = {}

export type Handle = { stop: () -> (), isRunning: () -> boolean }

-- Warn at most once per (loop, message) per WARN_COOLDOWN so a per-frame failure cannot
-- become a log flood that hides everything else.
local WARN_COOLDOWN = 5

local function makeWarner(name: string)
	local lastWarn: { [string]: number } = {}
	return function(err: string)
		local now = os.clock()
		local last = lastWarn[err]
		if last and now - last < WARN_COOLDOWN then
			return
		end
		lastWarn[err] = now
		warn(string.format("[ServiceLoop:%s] tick error: %s", name, err))
	end
end

-- Runs `fn(dt)` every `interval` seconds on its own thread.
function ServiceLoop.spawn(name: string, interval: number, fn: (number) -> ()): Handle
	local running = true
	local warnOnce = makeWarner(name)

	task.spawn(function()
		local last = os.clock()
		while running do
			task.wait(interval)
			if not running then
				break
			end
			local now = os.clock()
			local dt = now - last
			last = now

			local ok, err = pcall(fn, dt)
			if not ok then
				warnOnce(tostring(err))
			end
		end
	end)

	return {
		stop = function()
			running = false
		end,
		isRunning = function()
			return running
		end,
	}
end

-- Runs `fn(dt)` every Heartbeat. Same protection.
function ServiceLoop.heartbeat(name: string, fn: (number) -> ()): Handle
	local warnOnce = makeWarner(name)
	local conn
	conn = RunService.Heartbeat:Connect(function(dt)
		local ok, err = pcall(fn, dt)
		if not ok then
			warnOnce(tostring(err))
		end
	end)

	return {
		stop = function()
			if conn then
				conn:Disconnect()
				conn = nil
			end
		end,
		isRunning = function()
			return conn ~= nil
		end,
	}
end

return ServiceLoop
