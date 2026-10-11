# Contributing to Sidebar Mini Player

Thanks for helping. Bug reports, "works with my integration" confirmations,
ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/Evski/ha-sidebar-mini-player/issues/new/choose)
using the bug template. The most useful details are:

- Home Assistant version and install type (HAOS, Container, …)
- Where you see it: browser and version, or companion app (iOS/Android) and version
- How the module is loaded (`extra_module_url` or dashboard resource) and the player version
  (`window.__sidebarMiniPlayerLoaded` in the browser console)
- The media player integration involved, and the entity's attributes from
  **Developer tools → States** (remove anything private)
- Console errors or warnings starting with `[sidebar-mini-player]`

## Development

The whole player is one plain JavaScript file, `ha-sidebar-mini-player.js`.
There's no build step and no runtime dependencies.

```bash
git clone https://github.com/Evski/ha-sidebar-mini-player.git
cd ha-sidebar-mini-player
npm install      # installs jsdom for the tests only
npm test         # syntax check + jsdom test suite (about a minute)
```

To try a change in a real Home Assistant instance, copy the file to
`/config/www/ha-sidebar-mini-player.js`, load it with
`frontend: extra_module_url: - /local/ha-sidebar-mini-player.js?v=dev1`, restart,
and bump `?v=` after each edit. If the HACS copy is also loaded, remove it while
testing: whichever copy loads first wins.

### Guidelines

- Keep it dependency-free and build-free. It must run directly in the browser.
- Comment the *why*, not just the *what*. The sidebar DOM is internal to Home
  Assistant and changes over time, so explain any selector you rely on.
- Never let an error escape the 1-second tick. The player must not break the sidebar.
- New behaviour should get a test in `test/test.js`. New options need a default in
  `DEFAULTS`, validation in `resolveConfig()`, a README table row and a test.
- Use only made-up entity ids and names in tests, fixtures and screenshots.
- Update `CHANGELOG.md` under **Unreleased**.

### Releasing (maintainers)

1. Move the **Unreleased** notes into a new version section in `CHANGELOG.md`.
2. Bump the version in `ha-sidebar-mini-player.js` (`VERSION`) and `package.json`,
   and the `?v=` examples in `README.md`. `npm test` checks these agree.
3. Commit, tag `vX.Y.Z` and push the tag. The release workflow runs the tests and
   publishes a GitHub release with the JS file attached, which HACS picks up.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
