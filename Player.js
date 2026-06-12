const Unit = require('./Unit');

/**
 * Player Class - Extends Unit with player-specific logic
 * Players have character attributes that modify the entire game state
 */

class Player extends Unit {
  constructor(socketId, name, color, characterAttributes = [], opts = {}) {
    // Base stats for players
    const playerBaseStats = {
      maxHealth: 200,  // Reduced from 500 after playtest feedback - runs felt too forgiving
      attack: 20,        // Reduced from 100 - punch does 20 damage (5 hits to kill)
      attackSpeed: 1.2,
      armor: 25,
      attackRange: 80,
      movementSpeed: 1.5
    };

    super(socketId, name, playerBaseStats, { x: 100, y: 350 });

    this.team = 'players';
    this.color = color;

    // Character attributes this player brings to the game
    // Each attribute is { name, description, modifier: { target, value, appliesToTeam } }
    this.attributes = characterAttributes;

    // Persistent-leaderboard plumbing
    //   luck:         tier-roll bonus (0-99), set once at room-join from the
    //                 player's lifetime ticket count. Passed to
    //                 rollAttributeChoices() so the pick screen reflects it.
    //   sessionStats: kills accumulated during THIS run. Submitted to the
    //                 leaderboard DB on game end (boss death or disconnect).
    //   _dbSubmitted: guards against double-submitting the same session.
    this.luck = Math.max(0, Math.min(99, Math.floor(opts.luck || 0)));
    this.sessionStats = {
      ticketsKilled: 0,
      bossesDefeated: 0,
      crawlsCompleted: 0
    };
    this._dbSubmitted = false;

    // Input state
    this.currentInput = {
      left: false,
      right: false,
      jump: false
    };
  }

  /**
   * Get player state for broadcasting
   */
  getState() {
    const baseState = super.getState();
    return {
      ...baseState,
      // Include tier metadata so the HUD can color each entry by rarity.
      // Also include the raw modifier so clients can aggregate teammates'
      // buffs into net team totals (top-right "ALLY BUFFS" panel).
      attributes: this.attributes.map(attr => ({
        key: attr.key,
        name: attr.name,
        description: attr.description,
        tier: attr.tier,
        tierLabel: attr.tierLabel,
        tierColor: attr.tierColor,
        modifier: attr.modifier,
        // Sacrificed to MOH after a knockout - disabled (no benefit), shown
        // struck-through in the HUD and excluded from ally-buff totals.
        sacrificed: !!attr.sacrificed
      }))
    };
  }

  /**
   * Get summary of player's attributes for display
   */
  getAttributesSummary() {
    return this.attributes.map(attr => ({
      name: attr.name,
      effect: attr.description
    }));
  }
}

module.exports = Player;
