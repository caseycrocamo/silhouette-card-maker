"use strict";
const games = Object.freeze({
  mtg: {
    id: "mtg",
    name: "Magic: The Gathering",
    example: "1x Sol Ring (eoc) 57\n3x Lightning Bolt",
    help: "Enter card names. Quantity, set, and card number are optional.",
    defaultWorkflow: "double_sided",
    workflows: ["front_only", "double_sided"],
  },
  pokemon: {
    id: "pokemon",
    name: "Pokémon",
    example:
      "Pokémon: 4\n1 Pikachu ex SVI 047\n3 Charcadet SSP 32\n\nTrainer: 3\n3 Nest Ball SVI 181",
    help: "Limitless format: quantity, card name, set, and card number.",
    defaultWorkflow: "front_only",
    workflows: ["front_only"],
  },
});
function getGame(id) {
  if (!Object.hasOwn(games, id))
    throw new Error("Unknown game. Choose a game from Home.");
  return games[id];
}
module.exports = { games, getGame };
