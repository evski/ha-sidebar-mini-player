/*
 * ============================================================================
 *  Sidebar Mini Player for Home Assistant  (ha-sidebar-mini-player.js)
 *  https://github.com/Evski/ha-sidebar-mini-player
 * ============================================================================
 *
 *  A compact "now playing" media player docked at the bottom of Home
 *  Assistant's main left sidebar - visible on EVERY page (dashboards, settings,
 *  history...), not just inside one dashboard card.
 *
 *  Built by Grok Bot (Homeassistant Expert), conducted by Evan.
 *  MIT License - see LICENSE. Vanilla JS, no dependencies, no build step.
 *
 * WHAT IT DOES
 *   - Shows artwork, title, artist and speaker name with previous /
 *     play-pause / next, a progress bar, a volume slider and a mute toggle
 *     (volume controls only when the player supports them).
 *   - Auto-detects every media_player.* entity that is "playing" or "paused"
 *     (optional include / exclude lists). Music Assistant players that
 *     duplicate a native player are hidden (see dedupe()).
 *   - Several active players: the FOCUSED card sits at the bottom (nearest
 *     Settings) and every other player gets a slim collapsed card above it
 *     (click to focus, hover to preview, "+N more" beyond the cap).
 *   - Collapsed (icons-only) sidebar: artwork with a play/pause overlay and a
 *     count badge when more than one player is active.
 *   - Paused players drop out after `paused_timeout_minutes` (default 5).
 *   - Swipe a card to the RIGHT (touch or mouse; iOS companion app safe) or
 *     click the hover "x" to dismiss a player until its state changes.
 *   - Play/pause flips instantly (optimistic UI) and reverts after 8 s if the
 *     player never confirms.
 *   - Clicking the artwork or text opens Home Assistant's more-info dialog.
 *   - Follows your theme (CSS variables, light and dark).
 *
 * INSTALL (full details in README.md)
 *   Recommended - load on every page:
 *     frontend:
 *       extra_module_url:
 *         - /hacsfiles/ha-sidebar-mini-player/ha-sidebar-mini-player.js?v=1.1.0
 *   (or /local/ha-sidebar-mini-player.js for a manual install), then restart
 *   Home Assistant and refresh the browser / reset the companion app's
 *   frontend cache. A plain Lovelace dashboard resource also works, but then
 *   the player only appears once a dashboard has been opened in that tab.
 *   Loading the file twice (both ways at once) is harmless - see the guard
 *   below.
 *
 * CONFIGURATION (optional - zero-config works out of the box)
 *   Define window.sidebarMiniPlayerConfig = { ... } in any frontend module
 *   (e.g. a tiny /config/www/sidebar-mini-player-config.js, also listed under
 *   extra_module_url). It is read lazily and re-checked every second, so load
 *   order does not matter. See DEFAULTS below and the README for every option.
 *   The accent colour can also come from your theme via the CSS variable
 *   --sidebar-mini-player-accent-color.
 *
 * STORAGE
 *   Nothing is written to Home Assistant (no entities, helpers or storage).
 *   Swipe dismissals are kept in this browser's localStorage under
 *   "sidebar-mini-player:dismissed" (per device; safe to clear).
 *
 * LIMITATION
 *   Only players that exist as media_player entities can be shown. For
 *   example, the Music Assistant web player running in a browser tab has no
 *   Home Assistant entity.
 *
 * HOW IT FINDS THE SIDEBAR (shadow DOM path, Home Assistant 2026.x)
 *   document > <home-assistant> .shadowRoot > <home-assistant-main> .shadowRoot
 *     > <ha-drawer> > <ha-sidebar> .shadowRoot
 *   (ha-sidebar is slotted inside ha-drawer's light DOM; older builds had it
 *   directly in the main shadowRoot or inside ha-drawer's shadowRoot - all
 *   three are tried, plus a bounded deep search). We retry every second until
 *   found, and a MutationObserver re-inserts the player if the frontend
 *   re-renders the sidebar.
 *
 * SIDEBAR DOM (Home Assistant 2026.10, ha-sidebar.shadowRoot):
 *   div.menu (ha-icon-button, div.title),
 *   div.panels-list
 *     div.wrapper > ha-list-nav.ha-scrollbar.before-spacer (dashboards/panels),
 *                   div.fade-top, div.fade-bottom
 *     div.spacer
 *     <sidebar-mini-player>            <-- position: "bottom" (default) goes HERE
 *     ha-list-nav.after-spacer
 *       ha-list-item-button#sidebar-config         href=/config   (Settings)
 *       ha-list-item-button#sidebar-notifications
 *       ha-list-item-button#sidebar-profile        href=/profile
 *   (the items may be light-DOM children of ha-list-nav projected through a
 *    <slot>, or inside its shadowRoot - both are handled.)
 *
 * PLACEMENT ORDER for position "bottom" - first match wins:
 *   1. .panels-list > .after-spacer        -> insert before it (normal case)
 *   2. Settings (#sidebar-config, .configuration, [href="/config"], ...) found
 *      anywhere (deep, across shadow roots) -> climb to its ancestor that is a
 *      direct child of .panels-list and insert before that; if there is no
 *      .panels-list (older frontends) insert right before Settings itself.
 *   3. Same with Notifications, then Profile.
 *   4. End of .panels-list.
 *   5. End of the sidebar shadowRoot. (Never before the panel list.)
 *   position "top" inserts at the start of .panels-list (just below the
 *   header) and falls back to the order above if that is not found.
 *   The player is flex: 0 0 auto so it never squashes the scrolling list.
 *
 * OLDER LAYOUTS (still handled by steps 2/3):
 *   - If Settings lives INSIDE the scrolling panel list (a flexible spacer,
 *     then Developer tools / Settings in one list), the player is inserted in
 *     that list right before Settings and gets position:sticky; bottom:0 plus
 *     the sidebar background colour, so on short windows the panels scroll
 *     UNDER it instead of pushing it off-screen.
 *   - If Settings is a top-level node of the sidebar, the player is inserted
 *     before it with flex-shrink:0, and the scrolling list gets min-height:0
 *     (one small <style id="sidebar-mini-player-layout"> added to the
 *     sidebar's shadowRoot) so the list shrinks/scrolls instead of overlapping.
 *
 * CONTRIBUTING: see CONTRIBUTING.md. Run `npm test` (jsdom) before a PR.
 * ============================================================================
 */
