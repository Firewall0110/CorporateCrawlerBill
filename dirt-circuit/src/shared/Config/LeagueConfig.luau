--!nonstrict
-- LeagueConfig — lifetime trophies place a player in a league.
--
-- Leagues do two jobs: they seed the grid with comparable opponents, and they scale bot
-- skill so a Rookie race and an Ironman race feel different without the bots ever getting
-- handling a player cannot buy.

local LeagueConfig = {}

-- Ordered lowest to highest. `minTrophies` is the lifetime total to enter.
LeagueConfig.Leagues = {
	{ id = "rookie", label = "Rookie Class", minTrophies = 0, botSkill = { 0.15, 0.40 } },
	{ id = "clubman", label = "Clubman Class", minTrophies = 60, botSkill = { 0.35, 0.62 } },
	{ id = "pro", label = "Pro Class", minTrophies = 260, botSkill = { 0.55, 0.82 } },
	{ id = "ironman", label = "Ironman Class", minTrophies = 800, botSkill = { 0.75, 1.00 } },
}

LeagueConfig.Ids = { "rookie", "clubman", "pro", "ironman" }

function LeagueConfig.forTrophies(trophies: number)
	local best = LeagueConfig.Leagues[1]
	for _, league in LeagueConfig.Leagues do
		if trophies >= league.minTrophies then
			best = league
		end
	end
	return best
end

-- Next league up, or nil at the top. Used for the "N trophies to promotion" HUD line.
function LeagueConfig.next(id: string)
	for i, league in LeagueConfig.Leagues do
		if league.id == id then
			return LeagueConfig.Leagues[i + 1]
		end
	end
	return nil
end

return LeagueConfig
