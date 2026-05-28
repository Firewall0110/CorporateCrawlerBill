/**
 * Character Attributes - Permanent modifiers players accumulate during a run.
 *
 * Each attribute has 7 rarity tiers (common -> celestial). When offered to a
 * player, an attribute is rolled with a tier weighted by RARITY_WEIGHTS.
 * The picker UI shows three rolled choices and the player selects one.
 * Selected attributes stack: pick Synergize twice, both modifiers apply
 * (e.g. attack x1.10 x2.20 = x2.42 if you got a common then a mythic).
 *
 * Player gets a choice on game start AND at the start of every stage.
 */

// =====  Rarity tiers, weights, and colors =====

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'celestial'];

// Roll weights (sum to 100). Common is most likely, celestial barely ever.
const RARITY_WEIGHTS = {
  common:    40,
  uncommon:  25,
  rare:      15,
  epic:      10,
  legendary:  6,
  mythic:     3,
  celestial:  1
};

// Visible color codes for the picker cards. White / green / blue / purple /
// orange / red / light-blue is a common WoW-style rarity gradient with
// celestial as light-cyan to feel "godly".
const TIER_COLORS = {
  common:    '#ffffff',
  uncommon:  '#22dd55',
  rare:      '#3399ff',
  epic:      '#bb55ff',
  legendary: '#ff9933',
  mythic:    '#ff3333',
  celestial: '#88ddff'
};

// Pretty labels for the UI
const TIER_LABELS = {
  common:    'COMMON',
  uncommon:  'UNCOMMON',
  rare:      'RARE',
  epic:      'EPIC',
  legendary: 'LEGENDARY',
  mythic:    'MYTHIC',
  celestial: 'CELESTIAL'
};

// ===== Tier-value tables for each stat-kind =====
//
// Most attributes fall into one of a few common scaling shapes; rather than
// hand-write 7 numbers per attribute, attributes reference a shape and we
// look up the value. This keeps the 28 attribute definitions short and
// guarantees consistent power-curves across attributes of the same kind.

// Player buff (multiplicative >1). Celestial is comically broken (4x = +300%).
const TIER_BUFF_MULT = {
  common:    1.10,  // +10%
  uncommon:  1.20,  // +20%
  rare:      1.35,  // +35%
  epic:      1.55,  // +55%
  legendary: 1.80,  // +80%
  mythic:    2.20,  // +120%
  celestial: 4.00   // +300% (hilariously broken)
};

// Player MOVE-speed buff. Movement at the standard +300% celestial was
// uncontrollable - Bill skidded across the screen too fast to react to
// boss telegraphs. Each tier's BONUS is 30% of the standard buff, with
// celestial fixed at +100% (still strong, still landable).
// Tier      | std bonus | move bonus  | move multiplier
// common    | +10%      | +3%         | 1.03
// uncommon  | +20%      | +6%         | 1.06
// rare      | +35%      | +10.5%      | 1.105
// epic      | +55%      | +16.5%      | 1.165
// legendary | +80%      | +24%        | 1.24
// mythic    | +120%     | +36%        | 1.36
// celestial | (special) | +100%       | 2.00
const TIER_MOVE_BUFF_MULT = {
  common:    1.03,
  uncommon:  1.06,
  rare:      1.105,
  epic:      1.165,
  legendary: 1.24,
  mythic:    1.36,
  celestial: 2.00
};

// Enemy debuff (multiplicative <1). Celestial reduces to 2% of original.
const TIER_DEBUFF_MULT = {
  common:    0.90,  // -10%
  uncommon:  0.80,  // -20%
  rare:      0.65,  // -35%
  epic:      0.45,  // -55%
  legendary: 0.20,  // -80%
  mythic:    0.10,  // -90%
  celestial: 0.02   // -98% (hilariously broken)
};

// Armor (additive flat). Celestial >100 means ~1 dmg per hit (Math.max(1,...))
const TIER_ARMOR_FLAT = {
  common:     5,
  uncommon:  10,
  rare:      20,
  epic:      35,
  legendary: 50,
  mythic:    75,
  celestial: 110
};

