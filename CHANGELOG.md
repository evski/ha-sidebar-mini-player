# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `idle_as_paused` option (default `false`): a player that was playing or paused
  in this browser session and then goes `idle` (Sonos often skips `paused`) stays
  visible as paused and hides after `paused_timeout_minutes`.

## [1.0.0] - 2026-10-11

First public release. The player was developed and used day to day on a real
Home Assistant install before being made generic and open-sourced.

### Added

- Now-playing mini player docked at the bottom of the Home Assistant sidebar,
  just above Settings, on every page (not a dashboard card).
- Artwork, title, artist and speaker name; previous / play-pause / next;
  progress bar; volume slider and mute toggle (only when the player supports them).
- Zero-config auto-discovery of every `media_player` entity that is playing or
  paused, with optional `include` / `exclude` lists (`*` wildcards).
- Music Assistant de-duplication: a native player that mirrors an active Music
  Assistant player (same title or same name) is hidden.
- Several active players: a focused card plus slim collapsed cards above it,
  click to focus, hover to preview, "+N more" beyond a configurable cap.
- Collapsed (icons-only) sidebar: artwork with a play/pause overlay and a count badge.
- Optimistic play/pause: the button flips instantly and reverts after 8 s if
  the player never confirms.
- Paused players hide automatically after 5 minutes (configurable, or never).
- Swipe a card right to dismiss it until its state changes, with a dedicated
  touch path that works in the iOS companion app; a hover "x" for mouse users.
  Dismissals are remembered per browser (localStorage).
- Video apps without track metadata (for example Netflix on Apple TV) show the
  app name and a TV placeholder icon.
- Optional configuration via `window.sidebarMiniPlayerConfig`: `include`,
  `exclude`, `paused_timeout_minutes`, `position` (`bottom` / `top`),
  `accent_color`, `max_collapsed_cards`, `max_collapsed_cards_short_window`,
  `dedupe_music_assistant`, `swipe_to_dismiss`, `show_dismiss_button`,
  `show_volume`, `show_progress`, `remember_dismissed`. Changes apply live.
- Theme support through Home Assistant CSS variables, plus
  `--sidebar-mini-player-accent-color`, `--sidebar-mini-player-card-background`
  and `--sidebar-mini-player-border-radius`.
- Works when loaded with `frontend: extra_module_url` (every page) or as a
  dashboard resource; loading it twice is harmless.
- HACS packaging, jsdom test suite (`npm test`) and GitHub Actions for HACS
  validation, tests and releases.

[Unreleased]: https://github.com/Evski/ha-sidebar-mini-player/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Evski/ha-sidebar-mini-player/releases/tag/v1.0.0
