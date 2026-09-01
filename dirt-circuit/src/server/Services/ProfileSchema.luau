--!nonstrict
-- ProfileSchema — ★ the ONE table you edit to add a persisted field.
--
-- This file is the whole point of `Shared.Util.Schema`, and it is the direct answer to the
-- most reliably recurring bug in the Stellar Dominion post-mortem. (LESSONS.md B-01.)
--
-- There, adding one persisted player field meant FOUR hand-maintained edits in four places
-- inside a 235,000-character DataService: the default table, the migration/normalise pass,
-- the `SetAsync` payload, and the load block. Miss any one and the field silently does not
-- persist. `bestNight` shipped with two of the four and reset on every rejoin; the bug was
-- only ever found by reading the raw DataStore blob by hand. Preferences were worse — they
-- needed three MORE lists in three MORE files, and two separate settings shipped broken in
-- exactly that way, found weeks apart by two different people.
--
-- HOW TO ADD A FIELD HERE: add one line below. That is the entire procedure.
--   * its default is the value you pass
--   * an older saved blob that lacks the key migrates to that default on load
--   * it is validated, range-clamped and NaN-rejected on both load and save
--   * it is included in the save payload automatically
--   * removing the line retires the field and drops it from future saves
--
-- HOW TO RETIRE A FIELD: delete its line. Old blobs keep the key harmlessly until their
-- next save, which drops it.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Schema = require(ReplicatedStorage.Shared.Util.Schema)
local EconomyConfig = require(ReplicatedStorage.Shared.Config.EconomyConfig)
local VehicleConfig = require(ReplicatedStorage.Shared.Config.VehicleConfig)
local LeagueConfig = require(ReplicatedStorage.Shared.Config.LeagueConfig)

local TIERS = VehicleConfig.Tiers

local ProfileSchema = {}

ProfileSchema.STORE_NAME = "DirtCircuit_Profile_v1"
ProfileSchema.KEY_PREFIX = "player_"

ProfileSchema.fields = Schema.build({
	--------------------------------------------------------------------------------
	-- Wallet
	--------------------------------------------------------------------------------
	cash = Schema.int(EconomyConfig.StartingCash, 0, 1e9),
	lifetimeCash = Schema.int(0, 0, 1e9),

	--------------------------------------------------------------------------------
	-- Trophies & league
	--------------------------------------------------------------------------------
	trophies = Schema.int(0, 0, 1e7),
	league = Schema.enum("rookie", LeagueConfig.Ids),
	bestFinish = Schema.int(0, 0, 8),

	--------------------------------------------------------------------------------
	-- Truck upgrades. One entry per ladder in VehicleConfig.UpgradeOrder.
	--------------------------------------------------------------------------------
	upTires = Schema.int(0, 0, TIERS),
	upShocks = Schema.int(0, 0, TIERS),
	upAcceleration = Schema.int(0, 0, TIERS),
	upTopSpeed = Schema.int(0, 0, TIERS),
	upNitro = Schema.int(0, 0, TIERS),

	--------------------------------------------------------------------------------
	-- Career stats (feed the profile card and the podium screen)
	--------------------------------------------------------------------------------
	racesEntered = Schema.int(0, 0, 1e7),
	racesWon = Schema.int(0, 0, 1e7),
	podiums = Schema.int(0, 0, 1e7),
	lapsLed = Schema.int(0, 0, 1e8),
	-- Best lap per track id. A map, so thirty tracks is one field, not thirty.
	bestLaps = Schema.map(Schema.number(0, 0, 3600), 128),

	--------------------------------------------------------------------------------
	-- Cosmetics (the entire monetization surface)
	--------------------------------------------------------------------------------
	ownedSkins = Schema.map(Schema.bool(false), 256),
	ownedHorns = Schema.map(Schema.bool(false), 128),
	equippedSkin = Schema.str("stock", 48),
	equippedHorn = Schema.str("none", 48),
	dustTint = Schema.str("default", 48),

	--------------------------------------------------------------------------------
	-- Preferences
	--
	-- Note there is no second list anywhere. On Stellar Dominion a preference needed
	-- entries in the client attribute list, the server accept-list AND the schema, and the
	-- schema was the one everybody forgot — `coercePref` silently rejected any key it did
	-- not know, so the setting worked all session and reset on rejoin.
	--------------------------------------------------------------------------------
	prefDetailTier = Schema.int(0, 0, 4), -- 0 = auto-detect
	prefUiScale = Schema.number(1, 1, 2),
	prefSteerMode = Schema.enum("wheel", { "wheel", "tilt", "buttons" }),
	prefMusicOff = Schema.bool(false),
	prefSfxVolume = Schema.number(0.8, 0, 1),
	-- Explicitly distinguishes "player picked this" from "a default was written at load".
	-- Stellar Dominion's skybox chooser never appeared for ANY player, ever, because a
	-- load-time write made the first-run gate false before onboarding could run. (B-05)
	prefsEverChosen = Schema.bool(false),

	--------------------------------------------------------------------------------
	-- Monetization bookkeeping
	--------------------------------------------------------------------------------
	-- Receipt id ring for purchase dedup (LESSONS.md G-01).
	processedReceipts = Schema.list(Schema.str("", 64), 100),

	--------------------------------------------------------------------------------
	-- Metadata
	--
	-- Epoch SECONDS, never an ISO string. Stellar Dominion re-parsed an
	-- already-parsed datetime, re-stringified it in local format, then applied a second
	-- UTC conversion, and stored a watermark FIVE HOURS IN THE FUTURE that would have
	-- silently swallowed every subsequent event while logging success. (LESSONS.md J-02)
	--------------------------------------------------------------------------------
	firstSeen = Schema.int(0, 0, 4e9),
	lastSeen = Schema.int(0, 0, 4e9),
	schemaVersion = Schema.int(1, 1, 1000),
})

-- Maps the flat `up*` fields onto the tier table `VehicleConfig.resolve` expects.
-- One place that knows the naming, so a renamed ladder breaks here loudly rather than
-- silently resolving to tier 0 everywhere.
function ProfileSchema.upgradeTiers(profile)
	return {
		tires = profile.upTires,
		shocks = profile.upShocks,
		acceleration = profile.upAcceleration,
		topSpeed = profile.upTopSpeed,
		nitro = profile.upNitro,
	}
end

ProfileSchema.LADDER_FIELD = {
	tires = "upTires",
	shocks = "upShocks",
	acceleration = "upAcceleration",
	topSpeed = "upTopSpeed",
	nitro = "upNitro",
}

return ProfileSchema