// Enemy armor reduction (additive negative). Goes <-100 to multiply dmg taken.
const TIER_ARMOR_REDUCTION = {
  common:    -5,
  uncommon:  -10,
  rare:      -20,
  epic:      -35,
  legendary: -50,
  mythic:    -75,
  celestial: -110   // enemies take ~2.1x damage
};

// Helper: format a multiplicative buff as "+NN% description"
const fmtBuff = (label) => (tier, v) => `+${Math.round((v - 1) * 100)}% ${label}`;
// Helper: format a multiplicative debuff as "-NN% description"
const fmtDebuff = (label) => (tier, v) => `-${Math.round((1 - v) * 100)}% ${label}`;
// Helper: format additive armor as "+NN description"
const fmtFlatPlus = (label) => (tier, v) => `+${v} ${label}`;
const fmtFlatMinus = (label) => (tier, v) => `${v} ${label}`; // negative-signed already

// ===== Attribute definitions =====
//
// shape:
//   { name, theme, target, appliesToTeam, scale, format }
// scale references a TIER_* table; format() returns the description string
// for a given (tier, value) pair, used by the picker UI.

const ATTRIBUTES = {
  // --- Original 8 (re-expressed in new tier system) ---
  EFFECTIVE_COMMUNICATOR: {
    name: 'Effective Communicator',
    // 'players' not 'all' - "team" in the description means the PLAYER team.
    // 'all' was silently buffing mook attack too, which at celestial gave
    // enemies +300% damage (4x harder hits). Same anti-buff bug across all
    // six previously-'all' attributes - all fixed in this commit.
    target: 'attack', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('team attack')
  },
  CRYSTAL_CLARITY_IV: {
    name: 'Crystal Clarity IV',
    target: 'maxHealth', appliesToTeam: 'enemies',
    scale: TIER_DEBUFF_MULT, format: fmtDebuff('enemy max health')
  },
  HARD_DRIVE: {
    name: 'Hard Drive',
    target: 'attackSpeed', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('team attack speed')
  },
  SYSTEMATIC_THINKER: {
    name: 'Systematic Thinker',
    target: 'armor', appliesToTeam: 'players',
    scale: TIER_ARMOR_FLAT, format: fmtFlatPlus('armor')
  },
  QUALITY_ASSURANCE: {
    name: 'Quality Assurance',
    target: 'movementSpeed', appliesToTeam: 'enemies',
    scale: TIER_DEBUFF_MULT, format: fmtDebuff('enemy move speed')
  },
  AGILE_DEVELOPMENT: {
    name: 'Agile Development',
    target: 'movementSpeed', appliesToTeam: 'players',
    scale: TIER_MOVE_BUFF_MULT, format: fmtBuff('move speed')
  },
  NETWORK_SECURITY: {
    name: 'Network Security',
    target: 'attack', appliesToTeam: 'enemies',
    scale: TIER_DEBUFF_MULT, format: fmtDebuff('enemy attack')
  },
  ARCHITECT: {
    name: 'Architect',
    target: 'attackRange', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('attack range')
  },

  // --- 20 NEW corporate-jargon attributes ---
  SYNERGIZE: {
    name: 'Synergize',
    target: 'attack', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('team attack')
  },
  PIVOT_STRATEGY: {
    name: 'Pivot Strategy',
    target: 'movementSpeed', appliesToTeam: 'players',
    scale: TIER_MOVE_BUFF_MULT, format: fmtBuff('move speed')
  },
  BANDWIDTH_OPTIMIZATION: {
    name: 'Bandwidth Optimization',
    target: 'attackSpeed', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('attack speed')
  },
  SCALE_OPERATIONS: {
    name: 'Scale Operations',
    target: 'maxHealth', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('max health')
  },
  LONG_TAIL_STRATEGY: {
    name: 'Long-Tail Strategy',
    target: 'attackRange', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('attack range')
  },
  RISK_MITIGATION: {
    name: 'Risk Mitigation',
    target: 'armor', appliesToTeam: 'players',
    scale: TIER_ARMOR_FLAT, format: fmtFlatPlus('armor')
  },
  STREAMLINE_WORKFLOW: {
    name: 'Streamline Workflow',
    target: 'attack', appliesToTeam: 'enemies',
    scale: TIER_DEBUFF_MULT, format: fmtDebuff('enemy attack')
  },
  COST_REDUCTION: {
    name: 'Cost Reduction',
    target: 'maxHealth', appliesToTeam: 'enemies',
    scale: TIER_DEBUFF_MULT, format: fmtDebuff('enemy max health')
  },
  MOVE_THE_NEEDLE: {
    name: 'Move the Needle',
    target: 'attack', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('attack')
  },
  DEEP_DIVE: {
    name: 'Deep Dive',
    target: 'armor', appliesToTeam: 'enemies',
    scale: TIER_ARMOR_REDUCTION, format: fmtFlatMinus('enemy armor')
  },
  CIRCLE_BACK: {
    name: 'Circle Back',
    target: 'maxHealth', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('max health')
  },
  TOUCH_BASE: {
    name: 'Touch Base',
    target: 'attackSpeed', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('team attack speed')
  },
  QUARTERLY_EARNINGS: {
    name: 'Quarterly Earnings',
    target: 'maxHealth', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('max health')
  },
  DRILL_DOWN: {
    name: 'Drill Down',
    target: 'armor', appliesToTeam: 'enemies',
    scale: TIER_ARMOR_REDUCTION, format: fmtFlatMinus('enemy armor')
  },
  ACTION_ITEMS: {
    name: 'Action Items',
    target: 'attackSpeed', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('attack speed')
  },
  BOIL_THE_OCEAN: {
    name: 'Boil the Ocean',
    target: 'attackRange', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('attack range')
  },
  REORGANIZATION: {
    name: 'Reorganization',
    target: 'movementSpeed', appliesToTeam: 'enemies',
    scale: TIER_DEBUFF_MULT, format: fmtDebuff('enemy move speed')
  },
  DISRUPTIVE_INNOVATION: {
    name: 'Disruptive Innovation',
    target: 'attack', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('attack')
  },
  STAKEHOLDER_BUY_IN: {
    name: 'Stakeholder Buy-In',
    target: 'attackSpeed', appliesToTeam: 'players',
    scale: TIER_BUFF_MULT, format: fmtBuff('team attack speed')
  },
  GOING_FORWARD: {
    name: 'Going Forward',
    target: 'movementSpeed', appliesToTeam: 'players',
    scale: TIER_MOVE_BUFF_MULT, format: fmtBuff('team move speed')
  }
};

