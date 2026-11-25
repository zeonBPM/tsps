"use strict";

/**
 * Developers start immortal by design; ::mortal opts into damage and item loss for the session.
 * This applies that same opt-in at login, so a developer account can play mortal while keeping
 * its full rank and permissions. Session-only: ::mortal still toggles it either way.
 */
const MORTAL_DEVELOPER_ATTRIBUTE = "dev:mortal";
const MORTAL_BY_DEFAULT_CONFIG = "DeveloperDefaults:mortal";

function startMortal(api, { player }) {
  if (player?.getRights?.() !== api.core.PlayerRights.DEVELOPER) return;
  if (api.getPluginConfig(MORTAL_BY_DEFAULT_CONFIG, false) !== true) return;
  player.setAttribute(MORTAL_DEVELOPER_ATTRIBUTE, true);
}

module.exports = {
  name: "DeveloperDefaults",
  description: "Optionally start developer accounts mortal (taking damage and losing items) on login.",
  config: {
    [MORTAL_BY_DEFAULT_CONFIG]: {
      type: "boolean",
      label: "Developers start mortal",
      defaultText: "Off (developers start invincible)",
      help: "Sets ::mortal at login for DEVELOPER accounts, without changing their rank or permissions. ::mortal still toggles it during the session.",
    },
  },
  register(api) {
    api.onPlayerLogin(startMortal.bind(null, api));
  },
};
