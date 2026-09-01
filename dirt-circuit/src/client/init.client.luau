--!nonstrict
-- Client boot.
--
-- Explicit, ordered, and short. Nothing here does work: it wires controllers and gets out
-- of the way. Ordering matters (state before the controllers that read it), so it is a
-- sequence rather than a set of independent scripts racing each other at load — which is
-- how Stellar Dominion ended up with two remotes that were silently unreachable for a
-- release because the client waited in one place and the server created them in another.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)
local ClientState = require(script.ClientState)
local CameraController = require(script.Controllers.CameraController)
local VehicleController = require(script.Controllers.VehicleController)

-- Detail tier is resolved ONCE and defaults LOW. Every cosmetic system asks this before it
-- CREATES an effect, never merely before it shows one — the saving is in not constructing
-- the object. (LESSONS.md E-04.)
ClientState.detailTier = GameConfig.DefaultDetailTier

CameraController.start()
VehicleController.start()

print("[DirtCircuit] client ready")