(() => {
  "use strict";

  /** Custom element tag + version (keep VERSION in sync with package.json and CHANGELOG.md). */
  const TAG = "sidebar-mini-player";
  const VERSION = "1.1.0";

  // Loaded twice (e.g. extra_module_url AND a dashboard resource, or two
  // different URLs) -> the second copy does nothing.
  if (window.__sidebarMiniPlayerLoaded) return;
  window.__sidebarMiniPlayerLoaded = VERSION;

  // --------------------------------------------------------------------------
  // USER CONFIGURATION
  // --------------------------------------------------------------------------
  /**
   * Defaults. Override any of them with a global object, e.g.
   *   window.sidebarMiniPlayerConfig = { paused_timeout_minutes: 10,
   *                                      exclude: ["media_player.browser_mod_*"] };
   * Unknown keys and invalid values are ignored (with a console warning).
   */
  const DEFAULTS = Object.freeze({
    /** Only these players may show (entity ids, '*' wildcards). Empty = all media_player.* */
    include: [],
    /** Never show these (entity ids, '*' wildcards). Applied after include. */
    exclude: [],
    /** Hide a player once it has been paused this many minutes. 0 = never auto-hide. */
    paused_timeout_minutes: 5,
    /** Some players (e.g. Sonos) go straight from playing to "idle" when paused or
     *  stopped, so they never reach "paused". true = a player that was playing/paused
     *  in this browser session and then went idle stays visible as "paused" and
     *  follows paused_timeout_minutes. false = idle players are hidden at once. */
    idle_as_paused: false,
    /** "bottom" = just above Settings (default), "top" = just below the sidebar header. */
    position: "bottom",
    /** Any CSS colour for buttons, progress and slider. "" = theme's --primary-color
     *  (or the theme variable --sidebar-mini-player-accent-color if set). */
    accent_color: "",
    /** Max collapsed cards above the focused card before a "+N more" row. */
    max_collapsed_cards: 4,
    /** Same cap for short windows (< 560px tall). */
    max_collapsed_cards_short_window: 2,
    /** Hide a native player that duplicates an active Music Assistant player. */
    dedupe_music_assistant: true,
    /** Swipe a card right (touch or mouse drag) to dismiss it. */
    swipe_to_dismiss: true,
    /** Small "x" on the focused card on hover (mouse devices only). */
    show_dismiss_button: true,
    /** Volume slider + mute toggle (when the player supports them). */
    show_volume: true,
    /** Progress bar (when the player reports a position). */
    show_progress: true,
    /** Shuffle button left of previous (only for players that support shuffle_set). */
    show_shuffle: false,
    /** Repeat button right of next, cycles off / all / one (only for players that support repeat_set). */
    show_repeat: false,
    /** Keep dismissals across reloads (this browser's localStorage). false = until reload. */
    remember_dismissed: true,
  });
  const POSITIONS = ["bottom", "top"];

  /**
   * Validate + merge a user config object over DEFAULTS. Never throws: a bad
   * value falls back to its default and logs one warning.
   */
  function resolveConfig(user) {
    const cfg = { ...DEFAULTS };
    if (user == null) return cfg;
    if (typeof user !== "object" || Array.isArray(user)) {
      console.warn(`[${TAG}] window.sidebarMiniPlayerConfig must be an object - using defaults`);
      return cfg;
    }
    const warn = (k, why) => console.warn(`[${TAG}] config "${k}" ${why} - using default ${JSON.stringify(DEFAULTS[k])}`);
    for (const [k, v] of Object.entries(user)) {
      if (!(k in DEFAULTS)) { console.warn(`[${TAG}] unknown config option "${k}" ignored`); continue; }
      const d = DEFAULTS[k];
      if (Array.isArray(d)) {
        const arr = typeof v === "string" ? [v] : v; // a single pattern is fine too
        if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) cfg[k] = arr.map((x) => x.trim()).filter(Boolean);
        else warn(k, "must be a list of entity ids / patterns");
      } else if (typeof d === "number") {
        const n = Number(v);
        if (v !== null && v !== "" && Number.isFinite(n) && n >= 0) cfg[k] = k.startsWith("max_") ? Math.floor(n) : n;
        else warn(k, "must be a number >= 0");
      } else if (typeof d === "boolean") {
        if (typeof v === "boolean") cfg[k] = v; else warn(k, "must be true or false");
      } else if (k === "position") {
        const p = String(v).toLowerCase();
        if (POSITIONS.includes(p)) cfg[k] = p; else warn(k, `must be one of ${POSITIONS.join(", ")}`);
      } else if (typeof v === "string") {
        cfg[k] = v.trim();
      } else warn(k, "must be a string");
    }
    return cfg;
  }

  /** The active, validated configuration (refreshed by refreshConfig()). */
  let CFG = resolveConfig(undefined);
  let cfgSig = null; // JSON signature of the last user config we resolved

  // --------------------------------------------------------------------------
  // INTERNAL TUNING (not user options - change only if you know why)
  // --------------------------------------------------------------------------
  /** States that count as "active". Everything else (on/idle/standby/off/unavailable) is ignored. */
  const ACTIVE_STATES = ["playing", "paused"];
  /** Swipe-to-dismiss tuning. */
  const SWIPE_DISMISS_FRACTION = 0.35; // released past 35% of the card width -> dismiss
  const SWIPE_FLICK_PX_PER_MS = 0.5;   // ...or a flick at >= 0.5 px/ms (500 px/s)
  const SWIPE_FLICK_MIN_PX = 24;       //    that travelled at least this far
  // A thumb swipe on a phone is rarely flat, so the lock is lenient.
  const SWIPE_LOCK_PX = 8;             // movement needed before we decide horizontal vs vertical
  const SWIPE_AXIS_RATIO = 1.2;        // horizontal must beat vertical by this factor to take over
  /** Max time (ms) _render() stays frozen during one swipe (safety net if a
   *  touchend/pointerup never arrives, e.g. the app was backgrounded mid-swipe). */
  const SWIPE_MAX_HOLD_MS = 8000;
  /** Dismissals persist in this browser's localStorage under this key. */
  const DISMISS_STORAGE_KEY = "sidebar-mini-player:dismissed";
  const DISMISS_MAX_AGE_DAYS = 7;      // prune entries older than this
  const DISMISS_MAX_ENTRIES = 100;     // ...and keep at most this many (newest win)
  /** How often (ms) we check for a new hass object / sidebar / progress tick. */
  const TICK_MS = 1000;
  /** Sidebar narrower than this (px) is treated as "collapsed" (icons only). */
  const COLLAPSED_MAX_WIDTH = 120;
  /** supported_features bits (MediaPlayerEntityFeature). */
  const FEAT_VOLUME_SET = 4;   // slider
  const FEAT_VOLUME_MUTE = 8;  // mute icon
  const FEAT_SHUFFLE_SET = 32768;  // shuffle button
  const FEAT_REPEAT_SET = 262144;  // repeat button
  /** Volume: wait this long (ms) after the last slider move before calling volume_set. */
  const VOLUME_DEBOUNCE_MS = 250;
  /** Volume: ignore incoming volume_level for this long (ms) after the user moved it,
   *  so a slightly stale state update can't snap the slider back mid-adjustment. */
  const VOLUME_HOLD_MS = 1500;
  /** Optimistic play/pause: show the expected state for at most this long (ms). */
  const OPTIMISTIC_MS = 8000;

  // --------------------------------------------------------------------------
  // Small helpers
  // --------------------------------------------------------------------------

  /** Friendly name, title-casing ALL-CAPS names ("LIVING ROOM" -> "Living Room"). */
  function niceName(stateObj) {
    const n = (stateObj.attributes && stateObj.attributes.friendly_name) || stateObj.entity_id;
    if (n === n.toUpperCase() && /[A-Z]/.test(n)) {
      return n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return n;
  }

  /**
   * Artwork URL. Prefer entity_picture_local (Home Assistant's own
   * /api/media_player_proxy/... URL, works remotely over https). Some
   * integrations (e.g. Music Assistant) put a plain-http LAN URL in
   * entity_picture, which would be blocked as mixed content when Home Assistant
   * is served over https, and is unreachable away from home - so it is only
   * used if it's relative or https (or the page itself is plain http).
   */
  function artworkUrl(hass, stateObj) {
    const a = stateObj.attributes || {};
    let url = a.entity_picture_local || null;
    if (!url && a.entity_picture) {
      const p = a.entity_picture;
      if (p.startsWith("/") || p.startsWith("https:") || location.protocol === "http:") url = p;
    }
    if (!url) return null;
    // Relative -> prefix with HA base URL (hass.hassUrl exists on the hass object).
    if (url.startsWith("/")) {
      try {
        if (typeof hass.hassUrl === "function") return hass.hassUrl(url);
      } catch (e) { /* fall through */ }
    }
    return url;
  }

  /** Current position in seconds, extrapolated while playing. null if unknown. */
  function currentPosition(stateObj) {
    const a = stateObj.attributes || {};
    if (typeof a.media_position !== "number" || !(a.media_duration > 0)) return null;
    let pos = a.media_position;
    if (stateObj.state === "playing" && a.media_position_updated_at) {
      const t = Date.parse(a.media_position_updated_at);
      if (!isNaN(t)) pos += (Date.now() - t) / 1000;
    }
    return Math.max(0, Math.min(pos, a.media_duration));
  }

  /** '*' wildcard pattern -> RegExp (everything else literal). */
  const toRegex = (pat) =>
    new RegExp("^" + pat.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  // Compiled include/exclude patterns - rebuilt by refreshConfig().
  let INCLUDE_RE = [];
  let EXCLUDE_RE = [];
  const allowed = (id) =>
    (!INCLUDE_RE.length || INCLUDE_RE.some((r) => r.test(id))) && !EXCLUDE_RE.some((r) => r.test(id));

  /**
   * Cached list of candidate media_player ids. A large install has thousands
   * of entities; we only re-list hass.states' keys when the states object
   * changed AND its key count changed (entity added/removed), or the config
   * changed. Otherwise each tick only looks at the cached media players.
   */
  const cache = { states: null, count: -1, ids: [] };
  function mediaPlayerIds(states) {
    if (states !== cache.states) {
      cache.states = states;
      const keys = Object.keys(states);
      if (keys.length !== cache.count) {
        cache.count = keys.length;
        cache.ids = keys.filter((id) => id.startsWith("media_player.") && allowed(id));
      }
    }
    return cache.ids;
  }

  /**
   * Re-read window.sidebarMiniPlayerConfig if it changed (cheap JSON compare,
   * called on every tick). Lets a config module load before OR after this
   * file, and lets you experiment live from the browser console.
   */
  function refreshConfig() {
    const user = window.sidebarMiniPlayerConfig;
    let sig;
    try { sig = JSON.stringify(user === undefined ? null : user); } catch (e) { sig = "!unserialisable"; }
    if (sig === cfgSig) return false;
    cfgSig = sig;
    CFG = resolveConfig(user);
    INCLUDE_RE = CFG.include.map(toRegex);
    EXCLUDE_RE = CFG.exclude.map(toRegex);
    cache.states = null; cache.count = -1; // re-list players with the new filters
    dismissals.map = null;                 // remember_dismissed may have changed
    window.sidebarMiniPlayer = { version: VERSION, config: CFG }; // handy for debugging in the console
    return true;
  }

  /** Is this a Music Assistant player entity? */
  const isMA = (s) => {
    const a = s.attributes || {};
    return a.mass_player_type != null || a.app_id === "music_assistant";
  };
  const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

  /**
   * DEDUPE: Music Assistant creates its own media_player next to the
   * device's native one (e.g. media_player.kitchen native +
   * media_player.kitchen_2 from Music Assistant, both "Kitchen"). When an MA player is
   * active, drop any ACTIVE NON-MA player that
   *   (a) shows the same media_title (non-empty), or
   *   (b) has the same friendly name.
   * MA-vs-MA is never deduped (grouped speakers playing the same track are
   * separate rooms and stay cyclable). Non-MA players with different content
   * and names (e.g. an Apple TV playing a video app) are always kept.
   */
  function dedupe(list) {
    if (!CFG.dedupe_music_assistant) return list;
    const ma = list.filter(isMA);
    if (!ma.length) return list;
    const titles = new Set(ma.map((s) => norm(s.attributes.media_title)).filter(Boolean));
    const names = new Set(ma.map((s) => norm(s.attributes.friendly_name)).filter(Boolean));
    return list.filter((s) => isMA(s) ||
      !(titles.has(norm(s.attributes.media_title)) || names.has(norm(s.attributes.friendly_name))));
  }

  /**
   * True if s has been 'paused' for longer than paused_timeout_minutes,
   * measured from last_changed (which only moves on a STATE change, not on
   * attribute updates). Evaluated on every 1 s tick with the current time, so
   * a player drops out without needing a new state update.
   * Note: a Home Assistant restart resets last_changed, so paused players
   * reappear for up to paused_timeout_minutes after a restart.
   */
  function pausedTooLong(s, now = Date.now()) {
    const min = CFG.paused_timeout_minutes;
    if (!(min > 0) || s.state !== "paused") return false;
    const t = Date.parse(s.last_changed);
    return !isNaN(t) && now - t > min * 60000;
  }

  /**
   * idle_as_paused: the last playing/paused state we saw per entity in THIS
   * page session (so a reload never resurrects old players). Dropped as soon as
   * the entity is seen in any other state than playing/paused/idle, or timed out.
   */
  const lastActive = new Map();

  /**
   * View of an idle player as a "paused" one. Idle players often have their media
   * attributes cleared, so title/artwork come from the last active state; live
   * non-null attributes (volume, mute, features) win. last_changed is the idle
   * transition, so paused_timeout_minutes counts from when it stopped.
   */
  function idleAsPaused(idle, last) {
    const attrs = { ...(last.attributes || {}) };
    for (const [k, v] of Object.entries(idle.attributes || {})) if (v != null) attrs[k] = v;
    return { ...idle, state: "paused", _rawState: "idle", attributes: attrs };
  }

  /**
   * Active players (playing/paused) after include/exclude and dedupe, sorted:
   * playing before paused, then most recently changed first.
   * (With idle_as_paused, idle players seen playing/paused earlier count as paused.)
   * Players paused > paused_timeout_minutes are dropped here, BEFORE dedupe,
   * so a stale paused MA player can't hide a native twin that is genuinely
   * playing. (Only playing/paused ever count -
   * idle/on/standby players with leftover media attributes were and are ignored.)
   */
  function activePlayers(hass, now = Date.now()) {
    let list = [];
    for (const id of mediaPlayerIds(hass.states)) {
      const s = hass.states[id];
      if (!s) { lastActive.delete(id); continue; }
      if (ACTIVE_STATES.includes(s.state)) {
        if (pausedTooLong(s, now)) lastActive.delete(id); // timed out: must not linger again after going idle
        else { list.push(s); if (CFG.idle_as_paused) lastActive.set(id, s); }
      } else if (CFG.idle_as_paused && s.state === "idle" && lastActive.has(id)) {
        const v = idleAsPaused(s, lastActive.get(id));
        if (pausedTooLong(v, now)) lastActive.delete(id); // timed out while idle: forget it
        else list.push(v);
      } else lastActive.delete(id); // off / unavailable / ... : forget it
    }
    list = dedupe(list);
    list.sort((x, y) => {
      if (x.state !== y.state) return x.state === "playing" ? -1 : 1;
      return Date.parse(y.last_changed) - Date.parse(x.last_changed);
    });
    return list;
  }

  /**
   * Manual dismissals (swipe / hover "x").
   * WHAT: { entity_id: { k: "<last_changed>|<state>", t: <dismissed at, ms> } }
   *   kept in localStorage[DISMISS_STORAGE_KEY]. A player is dismissed while its
   *   CURRENT last_changed|state equals the stored k, i.e. until its state changes
   *   (play again, pause again, turn off and on...).
   * WHY: swipe away players you're finished with; persisting means a
   *   reload / app restart doesn't bring them straight back
   *   (remember_dismissed: false keeps them in memory only).
   * Pruning: entries whose player has since changed state (they can never match
   *   again), entries older than DISMISS_MAX_AGE_DAYS, and anything beyond
   *   DISMISS_MAX_ENTRIES. localStorage errors (private mode, quota) are ignored -
   *   dismissals then just last until reload.
   */
  // _rawState: a lingering idle player (idle_as_paused) is shown as "paused" but its real state is "idle".
  const dismissKey = (s) => `${s.last_changed}|${s._rawState || s.state}`;
  const dismissals = {
    map: null,          // lazily loaded
    syncedStates: null, // last hass.states object we pruned against
    load() {
      let m = {};
      if (!CFG.remember_dismissed) { this.map = m; return m; }
      try {
        const raw = window.localStorage && window.localStorage.getItem(DISMISS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) m = parsed;
      } catch (e) { /* unreadable -> start empty */ }
      this.map = m;
      if (this.pruneAge()) this.save();
      return m;
    },
    get() { return this.map || this.load(); },
    save() {
      if (!CFG.remember_dismissed) return;
      try { window.localStorage && window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(this.get())); }
      catch (e) { /* ignore: in-memory only */ }
    },
    /** Drop entries older than DISMISS_MAX_AGE_DAYS / beyond DISMISS_MAX_ENTRIES. */
    pruneAge() {
      const m = this.map, cutoff = Date.now() - DISMISS_MAX_AGE_DAYS * 86400000;
      let changed = false;
      for (const id of Object.keys(m)) {
        const e = m[id];
        if (!e || typeof e.k !== "string" || !(e.t > cutoff)) { delete m[id]; changed = true; }
      }
      const ids = Object.keys(m);
      if (ids.length > DISMISS_MAX_ENTRIES) {
        ids.sort((a, b) => m[b].t - m[a].t).slice(DISMISS_MAX_ENTRIES).forEach((id) => delete m[id]);
        changed = true;
      }
      return changed;
    },
    /** Once per new hass.states object: forget players whose state has changed. */
    sync(states) {
      if (states === this.syncedStates) return;
      this.syncedStates = states;
      const m = this.get();
      let changed = false;
      for (const id of Object.keys(m)) {
        const s = states[id];
        if (s && dismissKey(s) !== m[id].k) { delete m[id]; changed = true; }
      }
      if (changed) this.save();
    },
    has(s) { const e = this.get()[s.entity_id]; return !!e && e.k === dismissKey(s); },
    add(s) {
      const m = this.get();
      m[s.entity_id] = { k: dismissKey(s), t: Date.now() };
      this.pruneAge();
      this.save();
    },
  };
  // Another tab/window of HA dismissed something -> re-read on next render.
  window.addEventListener("storage", (ev) => { if (ev.key === DISMISS_STORAGE_KEY || ev.key === null) dismissals.map = null; });

  /**
   * What the player actually shows = active
   * players (already without timed-out paused ones) minus manual dismissals.
   * Dismissals are applied AFTER dedupe so dismissing an MA player doesn't make
   * its hidden native twin pop up in its place. Order is kept (most relevant first).
   */
  function visiblePlayers(hass, now = Date.now()) {
    dismissals.sync(hass.states);
    return activePlayers(hass, now).filter((s) => !dismissals.has(s));
  }

  // Inline SVG paths (Material Design Icons) so we need no ha-icon dependency.
  const ICON = {
    shuffle: "M14.83,13.41L13.42,14.82L16.55,17.95L14.5,20H20V14.5L17.96,16.54L14.83,13.41M14.5,4L16.54,6.04L4,18.59L5.41,20L17.96,7.46L20,9.5V4M10.59,9.17L5.41,4L4,5.41L9.17,10.58L10.59,9.17Z",
    repeat: "M17,17H7V14L3,18L7,22V19H19V13H17M7,7H17V10L21,6L17,2V5H5V11H7V7Z",
    repeatOnce: "M13,15V9H12L10,10V11H11.5V15M17,17H7V14L3,18L7,22V19H19V13H17M7,7H17V10L21,6L17,2V5H5V11H7V7Z",
    play: "M8,5.14V19.14L19,12.14L8,5.14Z",
    pause: "M14,19H18V5H14M6,19H10V5H6V19Z",
    next: "M16,18H18V6H16M6,18L14.5,12L6,6V18Z",
    prev: "M6,18V6H8V18H6M9.5,12L18,6V18L9.5,12Z",
    left: "M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z",
    right: "M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z",
    volHigh: "M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z",
    volOff: "M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z",
    tv: "M21,17H3V5H21M21,3H3A2,2 0 0,0 1,5V17A2,2 0 0,0 3,19H8V21H16V19H21A2,2 0 0,0 23,17V5A2,2 0 0,0 21,3Z",
    close: "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z", // dismiss "x"
    music: "M12,3V12.26C11.5,12.09 11,12 10.5,12C8,12 6,14 6,16.5C6,19 8,21 10.5,21C13,21 15,19 15,16.5V6H19V3H12Z",
  };
  const svg = (path) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;

  /** Shuffle / repeat buttons (left of previous / right of next). Shown only when
   *  enabled in the config AND the player supports it; `on` styling = accent colour. */
  const SHUFFLE_BTN = `<button class="mode" data-act="shuffle" hidden></button>`;
  const REPEAT_BTN = `<button class="mode" data-act="repeat" hidden></button>`;
  function renderModes(root, s) {
    const a = s.attributes || {}, feats = Number(a.supported_features) || 0;
    const set = (btn, show, on, icon, title) => {
      btn.hidden = !show;
      if (!show) return;
      const key = icon + (on ? "-on" : "");
      if (btn.dataset.icon !== key) { btn.innerHTML = svg(ICON[icon]); btn.dataset.icon = key; }
      btn.classList.toggle("on", on);
      if (btn.title !== title) btn.title = title;
    };
    const sh = root.querySelector('[data-act="shuffle"]');
    if (sh) {
      const on = a.shuffle === true;
      set(sh, CFG.show_shuffle && (feats & FEAT_SHUFFLE_SET) !== 0, on, "shuffle", `Shuffle: ${on ? "on" : "off"}`);
    }
    const rp = root.querySelector('[data-act="repeat"]');
    if (rp) {
      const mode = a.repeat === "all" || a.repeat === "one" ? a.repeat : "off";
      set(rp, CFG.show_repeat && (feats & FEAT_REPEAT_SET) !== 0, mode !== "off", mode === "one" ? "repeatOnce" : "repeat", `Repeat: ${mode}`);
    }
  }

  // --------------------------------------------------------------------------
  // The player element. Own shadow root -> our CSS can't leak into the sidebar
  // and the sidebar's CSS can't break ours. Theme variables still inherit.
  // --------------------------------------------------------------------------
  class SidebarMiniPlayer extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._selected = null;   // entity_id the user clicked to focus (null = auto: most recent playing)
      this._lastPic = null;    // avoid resetting <img src> every tick
      this._collapsed = false;
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
          /* Theming hooks (all optional - see README "Theming"):
               --sidebar-mini-player-accent-color   buttons, progress, slider (default --primary-color)
               --sidebar-mini-player-card-background card background
               --sidebar-mini-player-border-radius  card corners
             accent_color in the config is applied as an inline
             --sidebar-mini-player-accent-color on this element. */
          :host {
            display: block; flex: 0 0 auto; box-sizing: border-box;
            --smp-accent: var(--sidebar-mini-player-accent-color, var(--primary-color, #03a9f4));
            --smp-card-bg: var(--sidebar-mini-player-card-background, var(--secondary-background-color, var(--card-background-color, rgba(127,127,127,0.12))));
            --smp-radius: var(--sidebar-mini-player-border-radius, var(--ha-card-border-radius, 12px));
          }
          /* When we live inside the scrolling panel list (above Settings),
             stick to the bottom of the visible list so we're never scrolled off-screen;
             opaque background so panels scroll underneath cleanly. */
          :host([in-list]) {
            position: sticky; bottom: 0; z-index: 2;
            background: var(--sidebar-background-color, var(--card-background-color, inherit));
          }
          :host([hidden]) { display: none !important; }
          [hidden] { display: none !important; } /* our own rules (e.g. display:flex) must not beat the hidden attribute */
          /* Card look with breathing room - 8px from the sidebar edges and
             from the items above/below, 8-10px inner padding, theme card radius,
             subtle background + hairline border so it reads as a card. */
          .wrap {
            box-sizing: border-box;
            margin: 8px; padding: 8px 10px;
            border-radius: var(--smp-radius);
            background: var(--smp-card-bg);
            border: 1px solid var(--divider-color, rgba(127,127,127,0.2));
            color: var(--sidebar-text-color, var(--primary-text-color));
            font-family: var(--paper-font-body1_-_font-family, inherit);
            overflow: hidden;
          }
          .row { display: flex; align-items: center; gap: 8px; min-width: 0; }
          .art {
            position: relative; flex: 0 0 40px; width: 40px; height: 40px;
            border-radius: 6px; overflow: hidden; cursor: pointer;
            background: var(--divider-color, rgba(127,127,127,0.3));
            display: flex; align-items: center; justify-content: center;
          }
          .art img { width: 100%; height: 100%; object-fit: cover; display: block; }
          .art .ph { width: 22px; height: 22px; fill: var(--sidebar-icon-color, currentColor); }
          .text { flex: 1 1 auto; min-width: 0; cursor: pointer; line-height: 1.2; }
          .title, .artist, .spk { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .title { font-size: 13px; font-weight: 500; }
          .artist { font-size: 12px; color: var(--secondary-text-color); }
          .spk { font-size: 11px; color: var(--secondary-text-color); opacity: 0.85; }
          .controls { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 4px; }
          /* shuffle / repeat: slightly smaller, dim when off, accent colour when on */
          .controls button.mode { width: 26px; height: 26px; opacity: 0.55; }
          .controls button.mode svg { width: 18px; height: 18px; }
          .controls button.mode.on { color: var(--smp-accent); opacity: 1; }
          button {
            all: unset; cursor: pointer; display: inline-flex; align-items: center;
            justify-content: center; width: 30px; height: 30px; border-radius: 50%;
            color: var(--sidebar-icon-color, currentColor);
          }
          button:hover { background: var(--divider-color, rgba(127,127,127,0.2)); }
          button:focus-visible { outline: 2px solid var(--smp-accent); }
          button svg { width: 22px; height: 22px; fill: currentColor; }
          button.pp svg { width: 26px; height: 26px; }
          button.pp { color: var(--smp-accent); }
          /* Progress bar sits between the transport buttons and the volume row. */
          .bar { height: 3px; margin: 6px 0 4px; border-radius: 2px; overflow: hidden;
                 background: var(--divider-color, rgba(127,127,127,0.3)); }
          .bar > div { height: 100%; width: 0; background: var(--smp-accent); transition: width 0.9s linear; }
          .overlay { display: none; }
          /* Volume row: mute icon + slider */
          .vol { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
          /* Mute icon: same 18px glyph in a 24px hit box as before, coloured like the
             other sidebar icons, vertically centred with the 20px slider row. */
          .vol button { width: 24px; height: 24px; flex: 0 0 24px; color: var(--sidebar-icon-color, currentColor); }
          .vol button svg { width: 18px; height: 18px; }
          .vol button:disabled { cursor: default; opacity: 0.6; background: none; }

          /* Slider look (small knob, clearly visible track):
             - native look switched off (appearance:none) for WebKit/Blink and Firefox
             - input itself is 20px tall = comfortable touch area, but transparent
             - track 4px, rounded; filled part = accent colour, unfilled part clearly
               visible (25% of the text colour; grey fallback). The fill is a
               linear-gradient driven by --smp-fill (0%-100%), which JS sets on
               every input event and state update (see _setFill()).
             - thumb 12px circle in the accent colour with a thin ring in the sidebar
               background colour so it stands out on the filled track. */
          .vol {
            --smp-track-off: rgba(127, 127, 127, 0.45);
            --smp-track-on: var(--smp-accent);
          }
          @supports (color: color-mix(in srgb, red 50%, blue)) {
            .vol { --smp-track-off: color-mix(in srgb, var(--primary-text-color, #888) 25%, transparent); }
          }
          .vol input[type=range] {
            -webkit-appearance: none; appearance: none;
            flex: 1 1 auto; min-width: 0; height: 20px; margin: 0; padding: 0;
            background: transparent; cursor: pointer;
            touch-action: none; /* keep the mobile drawer's swipe from stealing the drag */
            --smp-fill: 0%;
          }
          .vol input[type=range]:focus { outline: none; }
          .vol input[type=range]:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--smp-track-off); }
          /* WebKit / Blink (Safari, Chrome, iOS app) */
          .vol input[type=range]::-webkit-slider-runnable-track {
            height: 4px; border-radius: 2px; border: none;
            background: linear-gradient(to right,
              var(--smp-track-on) 0%, var(--smp-track-on) var(--smp-fill),
              var(--smp-track-off) var(--smp-fill), var(--smp-track-off) 100%);
          }
          .vol input[type=range]::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none;
            width: 12px; height: 12px; border-radius: 50%; border: none;
            margin-top: -4px; /* (4px track - 12px thumb) / 2 -> centred on the track */
            background: var(--smp-track-on);
            box-shadow: 0 0 0 2px var(--sidebar-background-color, var(--card-background-color, #fff));
          }
          /* Firefox */
          .vol input[type=range]::-moz-range-track {
            height: 4px; border-radius: 2px; border: none; background: var(--smp-track-off);
          }
          .vol input[type=range]::-moz-range-progress {
            height: 4px; border-radius: 2px; background: var(--smp-track-on);
          }
          .vol input[type=range]::-moz-range-thumb {
            width: 12px; height: 12px; border-radius: 50%; border: none;
            background: var(--smp-track-on);
            box-shadow: 0 0 0 2px var(--sidebar-background-color, var(--card-background-color, #fff));
          }
          .vol input[type=range]::-moz-focus-outer { border: 0; }
          /* ---- Stack of COLLAPSED cards above the focused card ----
             Same card look as .wrap, slimmer, 5px apart. Order top -> bottom:
             "+N more" row, least relevant ... most relevant, then the focused card
             (nearest Settings). */
          .stack { padding-top: 8px; }
          .mini, .more {
            box-sizing: border-box; margin: 0 8px 5px;
            border-radius: var(--smp-radius);
            background: var(--smp-card-bg);
            border: 1px solid var(--divider-color, rgba(127,127,127,0.2));
            color: var(--sidebar-text-color, var(--primary-text-color));
          }
          .mini { padding: 5px 8px; cursor: pointer; overflow: hidden; }
          .mini:hover { border-color: var(--smp-accent); }
          .mini .mrow { display: flex; align-items: center; gap: 8px; min-width: 0; }
          .mini .art { flex: 0 0 30px; width: 30px; height: 30px; border-radius: 5px; cursor: pointer;
                       transition: width 0.2s ease, height 0.2s ease, flex-basis 0.2s ease; }
          .mini .art .ph { width: 18px; height: 18px; }
          .mini .mtext { flex: 1 1 auto; min-width: 0; line-height: 1.2; }
          .mini .title { font-size: 12px; }
          .mini .spk { font-size: 11px; }
          .mini button.mpp { width: 26px; height: 26px; flex: 0 0 26px; color: var(--smp-accent); }
          .mini button.mpp svg { width: 20px; height: 20px; }
          /* Hover preview (only on devices with real hover - JS adds .hover): smooth
             height transition reveals artist, prev/play/next and the progress bar. */
          .mini .extra { max-height: 0; opacity: 0; overflow: hidden;
                         transition: max-height 0.22s ease, opacity 0.18s ease; }
          .mini.hover .extra { max-height: 90px; opacity: 1; }
          .mini.hover .art { flex-basis: 40px; width: 40px; height: 40px; }
          .mini.hover button.mpp { visibility: hidden; } /* full controls shown in .extra instead */
          .mini .extra .artist { font-size: 11px; margin-top: 4px; }
          .mini .extra .controls { margin-top: 2px; }
          .mini .extra button { width: 26px; height: 26px; }
          .mini .extra button svg { width: 20px; height: 20px; }
          .mini .extra .bar { margin: 4px 0 2px; }
          .more {
            display: block; width: calc(100% - 16px); height: auto; padding: 3px 8px;
            font-size: 11px; text-align: center; border-radius: 10px; cursor: pointer;
            color: var(--secondary-text-color);
          }
          .more:hover { color: var(--smp-accent); background: var(--secondary-background-color); }
          .stack:not([hidden]) + .wrap { margin-top: 0; } /* minis already add 5px below themselves */
          /* Count badge on the focused artwork (collapsed sidebar only, >1 active). */
          .badge {
            display: none; position: absolute; top: 1px; right: 1px; z-index: 1;
            min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box;
            border-radius: 7px; font-size: 10px; line-height: 14px; text-align: center;
            background: var(--smp-accent); color: var(--text-primary-color, #fff);
          }

          /* ---- Swipe-right-to-dismiss + hover "x" ----
             touch-action: pan-y = the browser still scrolls the sidebar vertically,
             but leaves horizontal drags to our pointer handlers. No text selection
             / native image drag, which would otherwise hijack a mouse swipe.
             The card's transform/opacity are set inline by _wireSwipe(). */
          .wrap, .mini { touch-action: pan-y; -webkit-user-select: none; user-select: none; }
          /* iOS: no long-press callout / grey tap
             flash on the cards. touch-action alone is NOT relied on any more (WKWebView
             can ignore it inside the sliding drawer); the touchmove handler in
             _wireSwipe() calls preventDefault() itself. */
          .wrap, .mini { -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
          .wrap img, .mini img { -webkit-user-drag: none; }
          .wrap.swiping, .mini.swiping { cursor: grabbing; }
          .wrap { position: relative; } /* anchor for the "x" */
          @keyframes smp-in { from { opacity: 0; } to { opacity: 1; } }
          .wrap.smp-in { animation: smp-in 0.18s ease-out; } /* next player fades in after a dismiss */
          /* Hover-only dismiss "x" on the focused card (mouse users). Never shown on
             touch devices (they swipe) or in the collapsed sidebar. Subtle: small,
             secondary text colour, card background, appears on card hover. */
          .wrap .dismiss { display: none; }
          @media (hover: hover) {
            .wrap .dismiss {
              display: inline-flex; position: absolute; top: 3px; right: 3px; z-index: 2;
              width: 18px; height: 18px; border-radius: 50%; opacity: 0;
              color: var(--secondary-text-color);
              background: var(--secondary-background-color, var(--card-background-color, transparent));
              transition: opacity 0.15s ease;
            }
            .wrap:hover .dismiss, .wrap .dismiss:focus-visible { opacity: 0.75; }
            .wrap .dismiss:hover { opacity: 1; color: var(--primary-text-color); background: var(--divider-color, rgba(127,127,127,0.2)); }
          }
          .wrap .dismiss svg { width: 12px; height: 12px; }
          :host([no-dismiss-button]) .wrap .dismiss { display: none !important; }
          :host([collapsed]) .wrap .dismiss { display: none !important; }

          /* Short windows: drop the least important lines so we stay compact. */
          @media (max-height: 560px) {
            .wrap .spk { display: none; }
            .wrap { margin: 4px 8px; padding: 6px 8px; } /* still a card, just tighter */
            .stack { padding-top: 4px; }
            .mini, .more { margin-bottom: 4px; }
            .mini { padding: 3px 8px; }
            .mini .art { flex-basis: 24px; width: 24px; height: 24px; }
            .mini .spk { display: none; }
          }

          /* ---- Collapsed sidebar: artwork only, play/pause over it ---- */
          /* Collapsed (56px sidebar): compact, no card chrome, thumbnail centred. */
          :host([collapsed]) .wrap {
            margin: 6px auto; padding: 2px; width: 48px;
            background: none; border: none; border-radius: 8px;
          }
          :host([collapsed]) .text,
          :host([collapsed]) .controls,
          :host([collapsed]) .stack,
          :host([collapsed]) .bar,
          :host([collapsed]) .vol { display: none; }
          :host([collapsed]) .row { justify-content: center; }
          :host([collapsed]) .overlay {
            display: flex; position: absolute; inset: 0; width: auto; height: auto;
            border-radius: 6px; background: rgba(0,0,0,0.35); color: #fff;
          }
          :host([collapsed]) .overlay svg { width: 22px; height: 22px; }
          :host([collapsed]) .badge:not([hidden]) { display: block; }
        </style>
        <div class="stack" hidden>
          <button class="more" data-act="more" hidden></button>
          <div class="minis"></div>
        </div>
        <div class="wrap focus" part="wrap">
          <!-- hover-only dismiss button (CSS above) -->
          <button class="dismiss" data-act="dismiss" title="Hide until it changes" aria-label="Dismiss player">${svg(ICON.close)}</button>
          <div class="row">
            <div class="art" title="Open player">
              <span class="badge" hidden></span>
              <img alt="" hidden draggable="false">
              <span class="ph">${svg(ICON.music)}</span>
              <button class="overlay" data-act="playpause" title="Play/Pause"></button>
            </div>
            <div class="text" title="Open player">
              <div class="title"></div>
              <div class="artist"></div>
              <div class="spk"></div>
            </div>
          </div>
          <div class="controls">
            ${SHUFFLE_BTN}
            <button data-act="prev" title="Previous">${svg(ICON.prev)}</button>
            <button class="pp" data-act="playpause" title="Play/Pause"></button>
            <button data-act="next" title="Next">${svg(ICON.next)}</button>
            ${REPEAT_BTN}
          </div>
          <div class="bar" hidden><div></div></div>
          <div class="vol" hidden>
            <button class="mute" data-act="mute" title="Mute"></button>
            <input type="range" min="0" max="100" step="1" aria-label="Volume" title="Volume">
          </div>
        </div>`;

      // Element refs for the FOCUSED card (scoped to .focus so the mini cards'
      // .title/.art/... never match).
      const $ = (sel) => this.shadowRoot.querySelector(".focus " + sel);
      this._el = {
        wrap: this.shadowRoot.querySelector(".focus"),
        img: $(".art img"), ph: $(".art .ph"), badge: $(".art .badge"), title: $(".title"),
        artist: $(".artist"), spk: $(".spk"), bar: $(".bar"), barFill: $(".bar > div"),
        ppButtons: this.shadowRoot.querySelectorAll('.focus [data-act="playpause"]'),
        stack: this.shadowRoot.querySelector(".stack"),
        minis: this.shadowRoot.querySelector(".minis"),
        more: this.shadowRoot.querySelector(".more"),
      };
      this._miniNodes = new Map();  // entity_id -> mini card element (reused between ticks)
      this._showAll = false;        // "+N more" expanded?
      this._hoverMQ = window.matchMedia ? window.matchMedia("(hover: hover)") : null;
      this._shortMQ = window.matchMedia ? window.matchMedia("(max-height: 560px)") : null;
      this._el.vol = $(".vol");
      this._el.mute = $(".vol .mute");
      this._el.slider = $(".vol input");
      this._volTimer = null;     // debounce timer for volume_set
      this._volHoldUntil = 0;    // ignore incoming volume_level until this time
      this._dragging = false;    // pointer is down on the slider
      this._volEntity = null;    // entity the slider is currently showing
      this._wireSlider();
      this._el.img.addEventListener("error", () => { this._el.img.hidden = true; this._el.ph.hidden = false; });
      // Swipe right to dismiss the FOCUSED card.
      // _suppressClickUntil swallows the click a browser fires at the end of a swipe.
      this._suppressClickUntil = 0;
      this._swipeHoldUntil = 0;    // _render() frozen until this time (during a swipe)
      this._wireSwipe(this._el.wrap, () => this._entity);

      // One delegated click handler for everything.
      //  - any [data-act] button: run it, on the mini card's entity if inside one
      //  - click elsewhere on a mini card: make that player the focused one
      //  - click art/text of the focused card: open more-info
      this.shadowRoot.addEventListener("click", (ev) => {
        // A swipe must never focus a card, open
        // more-info or press a button - swallow the click that ends a swipe.
        if (Date.now() < this._suppressClickUntil) { ev.stopPropagation(); ev.preventDefault(); return; }
        const btn = ev.target.closest("[data-act]");
        const mini = ev.target.closest(".mini");
        if (btn) {
          ev.stopPropagation();
          this._action(btn.dataset.act, mini ? mini.dataset.entity : null);
          return;
        }
        if (mini) {
          this._selected = mini.dataset.entity; // sticks while that player stays active
          this._render();
          return;
        }
        if (ev.target.closest(".focus .art, .focus .text")) this._openMoreInfo();
      });
    }

    /**
     * Swipe RIGHT to dismiss (disabled with swipe_to_dismiss: false).
     *
     * WHY TOUCH EVENTS (not just pointer events): pointer events can NEVER stop
     * the browser's own panning (pointermove.preventDefault is ignored for
     * scrolling). On iOS (Safari and the companion app's WKWebView) the first
     * few px of a thumb swipe are never perfectly flat; WebKit commits to a
     * native pan of the drawer / sidebar scroller on the first un-prevented
     * touchmove, then fires pointercancel - so a pointer-only swipe jerks a
     * few px and snaps back.
     * HOW:
     *  - TOUCH: real touchstart/touchmove/touchend/touchcancel listeners.
     *    touchmove is registered { passive: false } so we CAN preventDefault:
     *      * while undecided (< SWIPE_LOCK_PX) and the movement so far is
     *        rightward-and-more-horizontal-than-vertical, we already
     *        preventDefault (+ stopPropagation) so iOS can't start a native
     *        pan and the drawer sees nothing while we decide;
     *        a vertical-ish start is left alone (sidebar still scrolls);
     *      * once horizontal intent is clear -> "swipe": every touchmove is
     *        preventDefault()ed + stopPropagation()ed too, so neither the page,
     *        the mobile drawer (ha-drawer/mwc-drawer) nor HA see the gesture;
     *      * if iOS already owns the touch (touchmove not cancelable) we let go.
     *    Touch input is tracked by Touch.identifier; a 2nd finger cancels.
     *    Once touch events are seen for a gesture, the pointer events of that
     *    same finger are ignored (iOS sends both; its pointercancel no longer
     *    kills our swipe).
     *  - MOUSE / pen without touch events: pointer events.
     *  - NO RE-RENDER WHILE DRAGGING: from the moment a gesture becomes a swipe
     *    until it has finished (slide-out or spring-back), _render() is frozen
     *    (this._swipeHoldUntil, safety cap SWIPE_MAX_HOLD_MS). Before, the 1 s
     *    tick could re-order/remove a collapsed card or swap the focused card's
     *    content mid-drag; a DOM move also drops pointer capture, which is
     *    treated as a CANCEL (spring back), never as a release.
     *  - release past SWIPE_DISMISS_FRACTION of the width, or a flick faster than
     *    SWIPE_FLICK_PX_PER_MS -> slide out + fade, then _dismiss(); otherwise
     *    spring back. touchcancel / pointercancel during a swipe -> spring back.
     *  - feedback: the card follows the finger (right only) and fades as it goes.
     *  - the click that follows a swipe is swallowed (_suppressClickUntil, plus
     *    preventDefault on touchend so iOS doesn't synthesise mouse/click).
     *  - the slider row (.vol) is excluded (it has its own drag), as is the
     *    collapsed icons-only sidebar (a 48px card is too small to swipe safely).
     * card = the element to move; entityOf() = which player it shows right now
     * (read at gesture start so the right player is dismissed).
     */
    _wireSwipe(card, entityOf) {
      let g = null; // current gesture: { src: "pointer"|"touch", pid, tid, x0, y0, mode, dx, id, samples }
      const clearStyles = () => {
        card.style.transition = ""; card.style.transform = ""; card.style.opacity = "";
        card.style.willChange = "";
        card.classList.remove("swiping");
      };
      const widthOf = () => card.offsetWidth || (card.getBoundingClientRect && card.getBoundingClientRect().width) || 200;
      const now = (ev) => (ev && ev.timeStamp) || performance.now();
      const excluded = (target) => !!(target && target.closest && target.closest(".vol, input"));
      const begin = (src, x, y, ev, extra) => {
        if (!CFG.swipe_to_dismiss) return null;
        const id = entityOf();
        if (!id) return null;
        return Object.assign({ src, x0: x, y0: y, mode: "pending", dx: 0, id, samples: [{ x, t: now(ev) }] }, extra);
      };
      // Shared move logic. Returns true when the event belongs to our swipe
      // (caller then preventDefault/stopPropagation as its event type allows).
      const move = (x, y, ev) => {
        const dx = x - g.x0, dy = y - g.y0;
        if (g.mode === "pending") {
          if (Math.abs(dx) < SWIPE_LOCK_PX && Math.abs(dy) < SWIPE_LOCK_PX) {
            // Undecided. Report "ours" only if it LOOKS horizontal-right so far
            // (touch path uses this to stop iOS committing to a native pan).
            return dx > 0 && dx > Math.abs(dy);
          }
          if (dx > 0 && dx > Math.abs(dy) * SWIPE_AXIS_RATIO) {
            g.mode = "swipe";
            if (g.src === "pointer") { try { card.setPointerCapture(g.pid); } catch (e) { /* not critical */ } }
            card.classList.add("swiping");
            card.style.transition = "none";
            card.style.willChange = "transform, opacity";
            this._suppressClickUntil = Number.MAX_SAFE_INTEGER; // until release (below)
            this._swipeHoldUntil = Date.now() + SWIPE_MAX_HOLD_MS; // freeze _render()
          } else { g = null; return false; } // vertical scroll / leftward: not ours
        }
        g.dx = Math.max(0, dx);                 // right only
        card.style.transform = `translateX(${g.dx}px)`;
        card.style.opacity = String(1 - Math.min(1, g.dx / widthOf()) * 0.7); // fades as it goes
        const t = now(ev);
        g.samples.push({ x, t });
        while (g.samples.length > 2 && t - g.samples[0].t > 100) g.samples.shift(); // last ~100 ms
        return true;
      };
      // Finish the gesture. Returns true if it was a swipe.
      const end = (cancelled) => {
        const gg = g; g = null;
        if (!gg || gg.mode !== "swipe") return false; // a plain tap/click: untouched
        this._suppressClickUntil = Date.now() + 400; // swallow the trailing click
        if (gg.src === "pointer") { try { card.releasePointerCapture(gg.pid); } catch (e) { /* already released */ } }
        const w = widthOf();
        const a = gg.samples[0], b = gg.samples[gg.samples.length - 1];
        const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0; // px/ms, + = rightwards
        const out = !cancelled &&
          (gg.dx > w * SWIPE_DISMISS_FRACTION || (v >= SWIPE_FLICK_PX_PER_MS && gg.dx >= SWIPE_FLICK_MIN_PX));
        if (out) {
          // Slide out + fade, then dismiss (render then shows the next player).
          card.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
          card.style.transform = `translateX(${w + 16}px)`;
          card.style.opacity = "0";
          setTimeout(() => {
            card.style.transition = "none";
            this._swipeHoldUntil = 0;   // unfreeze before _dismiss() renders
            this._dismiss(gg.id);
            clearStyles();
            if (card === this._el.wrap && !this.hidden) { // focused card: fade the next one in
              card.classList.remove("smp-in"); void card.offsetWidth; card.classList.add("smp-in");
            }
          }, 200);
        } else {
          // Spring back, then unfreeze and catch up on anything that changed.
          card.style.transition = "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s ease";
          card.style.transform = "translateX(0)";
          card.style.opacity = "";
          setTimeout(() => {
            if (!g) clearStyles();
            this._swipeHoldUntil = 0;
            this._render();
          }, 260);
        }
        return true;
      };

      // ---- TOUCH path (iOS app / Safari, Android) ----
      const findTouch = (list) => {
        if (!g || !list) return null;
        for (let i = 0; i < list.length; i++) if (list[i].identifier === g.tid) return list[i];
        return null;
      };
      card.addEventListener("touchstart", (ev) => {
        const touches = ev.touches || [];
        if (touches.length > 1) { // second finger: not a swipe
          if (g && g.mode === "swipe") end(true); else g = null;
          return;
        }
        if (this._collapsed || excluded(ev.target)) return;
        const t0 = (ev.changedTouches && ev.changedTouches[0]) || touches[0];
        if (!t0) return;
        if (g && g.src === "pointer" && g.ptype !== "mouse" && g.mode === "pending") {
          g.src = "touch"; g.tid = t0.identifier; // iOS: pointerdown came first -> touch takes over
          return;
        }
        if (g) return;
        g = begin("touch", t0.clientX, t0.clientY, ev, { tid: t0.identifier });
      }, { passive: true }); // start never blocks scrolling
      card.addEventListener("touchmove", (ev) => {
        if (!g || g.src !== "touch") return;
        const t = findTouch(ev.changedTouches) || findTouch(ev.touches);
        if (!t) return;
        if (!ev.cancelable && g.mode !== "swipe") { g = null; return; } // iOS already scrolling: let it
        if (move(t.clientX, t.clientY, ev)) {
          if (ev.cancelable) ev.preventDefault(); // no native pan / drawer gesture / page bounce
          ev.stopPropagation(); // keep ha-drawer / sidebar out of it (also while deciding)
        }
      }, { passive: false }); // MUST be non-passive or preventDefault is ignored
      card.addEventListener("touchend", (ev) => {
        if (!g || g.src !== "touch" || !findTouch(ev.changedTouches)) return;
        if (end(false)) {
          if (ev.cancelable) ev.preventDefault(); // no synthetic mouse events / click
          ev.stopPropagation();
        }
      }, { passive: false });
      card.addEventListener("touchcancel", (ev) => {
        if (!g || g.src !== "touch" || !findTouch(ev.changedTouches)) return;
        end(true);
      });

      // ---- POINTER path (mouse; pen/touch only where touch events never fire) ----
      card.addEventListener("pointerdown", (ev) => {
        if (g || this._collapsed) return;
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        if (excluded(ev.target)) return;
        g = begin("pointer", ev.clientX, ev.clientY, ev, { pid: ev.pointerId, ptype: ev.pointerType });
      });
      card.addEventListener("pointermove", (ev) => {
        if (!g || g.src !== "pointer" || ev.pointerId !== g.pid) return;
        if (move(ev.clientX, ev.clientY, ev) && g && g.mode === "swipe") {
          if (ev.cancelable) ev.preventDefault(); // no text selection while swiping
          ev.stopPropagation();
        }
      });
      const pend = (ev, cancelled) => {
        if (!g || g.src !== "pointer" || ev.pointerId !== g.pid) return; // touch-owned gestures ignore pointer events
        end(cancelled);
      };
      card.addEventListener("pointerup", (ev) => pend(ev, false));
      card.addEventListener("pointercancel", (ev) => pend(ev, true));
      // Losing capture (e.g. node moved) SPRINGS BACK instead of counting as a
      // release (which could dismiss by accident).
      card.addEventListener("lostpointercapture", (ev) => { if (g && g.mode === "swipe") pend(ev, true); });
      card.addEventListener("animationend", () => card.classList.remove("smp-in"));
    }

    /**
     * Hide entityId until its state changes
     * (stored with its current last_changed|state, see `dismissals`). If it was
     * the focused/selected player, focus falls back to the next one (auto).
     */
    _dismiss(entityId) {
      const hass = this._hass, s = hass && entityId && hass.states[entityId];
      if (!s) return;
      dismissals.add(s);
      if (this._selected === entityId) this._selected = null;
      const node = this._miniNodes.get(entityId);
      if (node) node.classList.remove("hover");
      this._render();
    }

    /**
     * Volume slider behaviour:
     *  - 'input' (every move): remember the value, (re)start a 250 ms debounce.
     *  - 'change' (released): send immediately.
     *  - while dragging / for VOLUME_HOLD_MS afterwards, _render() leaves the
     *    slider value alone, so HA state updates don't fight the user.
     *  - pointer/touch events are stopped here so the sidebar / mobile drawer
     *    doesn't treat a slider drag as a swipe or item drag.
     */
    _wireSlider() {
      const sl = this._el.slider;
      const hold = () => { this._volHoldUntil = Date.now() + VOLUME_HOLD_MS; };
      const send = () => {
        clearTimeout(this._volTimer);
        this._volTimer = null;
        const hass = this._hass, id = this._volEntity;
        if (!hass || !id) return;
        const level = Math.max(0, Math.min(100, Number(sl.value))) / 100;
        hass.callService("media_player", "volume_set", { entity_id: id, volume_level: level })
          .catch((err) => console.warn(`[${TAG}] volume_set failed`, err));
        hold();
      };
      sl.addEventListener("input", () => {
        this._setFill(); // move the filled part of the track with the knob
        hold();
        clearTimeout(this._volTimer);
        this._volTimer = setTimeout(send, VOLUME_DEBOUNCE_MS);
      });
      sl.addEventListener("change", send);
      const down = (ev) => { ev.stopPropagation(); this._dragging = true; hold(); };
      const up = () => { if (this._dragging) { this._dragging = false; hold(); } };
      for (const t of ["pointerdown", "mousedown", "touchstart"]) sl.addEventListener(t, down, { passive: true });
      for (const t of ["pointerup", "pointercancel", "mouseup", "touchend", "touchcancel"]) {
        sl.addEventListener(t, (ev) => { ev.stopPropagation(); up(); }, { passive: true });
      }
      window.addEventListener("pointerup", up, { passive: true }); // released outside the slider
      sl.addEventListener("click", (ev) => ev.stopPropagation());
    }

    /** Set --smp-fill (0%-100%) so the track gradient matches the value. */
    _setFill() {
      const sl = this._el.slider, pct = Math.max(0, Math.min(100, Number(sl.value) || 0)) + "%";
      if (sl.style.getPropertyValue("--smp-fill") !== pct) sl.style.setProperty("--smp-fill", pct);
    }

    /** Show/update the volume row for stateObj s (respects drag/hold). */
    _renderVolume(s) {
      const e = this._el, a = s.attributes || {};
      const feats = Number(a.supported_features) || 0;
      const canSet = (feats & FEAT_VOLUME_SET) !== 0;
      const canMute = (feats & FEAT_VOLUME_MUTE) !== 0;
      e.vol.hidden = !CFG.show_volume || (!canSet && !canMute);
      if (e.vol.hidden) return;
      e.slider.hidden = !canSet;

      // Switched to a different player -> drop any pending send/hold from the old one.
      if (this._volEntity !== s.entity_id) {
        if (this._volTimer) { clearTimeout(this._volTimer); this._volTimer = null; }
        this._volHoldUntil = 0;
        this._dragging = false;
        this._volEntity = s.entity_id;
      }

      const muted = a.is_volume_muted === true;
      const lvl = typeof a.volume_level === "number" ? a.volume_level : null;
      const busy = this._dragging || this._volTimer || Date.now() < this._volHoldUntil;
      if (canSet && !busy && lvl !== null) {
        const v = String(Math.round(lvl * 100));
        if (e.slider.value !== v) e.slider.value = v;
        this._setFill();
      }
      if (canSet) e.slider.title = `Volume ${e.slider.value}%`;

      // Mute icon: shows the current state (speaker off when muted / at 0).
      const off = muted || (canSet && Number(e.slider.value) === 0);
      const key = (off ? "off" : "on") + (canMute ? "" : "-ro");
      if (e.mute.dataset.icon !== key) {
        e.mute.innerHTML = svg(off ? ICON.volOff : ICON.volHigh);
        e.mute.dataset.icon = key;
      }
      e.mute.disabled = !canMute;           // no mute support -> plain icon, not clickable
      e.mute.title = canMute ? (muted ? "Unmute" : "Mute") : "Volume";
    }

    /** Called by the controller every tick with the current hass + collapsed flag. */
    update(hass, collapsed) {
      this._hass = hass;
      this._applyConfig();
      if (collapsed !== this._collapsed) {
        this._collapsed = collapsed;
        this.toggleAttribute("collapsed", collapsed);
      }
      this._render();
    }

    /** Reflect config that lives in CSS (accent colour, hover "x"). Cheap: only touches the DOM on change. */
    _applyConfig() {
      const accent = CFG.accent_color || "";
      if (this._accent !== accent) {
        this._accent = accent;
        if (accent) this.style.setProperty("--sidebar-mini-player-accent-color", accent);
        else this.style.removeProperty("--sidebar-mini-player-accent-color");
      }
      const noX = !CFG.show_dismiss_button;
      if (this.hasAttribute("no-dismiss-button") !== noX) this.toggleAttribute("no-dismiss-button", noX);
    }

    /** The entity currently displayed (respects manual cycling while it stays active). */
    _current(list) {
      if (!list.length) return null;
      const sel = this._selected && list.find((s) => s.entity_id === this._selected);
      if (!sel) this._selected = null; // the chosen player stopped -> back to auto
      return sel || list[0];
    }

    _render() {
      // Never re-render while a card is being
      // swiped (1 s tick / state updates could re-order, remove or re-fill the
      // card under the finger). end() unfreezes and renders. Capped by
      // SWIPE_MAX_HOLD_MS in case the gesture never finishes.
      if (this._swipeHoldUntil && Date.now() < this._swipeHoldUntil) return;
      this._swipeHoldUntil = 0;
      const hass = this._hass;
      // visiblePlayers = active minus long-paused
      // minus dismissed. Runs every 1 s tick, so timeouts apply without a state
      // update. Focus, stack, cap and badge all work off this filtered list.
      const list = hass ? visiblePlayers(hass) : [];
      const s = this._current(list);
      this.hidden = !s;                 // nothing playing/paused -> hide entirely
      if (!s) return;
      this._entity = s.entity_id;
      const a = s.attributes || {};
      const e = this._el;

      // Text
      // Video apps often have no title/artist -> app name (e.g. "Netflix")
      // as the main line, speaker name below; last resort the speaker name.
      const title = a.media_title || a.media_series_title || a.app_name || niceName(s);
      const artist = a.media_artist || a.media_album_artist || a.media_album_name || "";
      // Placeholder icon when there's no artwork: TV for TVs / video apps, else a note.
      const video = a.device_class === "tv" || /^(video|movie|tvshow|episode|channel)$/.test(a.media_content_type || "") ||
        (!a.media_title && !a.media_artist && !!a.app_name && a.app_id !== "music_assistant");
      const phKey = video ? "tv" : "music";
      if (this._el.ph.dataset.icon !== phKey) { this._el.ph.innerHTML = svg(ICON[phKey]); this._el.ph.dataset.icon = phKey; }
      const spk = niceName(s) + (s.state === "paused" ? " · paused" : "");
      if (e.title.textContent !== title) e.title.textContent = title;
      if (e.artist.textContent !== artist) e.artist.textContent = artist;
      e.artist.hidden = !artist;
      if (e.spk.textContent !== spk) e.spk.textContent = spk;
      e.wrap.title = `${niceName(s)}: ${artist ? artist + " – " : ""}${title}`; // tooltip (handy when collapsed)

      // Artwork (only touch src when it actually changes)
      const pic = artworkUrl(hass, s);
      if (pic !== this._lastPic) {
        this._lastPic = pic;
        if (pic) { e.img.src = pic; e.img.hidden = false; e.ph.hidden = true; }
        else { e.img.removeAttribute("src"); e.img.hidden = true; e.ph.hidden = false; }
      }

      // Play/pause icon
      // Use the optimistic state so the icon flips the instant it's tapped
      const ppKey = this._shownState(s);
      const ppIcon = svg(ppKey === "playing" ? ICON.pause : ICON.play);
      e.ppButtons.forEach((b) => { if (b.dataset.icon !== ppKey) { b.innerHTML = ppIcon; b.dataset.icon = ppKey; } });

      // Other active players as collapsed cards above; count badge for
      // the collapsed sidebar (CSS only shows it there).
      this._renderStack(list, s);
      e.badge.hidden = list.length < 2;
      if (!e.badge.hidden && e.badge.textContent !== String(list.length)) e.badge.textContent = String(list.length);

      // Volume row. Skipped in the collapsed sidebar (CSS hides it too).
      if (!this._collapsed) this._renderVolume(s);
      renderModes(e.wrap, s);

      // Progress bar
      const pos = currentPosition(s);
      e.bar.hidden = pos === null || !CFG.show_progress;
      if (pos !== null) e.barFill.style.width = ((pos / a.media_duration) * 100).toFixed(2) + "%";
    }

    /**
     * State to SHOW for play/pause. After a tap we show the expected state
     * until Home Assistant reports a change (last_changed moves) or
     * OPTIMISTIC_MS pass, so the button feels instant even when the speaker is slow.
     */
    _shownState(s) {
      const o = this._optimistic && this._optimistic[s.entity_id];
      if (!o) return s.state;
      if (s.last_changed !== o.from || Date.now() > o.until || s.state === o.state) {
        delete this._optimistic[s.entity_id];
        return s.state;
      }
      return o.state;
    }

    /** Run a button action. entityId = the mini card's player, or null = focused player. */
    _action(act, entityId = null) {
      const hass = this._hass;
      if (!hass) return;
      if (act === "more") { this._showAll = !this._showAll; this._render(); return; }
      // Focused player = from the VISIBLE list.
      const s = entityId ? hass.states[entityId] : this._current(visiblePlayers(hass));
      if (!s) return;
      const call = (service, data = {}) =>
        hass.callService("media_player", service, { entity_id: s.entity_id, ...data })
          .catch((err) => console.warn(`[${TAG}] ${service} failed`, err));
      switch (act) {
        case "playpause": {
          // Flip the icon immediately instead of waiting for the speaker to
          // report back (AirPlay / Music Assistant can take seconds).
          // Reverts after OPTIMISTIC_MS if the player never confirms.
          this._optimistic = this._optimistic || {};
          this._optimistic[s.entity_id] = {
            state: this._shownState(s) === "playing" ? "paused" : "playing",
            from: s.last_changed, until: Date.now() + OPTIMISTIC_MS,
          };
          this._render();
          call("media_play_pause");
          break;
        }
        case "dismiss": this._dismiss(s.entity_id); break; // hover "x"
        case "next": call("media_next_track"); break;
        case "prev": call("media_previous_track"); break;
        case "shuffle": call("shuffle_set", { shuffle: s.attributes.shuffle !== true }); break;
        case "repeat": { // off -> all -> one -> off
          const cur = s.attributes.repeat;
          call("repeat_set", { repeat: cur === "all" ? "one" : cur === "one" ? "off" : "all" });
          break;
        }
        case "mute": {
          if (!((Number(s.attributes.supported_features) || 0) & FEAT_VOLUME_MUTE)) return;
          hass.callService("media_player", "volume_mute", {
            entity_id: s.entity_id, is_volume_muted: !(s.attributes.is_volume_muted === true),
          }).catch((err) => console.warn(`[${TAG}] volume_mute failed`, err));
          break;
        }
      }
    }

    /**
     * Stack of collapsed cards. `list` is sorted most relevant first;
     * `focus` is the focused player. Shows up to max_collapsed_cards
     * (max_collapsed_cards_short_window in short windows) of the others,
     * most relevant NEAREST the focused card (so the
     * DOM order is reversed), plus a "+N more" / "Show less" row at the top.
     * Mini card nodes are reused per entity so hover state and images survive
     * the 1 s ticks; they're only re-ordered when the order actually changes.
     */
    _renderStack(list, focus) {
      const e = this._el;
      const others = list.filter((x) => x !== focus);
      const cap = this._shortMQ && this._shortMQ.matches ? CFG.max_collapsed_cards_short_window : CFG.max_collapsed_cards;
      if (others.length <= cap) this._showAll = false;
      const visible = this._showAll ? others : others.slice(0, cap);
      e.stack.hidden = others.length === 0;
      e.more.hidden = others.length <= cap;
      if (!e.more.hidden) {
        const txt = this._showAll ? "Show less" : `+${others.length - visible.length} more`;
        if (e.more.textContent !== txt) e.more.textContent = txt;
      }

      // Drop cards for players that are gone / focused / beyond the cap.
      const want = visible.slice().reverse(); // top -> bottom
      const keep = new Set(want.map((x) => x.entity_id));
      for (const [id, node] of this._miniNodes) {
        if (!keep.has(id)) { node.remove(); this._miniNodes.delete(id); }
      }
      // Create/update, then fix the order only if it changed.
      for (const st of want) {
        let node = this._miniNodes.get(st.entity_id);
        if (!node) { node = this._makeMini(st.entity_id); this._miniNodes.set(st.entity_id, node); }
        this._updateMini(node, st);
      }
      const current = [...e.minis.children].map((n) => n.dataset.entity).join("|");
      if (current !== want.map((x) => x.entity_id).join("|")) {
        for (const st of want) e.minis.appendChild(this._miniNodes.get(st.entity_id));
      }
    }

    /** Build one collapsed card (structure only; _updateMini fills it). */
    _makeMini(entityId) {
      const n = document.createElement("div");
      n.className = "mini";
      n.dataset.entity = entityId;
      n.innerHTML = `
        <div class="mrow">
          <div class="art"><img alt="" hidden draggable="false"><span class="ph"></span></div>
          <div class="mtext"><div class="title"></div><div class="spk"></div></div>
          <button class="mpp" data-act="playpause" title="Play/Pause"></button>
        </div>
        <div class="extra">
          <div class="artist"></div>
          <div class="controls">
            ${SHUFFLE_BTN}
            <button data-act="prev" title="Previous">${svg(ICON.prev)}</button>
            <button class="pp" data-act="playpause" title="Play/Pause"></button>
            <button data-act="next" title="Next">${svg(ICON.next)}</button>
            ${REPEAT_BTN}
          </div>
          <div class="bar" hidden><div></div></div>
        </div>`;
      const img = n.querySelector("img"), ph = n.querySelector(".ph");
      img.addEventListener("error", () => { img.hidden = true; ph.hidden = false; });
      // Hover preview: only on devices that really hover (not touch), and it
      // never changes focus. mouseenter/leave don't bubble -> per-card listeners.
      n.addEventListener("mouseenter", () => { if (this._hoverMQ && this._hoverMQ.matches) n.classList.add("hover"); });
      n.addEventListener("mouseleave", () => n.classList.remove("hover"));
      // Swipe right to dismiss this collapsed card too.
      this._wireSwipe(n, () => n.dataset.entity);
      return n;
    }

    /** Fill/refresh one collapsed card for stateObj st (only touches what changed). */
    _updateMini(n, st) {
      const a = st.attributes || {};
      const set = (sel, txt) => { const el = n.querySelector(sel); if (el.textContent !== txt) el.textContent = txt; return el; };
      const title = a.media_title || a.media_series_title || a.app_name || niceName(st);
      const artist = a.media_artist || a.media_album_artist || a.media_album_name || "";
      set(".title", title);
      set(".spk", niceName(st) + (st.state === "paused" ? " · paused" : ""));
      set(".extra .artist", artist).hidden = !artist;
      n.title = `${niceName(st)}: ${artist ? artist + " – " : ""}${title} (click to focus)`;
      // artwork / placeholder
      const img = n.querySelector("img"), ph = n.querySelector(".ph");
      const pic = artworkUrl(this._hass, st);
      if ((n.dataset.pic || "") !== (pic || "")) {
        n.dataset.pic = pic || "";
        if (pic) { img.src = pic; img.hidden = false; ph.hidden = true; }
        else { img.removeAttribute("src"); img.hidden = true; ph.hidden = false; }
      }
      const video = a.device_class === "tv" || (!a.media_title && !a.media_artist && !!a.app_name && a.app_id !== "music_assistant");
      const phKey = video ? "tv" : "music";
      if (ph.dataset.icon !== phKey) { ph.innerHTML = svg(ICON[phKey]); ph.dataset.icon = phKey; }
      // play/pause icons (slim button + the one in the hover controls)
      n.querySelectorAll('[data-act="playpause"]').forEach((b) => {
        const shown = this._shownState(st); // optimistic
        if (b.dataset.icon !== shown) { b.innerHTML = svg(shown === "playing" ? ICON.pause : ICON.play); b.dataset.icon = shown; }
      });
      // progress (visible in the hover preview)
      renderModes(n, st);
      const pos = currentPosition(st), bar = n.querySelector(".bar");
      bar.hidden = pos === null || !CFG.show_progress;
      if (pos !== null) bar.firstElementChild.style.width = ((pos / a.media_duration) * 100).toFixed(2) + "%";
    }

    /** Open HA's standard more-info dialog for the displayed player. */
    _openMoreInfo() {
      if (!this._entity) return;
      const target = document.querySelector("home-assistant") || this;
      target.dispatchEvent(new CustomEvent("hass-more-info", {
        detail: { entityId: this._entity }, bubbles: true, composed: true,
      }));
    }
  }
  if (!customElements.get(TAG)) customElements.define(TAG, SidebarMiniPlayer);

  // --------------------------------------------------------------------------
  // Controller: finds hass + the sidebar, injects the player, keeps it updated.
  // --------------------------------------------------------------------------
  let player = null;          // our <sidebar-mini-player> element
  let sidebar = null;         // the <ha-sidebar> we injected into
  let observer = null;        // MutationObserver on the sidebar's shadowRoot
  let lastHass = null;        // last hass object reference seen
  let injectQueued = false;

  /** Bounded deep search through shadow roots (fallback only - normally not needed). */
  function deepFind(root, selector, depth = 0) {
    if (!root || depth > 6) return null;
    const hit = root.querySelector && root.querySelector(selector);
    if (hit) return hit;
    const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of all) {
      if (el.shadowRoot) {
        const r = deepFind(el.shadowRoot, selector, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  function getHaRoot() { return document.querySelector("home-assistant"); }

  /** Locate <ha-sidebar> via the known paths, then a bounded deep search. */
  function findSidebar() {
    const ha = getHaRoot();
    const main = ha && ha.shadowRoot && ha.shadowRoot.querySelector("home-assistant-main");
    const mroot = main && main.shadowRoot;
    if (!mroot) return null;
    const drawer = mroot.querySelector("ha-drawer");
    return (
      (drawer && drawer.querySelector("ha-sidebar")) ||                               // 2023+ (slotted)
      mroot.querySelector("ha-sidebar") ||                                            // flat layout
      (drawer && drawer.shadowRoot && drawer.shadowRoot.querySelector("ha-sidebar")) || // inside drawer shadow
      deepFind(mroot, "ha-sidebar")
    );
  }

  /** Read hass from <home-assistant> (fallback: home-assistant-main). */
  function getHass() {
    const ha = getHaRoot();
    if (!ha) return null;
    if (ha.hass && ha.hass.states) return ha.hass;
    const main = ha.shadowRoot && ha.shadowRoot.querySelector("home-assistant-main");
    return main && main.hass && main.hass.states ? main.hass : null;
  }

  // Selectors for the bottom items. Order inside each string doesn't matter.
  // Home Assistant 2026.x uses ha-list-item-button with ids; older builds used
  // ha-md-list-item / paper-icon-item / <a> with href or data-panel.
  const SEL_SETTINGS =
    "#sidebar-config, .configuration, [href='/config'], [data-panel='config']";
  const SEL_NOTIFICATIONS =
    "#sidebar-notifications, .notifications, .notifications-container";
  const SEL_PROFILE = "#sidebar-profile, .user, .profile, [href='/profile']";

  /** Is el a scrolling container (only true for the OLD single-list layout)? */
  function isScroller(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.classList.contains("ha-scrollbar")) return true;
    const oy = getComputedStyle(el).overflowY;
    return oy === "auto" || oy === "scroll";
  }

  /** Parent across shadow boundaries (shadowRoot -> its host). Slotted light-DOM
   *  nodes already have the slotting element (e.g. ha-list-nav) as parentNode. */
  function parentAcross(node) {
    if (!node) return null;
    if (node.parentNode && node.parentNode.nodeType === 11 && node.parentNode.host) {
      return node.parentNode; // a ShadowRoot - caller decides whether to hop to host
    }
    return node.parentNode || (node.host || null);
  }

  /** Climb from el (possibly deep in nested shadow roots) to the ancestor whose
   *  parent is `container`. Returns null if container isn't an ancestor. */
  function climbTo(el, container) {
    let n = el, guard = 0;
    while (n && guard++ < 50) {
      const par = parentAcross(n);
      if (par === container) return n;
      n = par && par.nodeType === 11 && par !== container ? par.host : par;
    }
    return null;
  }

  /**
   * One small style block in the sidebar's shadowRoot: keeps the player from
   * shrinking and lets the panel list's flex item shrink (min-height:0) so on
   * short windows the panels scroll instead of overlapping us. Marked via a data
   * attribute Lit doesn't manage. Removing the module removes this too.
   */
  function ensureLayoutStyle(sr) {
    if (!sr.getElementById("sidebar-mini-player-layout")) {
      const st = document.createElement("style");
      st.id = "sidebar-mini-player-layout";
      st.textContent =
        "/* added by sidebar-mini-player v" + VERSION + " */\n" +
        "[data-smp-scroll] { min-height: 0 !important; }\n" +
        TAG + " { flex: 0 0 auto; }";
      sr.appendChild(st);
    }
    // 2026.x: the shrinking flex item is .panels-list > .wrapper; older: .ha-scrollbar.
    const list = sr.querySelector(".panels-list > .wrapper") || sr.querySelector(".ha-scrollbar");
    if (list && !list.hasAttribute("data-smp-scroll")) list.setAttribute("data-smp-scroll", "");
  }

  /** Where the player should go: { parent, before } (before=null -> append). */
  function targetSpot(sr) {
    const panels = sr.querySelector(".panels-list");

    // position: "top" -> first thing in the panel list (just below the header).
    // Falls back to the bottom placement below if the layout is unknown.
    if (CFG.position === "top") {
      if (panels) return { parent: panels, before: panels.firstElementChild };
      const menu = sr.querySelector(".menu");
      if (menu && menu.parentNode) return { parent: menu.parentNode, before: menu.nextElementSibling };
    }

    // 1) Normal 2026.x case: just before the bottom list (Settings/Notifications/Profile).
    const after = sr.querySelector(".panels-list > .after-spacer");
    if (after) return { parent: after.parentNode, before: after };

    // 2/3) Settings, then Notifications, then Profile - searched deep (they may sit
    // in ha-list-nav's light DOM via a <slot>, or inside its shadowRoot).
    for (const sel of [SEL_SETTINGS, SEL_NOTIFICATIONS, SEL_PROFILE]) {
      const item = deepFind(sr, sel);
      if (!item) continue;
      if (panels) {
        const top = climbTo(item, panels);
        if (top) return { parent: panels, before: top };
        continue; // found but not under .panels-list (odd) -> try next anchor
      }
      // Older HA (no .panels-list): right before the item, in the light DOM we can
      // reach from sr (never inside another component's shadowRoot).
      if (item.getRootNode() === sr) return { parent: item.parentNode, before: item };
      const top = climbTo(item, sr);
      if (top) return { parent: sr, before: top };
    }

    // 4) End of the panel list. 5) End of the sidebar. Never the top.
    if (panels) return { parent: panels, before: null };
    return { parent: sr, before: null };
  }

  /** True if the player is already exactly where targetSpot() wants it. */
  function inRightSpot(sr) {
    if (!player || !player.isConnected || player.getRootNode() !== sr) return false;
    const t = targetSpot(sr);
    if (t.before === player) return true;
    if (t.before) return player.parentNode === t.parent && player.nextElementSibling === t.before;
    return player.parentNode === t.parent; // append fallback: anywhere in that parent is fine
  }

  /** Insert/move the player into place in sidebar sb. */
  function inject(sb) {
    const sr = sb.shadowRoot;
    if (!sr) return false;
    if (!player) player = document.createElement(TAG);

    ensureLayoutStyle(sr);
    if (!inRightSpot(sr)) {
      const t = targetSpot(sr);
      t.parent.insertBefore(player, t.before);
    }
    // Inside the scrolling list -> sticky to its bottom edge (see :host([in-list]) CSS).
    player.toggleAttribute("in-list", player.parentNode !== sr && isScroller(player.parentNode));

    // Watch the sidebar for re-renders that remove or displace us (Lit may clear
    // or re-create nodes). Only re-inject when we're actually in the wrong spot,
    // so our own insert doesn't loop.
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      if (!inRightSpot(sr)) scheduleInject();
    });
    observer.observe(sr, { childList: true, subtree: true });
    sidebar = sb;
    return true;
  }

  function scheduleInject() {
    if (injectQueued) return;
    injectQueued = true;
    requestAnimationFrame(() => { injectQueued = false; ensureInjected(); });
  }

  /** Make sure the player lives in the CURRENT sidebar (it can be replaced). */
  function ensureInjected() {
    const sb = findSidebar();
    if (!sb || !sb.shadowRoot) return false;
    if (sidebar === sb && inRightSpot(sb.shadowRoot)) return true;
    return inject(sb);
  }

  /** Collapsed = docked icons-only sidebar. Measured, so it also works in the mobile drawer. */
  function isCollapsed(sb) {
    const w = sb.getBoundingClientRect().width;
    if (w > 0) return w < COLLAPSED_MAX_WIDTH;
    return !sb.hasAttribute("expanded") && !sb.alwaysExpand; // not laid out yet: best guess
  }

  /** Main loop: cheap - a reference compare plus a few DOM reads per second. */
  function tick() {
    try {
      if (refreshConfig() && player && sidebar && sidebar.shadowRoot && !inRightSpot(sidebar.shadowRoot)) {
        inject(sidebar); // position changed
      }
      const hass = getHass();
      if (!hass) return;
      if (!ensureInjected()) return;
      // Re-render on every tick: hass changes (reference compare is implicit -
      // render is diff-based) AND the progress bar needs a 1 s tick while playing.
      lastHass = hass;
      player.update(hass, isCollapsed(sidebar));
    } catch (err) {
      console.warn(`[${TAG}] tick error`, err);
    }
  }

  // Also react instantly to sidebar width changes (collapse/expand toggle).
  const ro = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => { if (player && sidebar && lastHass) player.update(lastHass, isCollapsed(sidebar)); })
    : null;
  let roTarget = null;
  setInterval(() => {
    tick();
    if (ro && sidebar && roTarget !== sidebar) { if (roTarget) ro.unobserve(roTarget); ro.observe(sidebar); roTarget = sidebar; }
  }, TICK_MS);
  tick();

  console.info(`%c SIDEBAR-MINI-PLAYER %c v${VERSION} `,
    "color:#fff;background:#03a9f4;font-weight:700", "color:#03a9f4");
})();
