--!nonstrict
-- EconomyConfig — payouts, upgrade prices, trophy awards.
--
-- Cash is earned, never bought. Robux buys cosmetics only. That is a design decision with a
-- technical dividend: a cosmetic-only, non-random store means Roblox's paid-random-item
-- policy gate can never apply to us, and there is no pay-to-win surface to defend.
-- (LESSONS.md G-03.)

local VehicleConfig = require(script.Parent.VehicleConfig)

local EconomyConfig = {}

--------------------------------------------------------------------------------
-- Race payouts
--------------------------------------------------------------------------------

-- Cash by finishing position, 1st through 8th. The podium gap is the progression pressure:
-- 4th pays for roughly one cheap upgrade, 1st pays for a real one.
EconomyConfig.PositionCash = { 2400, 1500, 950, 600, 420, 320, 240, 180 }

-- Trophies by finishing position. Podium only, per the spec's progression condition.
EconomyConfig.PositionTrophies = { 5, 3, 1, 0, 0, 0, 0, 0 }

-- Scales the whole payout by the league you are racing in, so climbing is worth it.
EconomyConfig.LeagueCashMultiplier = { rookie = 1.0, clubman = 1.25, pro = 1.6, ironman = 2.1 }

EconomyConfig.CashBagValue = { min = 120, max = 400 }
EconomyConfig.FinishBonusPerLapLed = 60

--------------------------------------------------------------------------------
-- Upgrade prices
--
-- Geometric, and steep enough that you cannot buy the same ladder twice on your first
-- payday. Stellar Dominion found this exact shape by hand: raising the per-attribute cost
-- multiplier gates VERTICAL stacking in one stat while leaving HORIZONTAL breadth (the
-- first tier of several different stats) untouched, because tier-0 cost is base * mult^0.
-- Lowering starting money is the wrong lever — it blunts breadth too.
--------------------------------------------------------------------------------

EconomyConfig.UpgradeBasePrice = {
	tires = 900,
	shocks = 850,
	acceleration = 1000,
	topSpeed = 1150,
	nitro = 420,
}

EconomyConfig.UpgradePriceMultiplier = {
	tires = 1.85,
	shocks = 1.85,
	acceleration = 1.95,
	topSpeed = 2.05,
	nitro = 1.55,
}

EconomyConfig.StartingCash = 1200

-- Price of moving from `tier` to `tier + 1`.
function EconomyConfig.upgradePrice(ladder: string, tier: number): number?
	local base = EconomyConfig.UpgradeBasePrice[ladder]
	if not base then
		return nil
	end
	if tier >= VehicleConfig.Tiers then
		return nil -- already maxed
	end
	local mult = EconomyConfig.UpgradePriceMultiplier[ladder] or 1.8
	return math.floor(base * mult ^ tier + 0.5)
end

function EconomyConfig.positionCash(position: number, league: string?): number
	local base = EconomyConfig.PositionCash[math.clamp(position, 1, 8)] or 0
	local mult = EconomyConfig.LeagueCashMultiplier[league or "rookie"] or 1
	return math.floor(base * mult + 0.5)
end

function EconomyConfig.positionTrophies(position: number): number
	return EconomyConfig.PositionTrophies[math.clamp(position, 1, 8)] or 0
end

return EconomyConfig
