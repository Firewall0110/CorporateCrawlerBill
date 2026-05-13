const Unit = require('./Unit');

/**
 * Player Class - Extends Unit with player-specific logic
 * Players have character attributes that modify the entire game state
 */

class Player extends Unit {
  constructor(socketId, name, color, characterAttributes = []) {
    // Base stats for players
    const playerBaseStats = {
      maxHealth: 100,
      attack: 10,
      attackSpeed: 1.0,
      armor: 5,
      attackRange: 60,
      movementSpeed: 1.0
    };

    super(socketId, name, playerBaseStats, { x: 100, y: 350 });

    this.team = 'players';
    this.color = color;

    // Character attributes this player brings to the game
    // Each attribute is { name, description, modifier: { target, value, appliesToTeam } }
    this.attributes = characterAttributes;

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
      attributes: this.attributes.map(attr => ({
        name: attr.name,
        description: attr.description
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
