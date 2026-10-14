// Optional configuration for Sidebar Mini Player (ha-sidebar-mini-player).
//
// 1. Copy this file to /config/www/sidebar-mini-player-config.js
// 2. Add it to configuration.yaml next to the player itself:
//
//      frontend:
//        extra_module_url:
//          - /hacsfiles/ha-sidebar-mini-player/ha-sidebar-mini-player.js?v=1.0.0
//          - /local/sidebar-mini-player-config.js?v=1
//
// 3. Restart Home Assistant once. Later edits only need a browser refresh
//    (bump ?v=1 -> ?v=2 so the app and browsers don't keep a cached copy).
//
// Load order does not matter: the player re-reads this object every second.
// Delete any line you don't need - every option has a sensible default.
window.sidebarMiniPlayerConfig = {
  // Only show these players (entity ids, '*' wildcards). [] = every media_player.
  include: [],
  // Never show these. Browser Mod creates a media_player per browser tab:
  exclude: ["media_player.browser_mod_*"],
  // Hide a player after it has been paused this long (minutes). 0 = never.
  paused_timeout_minutes: 5,
  // Players that go playing -> "idle" (never "paused"), e.g. some Sonos: keep them
  // visible as paused until paused_timeout_minutes has passed.
  idle_as_paused: false,
  // "bottom" = just above Settings, "top" = just below the sidebar header.
  position: "bottom",
  // Any CSS colour. "" = your theme's primary colour.
  accent_color: "",
  // Collapsed cards shown above the focused one before "+N more".
  max_collapsed_cards: 4,
  max_collapsed_cards_short_window: 2,
  // Hide a native player that mirrors an active Music Assistant player.
  dedupe_music_assistant: true,
  // Gestures and controls.
  swipe_to_dismiss: true,
  show_dismiss_button: true,
  show_volume: true,
  show_progress: true,
  // Shuffle (left of previous) / repeat (right of next) buttons, if the player supports them.
  show_shuffle: false,
  show_repeat: false,
  // Remember swipe dismissals across reloads (per browser / device).
  remember_dismissed: true,
};
