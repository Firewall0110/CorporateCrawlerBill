/**
 * Character Attributes - Permanent modifiers that players bring to the game
 * Each attribute affects game state while the player is active
 */

const ATTRIBUTES = {
  // Damage boost
  EFFECTIVE_COMMUNICATOR: {
    name: 'Effective Communicator',
    description: 'Boosts team attack by +20%',
    modifier: {
      target: 'attack',
      value: 1.2,
      appliesToTeam: 'all' // Applies to all units
    }
  },

  // Enemy debuff
  CRYSTAL_CLARITY_IV: {
    name: 'Crystal Clarity IV',
    description: 'Reduces enemy effective health by -40%',
    modifier: {
      target: 'maxHealth',
      value: 0.6,
      appliesToTeam: 'enemies'
    }
  },

  // Attack speed buff
  HARD_DRIVE: {
    name: 'Hard Drive',
    description: 'Increases team attack speed by +10%',
    modifier: {
      target: 'attackSpeed',
      value: 1.1,
      appliesToTeam: 'all'
    }
  },

  // Defense buff
  SYSTEMATIC_THINKER: {
    name: 'Systematic Thinker',
    description: 'Reduces party incoming damage by -25% armor',
    modifier: {
      target: 'armor',
      value: 25,
      appliesToTeam: 'players'
    }
  },

  // Enemy movement debuff
  QUALITY_ASSURANCE: {
    name: 'Quality Assurance',
    description: 'Slows enemies by -30% movement speed',
    modifier: {
      target: 'movementSpeed',
      value: 0.7,
      appliesToTeam: 'enemies'
    }
  },

  // Player movement boost
  AGILE_DEVELOPMENT: {
    name: 'Agile Development',
    description: 'Increases team movement speed by +25%',
    modifier: {
      target: 'movementSpeed',
      value: 1.25,
      appliesToTeam: 'players'
    }
  },

  // Enemy attack reduction
  NETWORK_SECURITY: {
    name: 'Network Security',
    description: 'Reduces enemy attack by -30%',
    modifier: {
      target: 'attack',
      value: 0.7,
      appliesToTeam: 'enemies'
    }
  },

  // Range increase
  ARCHITECT: {
    name: 'Architect',
    description: 'Increases team attack range by +40%',
    modifier: {
      target: 'attackRange',
      value: 1.4,
      appliesToTeam: 'players'
    }
  }
};

/**
 * Get a random attribute for a player
 */
function getRandomAttribute() {
  const keys = Object.keys(ATTRIBUTES);
  const randomKey = keys[Math.floor(Math.random() * keys.length)];
  return ATTRIBUTES[randomKey];
}

/**
 * Get attributes by name
 */
function getAttributeByName(name) {
  const keys = Object.keys(ATTRIBUTES);
  const key = keys.find(k => ATTRIBUTES[k].name === name);
  return key ? ATTRIBUTES[key] : null;
}

/**
 * Get all available attributes
 */
function getAllAttributes() {
  return Object.values(ATTRIBUTES);
}

module.exports = {
  ATTRIBUTES,
  getRandomAttribute,
  getAttributeByName,
  getAllAttributes
};
