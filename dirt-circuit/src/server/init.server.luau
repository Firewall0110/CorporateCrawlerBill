--!nonstrict
-- Server boot.
--
-- ORDER IS LOAD-BEARING and is therefore a sequence in one file, not a folder of scripts
-- that happen to run. Stellar Dominion's PolicyService carried a comment saying it had to
-- be required "early in MainGame, right after Analytics, so PlayerAdded classifies everyone
-- before they reach the store" — an ordering constraint expressed as a comment inside the
-- thing being ordered. Here the constraint is the code.
--
--   1. Remotes      — created before any client can WaitForChild them
--   2. DataService  — nothing may read a profile before this
--   3. LiveConfig   — kill-switches must exist before the features they gate
--   4. PolicyService— must classify a player before they can reach a store surface
--   5. Analytics / ErrorReporter — instrumentation, wired early so it sees boot itself
--   6. Gameplay services

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Remotes = require(ReplicatedStorage.Shared.Net.Remotes)

local DataService = require(script.Services.DataService)
local RaceService = require(script.Services.RaceService)

Remotes.init()
DataService.start()
RaceService.start()

-- Build number on screen, in week one rather than at launch. `game.PlaceVersion` turns
-- "it's broken" into "it's broken ON BUILD 3109" and ends an entire class of
-- build-confusion. It reads stale in Studio Edit, which is precisely the point: the number
-- is only meaningful in the published game, which is where players actually are.
-- (LESSONS.md F-12.)
ReplicatedStorage:SetAttribute("BuildVersion", game.PlaceVersion)

print(string.format("[DirtCircuit] server ready — build %d", game.PlaceVersion))