// ===== Rolling / instantiation =====

/**
 * Roll a single tier with optional `luck` modifier (0-99).
 *
 * Mechanism:
 *   1. Roll a 1-100 integer.
 *   2. Subtract `luck` and floor at 1 -> "adjusted roll".
 *   3. Map adjusted roll to a tier using RARITY_WEIGHTS as cumulative
 *      thresholds, ordered RAREST FIRST. So adjusted roll 1 = celestial,
 *      2-4 = mythic, 5-10 = legendary, 11-20 = epic, 21-35 = rare,
 *      36-60 = uncommon, 61-100 = common.
 *
 * Luck curve (set by Leaderboard.computeLuck):
 *   luck = min(99, floor(ticketsLifetime / 10))
 *   - 0 tickets  -> luck 0  -> base 1% celestial
 *   - 100 tickets -> luck 10 -> 11% celestial chance
 *   - 500 tickets -> luck 50 -> 51% celestial
 *   - 990 tickets -> luck 99 -> 100% celestial (the cap)
 *
 * Edge cases:
 *   - luck 99 + max roll 100 = 1 (always celestial).
 *   - luck 0 + any roll matches the base distribution exactly.
 */
const RARITIES_RAREST_FIRST = ['celestial', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
function rollTier(luck = 0) {
  const clampedLuck = Math.min(99, Math.max(0, Math.floor(luck) || 0));
  const rawRoll = Math.floor(Math.random() * 100) + 1;        // 1-100
  const adjustedRoll = Math.max(1, rawRoll - clampedLuck);    // shift toward celestial
  let cumulative = 0;
  for (const tier of RARITIES_RAREST_FIRST) {
    cumulative += RARITY_WEIGHTS[tier];
    if (adjustedRoll <= cumulative) return tier;
  }
  return 'common'; // unreachable; safety
}

/**
 * Roll a single (key, tier) pair with luck.
 */
function rollOneChoice(luck = 0) {
  const keys = Object.keys(ATTRIBUTES);
  const key = keys[Math.floor(Math.random() * keys.length)];
  const tier = rollTier(luck);
  return { key, tier };
}

/**
 * Roll `count` distinct (key, tier) pairs. Distinct by attribute KEY so the
 * picker never offers the same attribute twice in one screen; tiers can
 * repeat across slots. `luck` is passed through to each tier roll.
 */
function rollAttributeChoices(count = 3, luck = 0) {
  const keys = Object.keys(ATTRIBUTES);
  const picked = new Set();
  const choices = [];
  const limit = Math.min(count, keys.length);
  let safety = 0;
  while (choices.length < limit && safety < 200) {
    safety++;
    const { key, tier } = rollOneChoice(luck);
    if (picked.has(key)) continue;
    picked.add(key);
    choices.push(buildOfferedChoice(key, tier));
  }
  return choices;
}

/**
 * Build a serializable description of an offered choice for the client
 * picker UI. Includes everything the modal needs (name, formatted effect
 * text, tier label, tier color) so the client doesn't need its own copy of
 * the attribute tables.
 */
function buildOfferedChoice(key, tier) {
  const tpl = ATTRIBUTES[key];
  if (!tpl) return null;
  const value = tpl.scale[tier];
  return {
    key,
    tier,
    tierLabel: TIER_LABELS[tier],
    tierColor: TIER_COLORS[tier],
    name: tpl.name,
    effect: tpl.format(tier, value)
  };
}

/**
 * Materialize an attribute INSTANCE the player can store in player.attributes.
 * This is what gets pushed into player.attributes when they pick a choice.
 * Includes the modifier the recompute engine reads, plus the metadata the
 * HUD uses to color the entry in the "YOUR ATTRIBUTES:" panel.
 */
function instantiateAttribute(key, tier) {
  const tpl = ATTRIBUTES[key];
  if (!tpl) return null;
  const value = tpl.scale[tier];
  return {
    key,
    name: tpl.name,
    tier,
    tierLabel: TIER_LABELS[tier],
    tierColor: TIER_COLORS[tier],
    description: tpl.format(tier, value),
    modifier: {
      target: tpl.target,
      value,
      appliesToTeam: tpl.appliesToTeam
    }
  };
}

// ===== Back-compat exports =====
// These are referenced in older code paths (e.g. legacy auto-assign on player
// join). Kept so nothing breaks if we miss an import update.

function getRandomAttribute() {
  const choice = rollOneChoice();
  return instantiateAttribute(choice.key, choice.tier);
}

function getAttributeByName(name) {
  const key = Object.keys(ATTRIBUTES).find(k => ATTRIBUTES[k].name === name);
  return key ? instantiateAttribute(key, 'common') : null;
}

function getAllAttributes() {
  return Object.entries(ATTRIBUTES).map(([key, tpl]) => ({
    key, name: tpl.name, target: tpl.target, appliesToTeam: tpl.appliesToTeam
  }));
}

module.exports = {
  ATTRIBUTES,
  RARITIES,
  RARITY_WEIGHTS,
  TIER_COLORS,
  TIER_LABELS,
  rollAttributeChoices,
  instantiateAttribute,
  buildOfferedChoice,
  // back-compat
  getRandomAttribute,
  getAttributeByName,
  getAllAttributes
};
