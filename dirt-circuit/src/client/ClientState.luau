--!nonstrict
-- ClientState — typed shared client state and signals.
--
-- Exists so that no client coordination ever happens through globals. Stellar Dominion
-- carried `_G.AerialCameraActive`, `_G.requestShipCameraSwitch`, `_G.forceStoreOpen`,
-- `_G.ShipUpgradeStoreGUI_isOpen` and more, plus a `while true do task.wait(0.1) end`
-- watcher polling them, and replaced the whole arrangement with exactly this. We start
-- here rather than arriving here. (LESSONS.md C-09; `selene.toml` denies global usage so it
-- cannot regress quietly.)

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Signal = require(ReplicatedStorage.Shared.Util.Signal)

local ClientState = {}

-- "lobby" | "garage" | "race" | "podium"
ClientState.mode = "lobby"
ClientState.bayId = nil

-- Detail tier resolved once at boot (GameConfig.DetailTier). Read by every cosmetic
-- system to decide whether to CREATE an effect, not whether to hide one.
ClientState.detailTier = nil

-- The local player's vehicle state, owned by VehicleController.
ClientState.localVehicle = nil
ClientState.track = nil

-- Latest input frame, produced by InputController and consumed by VehicleController.
ClientState.input = { steer = 0, throttle = 0, brake = 0, nitro = false }

ClientState.viewport = Vector2.new(1280, 720)
ClientState.userScale = 1

ClientState.ModeChanged = Signal.new("ModeChanged")
ClientState.ViewportChanged = Signal.new("ViewportChanged")
ClientState.RaceEvent = Signal.new("RaceEvent")

function ClientState.setMode(mode: string)
	if ClientState.mode == mode then
		return
	end
	ClientState.mode = mode
	ClientState.ModeChanged:fire(mode)
end

return ClientState
