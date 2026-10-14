// test/test.js - offline test suite for ha-sidebar-mini-player.js. Run with `npm test`.
//
// Uses jsdom (no real layout or painting) with a mocked Home Assistant frontend:
// <home-assistant> > <home-assistant-main> > <ha-drawer> > <ha-sidebar>, in several
// sidebar layouts (older single-list layouts and the real 2026.x tree), plus a
// synthetic media_player state fixture (test/fixtures/media_players.json: made-up
// entities, no real install data). Timing-based: the module ticks every second, so
// the whole suite takes about a minute.
//
// Sections: L* legacy layouts, R* real 2026.x sidebar tree, V3 discovery + dedupe +
// stacked cards, V5 paused timeout + swipe/x dismiss, T51 touch (iOS) swipe path,
// C* user configuration (window.sidebarMiniPlayerConfig), P* packaging and loading.
"use strict";
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "ha-sidebar-mini-player.js"), "utf8");
const FIXTURE = path.join(__dirname, "fixtures", "media_players.json");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const order = (root) => [...root.children].map((e) =>
  e.tagName.toLowerCase() + (e.className ? "." + String(e.className).split(" ")[0] : "") +
  (e.getAttribute("href") ? `[${e.getAttribute("href")}]` : "")).join(" | ");
let fails = 0;
const check = (name, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  -> " + extra : ""}`); };

// Real Home Assistant 2026.10 sidebar tree (as seen in DevTools). mode: "light" = items are light-DOM
// children of ha-list-nav projected via <slot>; "shadow" = items inside ha-list-nav's shadowRoot.
function real2026(mode, { afterClass = true, bottomItems = true } = {}) {
  return (d, sr) => {
    sr.innerHTML = `<card-mod slot="none"></card-mod>
      <div class="menu"><ha-icon-button></ha-icon-button><div class="title">Home Assistant</div></div>
      <div class="panels-list">
        <div class="wrapper">
          <ha-list-nav class="ha-scrollbar before-spacer"></ha-list-nav>
          <div class="fade-top"></div><div class="fade-bottom"></div>
        </div>
        <div class="spacer"></div>
        <ha-list-nav class="${afterClass ? "after-spacer" : "bottom-x"}"></ha-list-nav>
      </div>`;
    const before = sr.querySelector(".before-spacer");
    before.attachShadow({ mode: "open" }).innerHTML = "<slot></slot>";
    for (const id of ["lovelace", "energy", "map", "logbook", "history", "media-browser"]) {
      const b = d.createElement("ha-list-item-button"); b.id = "sidebar-panel-" + id; b.textContent = id; before.appendChild(b);
    }
    const nav = sr.querySelector(".panels-list > ha-list-nav:not(.before-spacer)");
    const nsr = nav.attachShadow({ mode: "open" });
    nsr.innerHTML = mode === "light" ? "<div class='list'><slot></slot></div>" : "<div class='list'></div>";
    if (!bottomItems) return;
    const host = mode === "light" ? nav : nsr.querySelector(".list");
    host.innerHTML = `<ha-list-item-button id="sidebar-config" class="configuration" href="/config">Settings</ha-list-item-button>
      <ha-list-item-button id="sidebar-notifications" class="notifications">Notifications</ha-list-item-button>
      <ha-list-item-button id="sidebar-profile" class="user" href="/profile">User</ha-list-item-button>`;
  };
}

// Sidebar layouts to test.
const LAYOUTS = {
  // Current HA style: Settings inside the scrolling list after a spacer.
  settingsInList: `<div class="menu">Home Assistant</div>
    <ha-md-list class="ha-scrollbar"><ha-md-list-item href="/lovelace">Overview</ha-md-list-item><ha-md-list-item href="/energy">Energy</ha-md-list-item><div class="spacer"></div><ha-md-list-item href="/developer-tools">Developer tools</ha-md-list-item><ha-md-list-item href="/config">Settings</ha-md-list-item></ha-md-list>
    <div class="divider"></div><ha-md-list-item class="notifications">Notifications</ha-md-list-item><ha-md-list-item class="user" href="/profile">User</ha-md-list-item>`,
  // Settings as a top-level item below the list.
  settingsTop: `<div class="menu">Home Assistant</div>
    <ha-md-list class="ha-scrollbar"><ha-md-list-item href="/lovelace">Overview</ha-md-list-item></ha-md-list>
    <div class="divider"></div><ha-md-list-item href="/config">Settings</ha-md-list-item><ha-md-list-item class="notifications">Notifications</ha-md-list-item><ha-md-list-item class="user" href="/profile">User</ha-md-list-item>`,
  // No Settings item (e.g. non-admin) -> fallback above Notifications.
  noSettings: `<div class="menu">Home Assistant</div>
    <ha-md-list class="ha-scrollbar"><ha-md-list-item href="/lovelace">Overview</ha-md-list-item></ha-md-list>
    <div class="spacer"></div><div class="divider"></div><ha-md-list-item class="notifications">Notifications</ha-md-list-item><ha-md-list-item class="user" href="/profile">User</ha-md-list-item>`,
};

// opts.states = use this exact states object (deep-copied) instead of the fixture (for the "reload"
// test); opts.storage = localStorage entries to pre-seed (simulates a page reload);
// opts.config = window.sidebarMiniPlayerConfig to define BEFORE the module loads;
// opts.evalFirst = load the module before the Home Assistant DOM exists (extra_module_url timing);
// opts.warnings = array that collects console.warn messages from the page.
function setup(layoutHtml, statesFile = FIXTURE, prep = null, opts = {}) {
  const dom = new JSDOM(`<!doctype html><body></body>`, { url: "https://homeassistant.local:8123/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  if (opts.storage) for (const [k, v] of Object.entries(opts.storage)) w.localStorage.setItem(k, v);
  if (opts.config !== undefined) w.sidebarMiniPlayerConfig = opts.config;
  if (opts.warnings) { const wc = w.console; w.console = Object.assign(Object.create(wc), { warn: (...a) => opts.warnings.push(a.join(" ")), info() {} }); }
  // matchMedia mock (jsdom has none): tests flip w.__mq["(hover: hover)"] / ["(max-height: 560px)"].
  w.__mq = {};
  w.matchMedia = (q) => ({ media: q, get matches() { return !!w.__mq[q]; }, addEventListener() {}, removeEventListener() {} });
  if (opts.evalFirst) w.eval(SRC); // extra_module_url can run before <home-assistant> exists
  const states = opts.states ? JSON.parse(JSON.stringify(opts.states)) : JSON.parse(fs.readFileSync(statesFile));
  if (prep) prep(states);
  else {
    // Default scenario: exactly office playing + kitchen_2 paused (auto-discovery
    // would otherwise pick up anything else active in the fixture).
    for (const k of Object.keys(states)) if (k !== "media_player.office" && ["playing", "paused"].includes(states[k].state)) states[k].state = "idle";
    states["media_player.office"].state = "playing";
    states["media_player.kitchen_2"].state = "paused";          // fake a 2nd active player
    states["media_player.kitchen_2"].last_changed = new Date().toISOString();
  }
  // Pad with ~2,900 non-media entities like a large real install (scan-cost realism).
  for (let i = 0; Object.keys(states).length < 2943; i++) states["sensor.fake_" + i] = { entity_id: "sensor.fake_" + i, state: "1", attributes: {}, last_changed: "2026-10-10T00:00:00Z" };
  const calls = [];
  const hass = { states, hassUrl: (p) => "https://homeassistant.local:8123" + p,
    callService: (dm, svc, data) => { calls.push([dm, svc, JSON.stringify(data)]); return Promise.resolve(); } };
  const ha = d.createElement("home-assistant"); d.body.appendChild(ha); ha.hass = hass;
  const main = d.createElement("home-assistant-main"); ha.attachShadow({ mode: "open" }).appendChild(main);
  const drawer = d.createElement("ha-drawer"); main.attachShadow({ mode: "open" }).appendChild(drawer);
  const makeSidebar = () => { const sb = d.createElement("ha-sidebar"); const sr = sb.attachShadow({ mode: "open" });
    if (typeof layoutHtml === "function") layoutHtml(d, sr); else sr.innerHTML = layoutHtml; return sb; };
  let sb = makeSidebar(); drawer.appendChild(sb);
  if (!opts.evalFirst) w.eval(SRC);
  return { w, d, ha, drawer, hass, states, calls, makeSidebar, get sb() { return sb; }, set sb(v) { sb = v; } };
}

(async () => {
  // ---------- Layout 1: Settings inside the scrolling list (main case) ----------
  let t = setup(LAYOUTS.settingsInList);
  await sleep(100);
  let sr = t.sb.shadowRoot, p = sr.querySelector("sidebar-mini-player");
  const list = sr.querySelector(".ha-scrollbar");
  console.log("  list order:", order(list));
  check("L1 placed directly above Settings (inside list)", p && p.nextElementSibling && p.nextElementSibling.getAttribute("href") === "/config");
  check("L1 sticky in-list attribute set", p.hasAttribute("in-list"));
  check("L1 layout style + data-smp-scroll", !!sr.getElementById("sidebar-mini-player-layout") && list.hasAttribute("data-smp-scroll"));
  // focused-card selectors are scoped to .focus (mini cards also have .title etc.)
  const q = (s) => p.shadowRoot.querySelector(".focus " + s) || p.shadowRoot.querySelector(s);
  check("L1 content", q(".title").textContent === "Example Track" && q(".spk").textContent === "Office", `${q(".title").textContent} / ${q(".artist").textContent} / ${q(".spk").textContent}`);

  // Volume: jsdom width 0 -> collapsed guess; force expanded by giving the sidebar an expanded attr + width.
  t.sb.setAttribute("expanded", "");
  t.sb.getBoundingClientRect = () => ({ width: 256, height: 800 });
  await sleep(1100);
  check("L1 expanded (not collapsed)", !p.hasAttribute("collapsed"));
  const vol0 = t.states["media_player.office"].attributes.volume_level;
  check("L1 volume row shown, slider = volume_level*100", !q(".vol").hidden && q(".vol input").value === String(Math.round(vol0 * 100)), `slider=${q(".vol input").value} level=${vol0}`);
  check("L1 mute enabled (feature bit 8)", !q(".vol .mute").disabled);

  // Drag simulation: 5 rapid input events -> exactly 1 debounced volume_set.
  const sl = q(".vol input");
  sl.dispatchEvent(new t.w.Event("pointerdown"));
  for (const v of [80, 70, 60, 50, 40]) { sl.value = String(v); sl.dispatchEvent(new t.w.Event("input")); await sleep(40); }
  // Meanwhile HA pushes a stale state (still 0.9) - slider must not jump back.
  t.ha.hass = { ...t.hass, states: { ...t.states } };
  await sleep(1050);
  check("L1 slider not overwritten while dragging", sl.value === "40", `value=${sl.value}`);
  check("L1 track fill follows drag (--smp-fill 40%)", sl.style.getPropertyValue("--smp-fill") === "40%", sl.style.getPropertyValue("--smp-fill"));
  await sleep(300);
  const vs = t.calls.filter((c) => c[1] === "volume_set");
  check("L1 debounced: one volume_set with 0.4", vs.length === 1 && JSON.parse(vs[0][2]).volume_level === 0.4, JSON.stringify(vs));
  sl.dispatchEvent(new t.w.Event("pointerup"));
  q('[data-act="mute"]').click();
  const mu = t.calls.find((c) => c[1] === "volume_mute");
  check("L1 mute toggle call", !!mu && JSON.parse(mu[2]).is_volume_muted === true, mu && mu[2]);
  // After hold expires, incoming state wins again.
  t.states["media_player.office"] = { ...t.states["media_player.office"], attributes: { ...t.states["media_player.office"].attributes, volume_level: 0.25 } };
  t.ha.hass = { ...t.hass, states: t.states };   // HA hands over a new hass object on each update
  await sleep(2600);
  check("L1 slider follows state after hold", sl.value === "25", `value=${sl.value}`);
  check("L1 track fill follows state (--smp-fill 25%)", sl.style.getPropertyValue("--smp-fill") === "25%", sl.style.getPropertyValue("--smp-fill"));
  const css = p.shadowRoot.querySelector("style").textContent;
  check("L1 slider CSS: appearance none + 12px thumbs (webkit+moz) + 4px track",
    /-webkit-appearance: none/.test(css) && /::-webkit-slider-thumb[^}]*width: 12px/.test(css) && /::-moz-range-thumb[^}]*width: 12px/.test(css) && /::-webkit-slider-runnable-track[^}]*height: 4px/.test(css));

  // Collapsed sidebar: volume row hidden by CSS attr; transport controls hidden.
  t.sb.getBoundingClientRect = () => ({ width: 56, height: 800 });
  await sleep(1100);
  check("L1 collapsed attr when 56px wide", p.hasAttribute("collapsed"));

  // Controls + more-info still work.
  t.calls.length = 0;
  q('.controls [data-act="playpause"]').click(); q('[data-act="next"]').click(); q('[data-act="prev"]').click();
  check("L1 transport calls", t.calls.map((c) => c[1]).join(",") === "media_play_pause,media_next_track,media_previous_track");
  // stacked cards (back to an expanded sidebar)
  t.sb.getBoundingClientRect = () => ({ width: 256, height: 800 });
  await sleep(1100);
  const R = p.shadowRoot;
  const focusKids = [...R.querySelector(".focus").children].map((c) => c.className).filter((c) => c !== "dismiss"); // ignore the hover "x" (absolutely positioned)
  check("L1 focused card order: row, controls, bar, vol", focusKids.join(",") === "row,controls,bar,vol", focusKids.join(","));
  check("L1 no pagination (no .dots/.cycle)", !R.querySelector(".dots, .cycle"));
  let minis = [...R.querySelectorAll(".mini")];
  check("L1 one collapsed card above focus (kitchen_2)", minis.length === 1 && minis[0].dataset.entity === "media_player.kitchen_2" && !R.querySelector(".stack").hidden);
  check("L1 stack is above focused card in DOM", R.querySelector(".stack").nextElementSibling === R.querySelector(".focus"));
  check("L1 mini shows title + speaker", minis[0].querySelector(".title").textContent === "Radio Station One" && minis[0].querySelector(".spk").textContent === "Kitchen · paused",
    minis[0].querySelector(".title").textContent + " / " + minis[0].querySelector(".spk").textContent);
  t.calls.length = 0;
  minis[0].querySelector(".mpp").click();
  check("L1 mini play/pause acts on ITS player, focus unchanged",
    t.calls.length === 1 && t.calls[0][1] === "media_play_pause" && t.calls[0][2].includes("kitchen_2") && q(".spk").textContent === "Office", JSON.stringify(t.calls));
  // Hover: ignored without (hover: hover); with it, expands in place, focus unchanged.
  minis[0].dispatchEvent(new t.w.Event("mouseenter"));
  check("L1 no hover-expand on touch devices", !minis[0].classList.contains("hover"));
  t.w.__mq["(hover: hover)"] = true;
  minis[0].dispatchEvent(new t.w.Event("mouseenter")); await sleep(1100);
  check("L1 hover expands in place (survives a tick), focus unchanged", minis[0].classList.contains("hover") && q(".spk").textContent === "Office");
  minis[0].dispatchEvent(new t.w.Event("mouseleave"));
  check("L1 mouseleave collapses again", !minis[0].classList.contains("hover"));
  // Click the card body -> it becomes the focused one; Office becomes a mini.
  minis[0].querySelector(".mtext").click();
  minis = [...R.querySelectorAll(".mini")];
  check("L1 click mini -> focus it, old focus becomes mini", q(".spk").textContent === "Kitchen · paused" && minis.length === 1 && minis[0].dataset.entity === "media_player.office");
  await sleep(1100);
  check("L1 click choice sticks across ticks", q(".spk").textContent === "Kitchen · paused");
  // Collapsed sidebar: count badge.
  t.sb.getBoundingClientRect = () => ({ width: 56, height: 800 }); await sleep(1100);
  check("L1 collapsed: badge '2'", !q(".badge").hidden && q(".badge").textContent === "2");
  let mi = null; t.ha.addEventListener("hass-more-info", (e) => (mi = e.detail.entityId)); q(".title").click();
  check("L1 more-info", mi === "media_player.kitchen_2");

  // Lit-style re-render: Settings item replaced -> player must follow to new Settings.
  const oldSettings = list.querySelector("[href='/config']");
  const newSettings = t.d.createElement("ha-md-list-item"); newSettings.setAttribute("href", "/config"); newSettings.textContent = "Settings";
  oldSettings.replaceWith(newSettings);
  p.remove(); list.appendChild(p); // also displace the player
  await sleep(200);
  check("L1 re-injected above new Settings after re-render", p.nextElementSibling === newSettings);
  // Whole sidebar replaced.
  t.sb.remove(); t.sb = t.makeSidebar(); t.drawer.appendChild(t.sb); await sleep(1200);
  check("L1 moved into replacement sidebar", !!t.sb.shadowRoot.querySelector("sidebar-mini-player"));
  // Nothing playing -> hidden.
  const st2 = JSON.parse(JSON.stringify(t.states));
  for (const k of Object.keys(st2)) if (st2[k].state === "playing" || st2[k].state === "paused") st2[k].state = "idle";
  t.ha.hass = { ...t.hass, states: st2 }; await sleep(1200);
  check("L1 hidden when nothing playing", t.sb.shadowRoot.querySelector("sidebar-mini-player").hidden);
  t.w.close();

  // ---------- Layout 2: Settings top-level ----------
  t = setup(LAYOUTS.settingsTop); await sleep(100);
  sr = t.sb.shadowRoot; p = sr.querySelector("sidebar-mini-player");
  console.log("  L2 order:", order(sr));
  check("L2 above top-level Settings, not sticky", p.parentNode === sr && p.nextElementSibling.getAttribute("href") === "/config" && !p.hasAttribute("in-list"));
  t.w.close();

  // ---------- Layout 3: no Settings -> above Notifications/divider ----------
  t = setup(LAYOUTS.noSettings); await sleep(100);
  sr = t.sb.shadowRoot; p = sr.querySelector("sidebar-mini-player");
  console.log("  L3 order:", order(sr));
  // legacy layout without Settings -> directly before Notifications (never the top).
  check("L3 legacy fallback directly before Notifications", p.nextElementSibling.classList.contains("notifications"));
  t.w.close();

  // ---------- R: real Home Assistant 2026.10 sidebar trees ----------
  const expectSpot = (name, sr, beforeSel) => {
    const pl = sr.querySelector(".panels-list"), p = sr.querySelector("sidebar-mini-player");
    console.log(`  ${name} order (sr):`, order(sr), "\n  .panels-list:", order(pl));
    check(`${name} NOT at top (not a direct child of sr)`, p && p.parentNode !== sr);
    check(`${name} inside .panels-list`, p && p.parentNode === pl);
    if (beforeSel) check(`${name} directly before ${beforeSel}`, p.nextElementSibling && p.nextElementSibling.matches(beforeSel));
    else check(`${name} last element of .panels-list`, pl.lastElementChild === p);
    check(`${name} after div.spacer`, !!p.previousElementSibling && p.previousElementSibling.matches(".spacer, .wrapper, ha-list-nav"));
    check(`${name} wrapper marked min-height:0`, sr.querySelector(".panels-list > .wrapper").hasAttribute("data-smp-scroll"));
    check(`${name} not sticky`, !p.hasAttribute("in-list"));
  };
  for (const [name, layout, sel] of [
    ["R1 2026.10 light-DOM items", real2026("light"), "ha-list-nav.after-spacer"],
    ["R2 2026.10 shadow-DOM items", real2026("shadow"), "ha-list-nav.after-spacer"],
    ["R3 no .after-spacer, light (climb from #sidebar-config)", real2026("light", { afterClass: false }), "ha-list-nav.bottom-x"],
    ["R4 no .after-spacer, shadow (climb across shadow root)", real2026("shadow", { afterClass: false }), "ha-list-nav.bottom-x"],
    ["R5 no anchors at all -> end of .panels-list", real2026("light", { afterClass: false, bottomItems: false }), null],
  ]) {
    t = setup(layout); await sleep(100);
    expectSpot(name, t.sb.shadowRoot, sel);
    // Lit-style re-render: bottom nav re-created -> player follows.
    if (sel) {
      const pl = t.sb.shadowRoot.querySelector(".panels-list"), old = pl.querySelector(sel);
      const fresh = old.cloneNode(false); old.replaceWith(fresh);
      await sleep(150);
      check(`${name} follows re-created bottom nav`, t.sb.shadowRoot.querySelector("sidebar-mini-player").nextElementSibling === fresh);
    }
    t.w.close();
  }

  // ---------- V3: auto-discovery, dedupe, video apps, stacked cards ----------
  {
    const t3 = setup(real2026("light"), FIXTURE, (st) => {
      // Fixture: office (MA) playing music, lounge_tv (Apple TV) playing Netflix.
      // Add duplicates the dedupe must hide + another MA player (bedroom).
      const lk = st["media_player.kitchen"], lk2 = st["media_player.kitchen_2"], em = st["media_player.bedroom"];
      lk2.state = "playing"; lk2.last_changed = "2026-10-10T16:30:00Z";            // MA, "Radio Station One"
      lk.state = "playing"; lk.last_changed = "2026-10-10T16:30:01Z";               // native twin, same name
      lk.attributes = { ...lk.attributes, media_title: "Something else" };
      const liv = st["media_player.living_room"];                                         // native, same TITLE as MA office
      liv.state = "playing"; liv.last_changed = "2026-10-10T16:30:02Z";
      liv.attributes = { ...liv.attributes, friendly_name: "Living Native", media_title: st["media_player.office"].attributes.media_title };
      em.state = "paused"; em.last_changed = new Date(Date.now() - 3 * 60000).toISOString(); // < 5 min, else auto-hidden
      st["media_player.browser_mod_0000abcd_0000ef89"].state = "off";
    });
    t3.sb.setAttribute("expanded", ""); t3.sb.getBoundingClientRect = () => ({ width: 256, height: 800 });
    await sleep(1200);
    const p3 = t3.sb.shadowRoot.querySelector("sidebar-mini-player"), R3 = p3.shadowRoot;
    const q3 = (x) => R3.querySelector(".focus " + x) || R3.querySelector(x);
    // Collect: focused card first, then collapsed cards from nearest (bottom) to top.
    const desc = (root) => `${root.querySelector(".spk").textContent} :: ${root.querySelector(".title").textContent}${root.querySelector(".artist").textContent ? " / " + root.querySelector(".artist").textContent : ""} [ph=${root.querySelector(".ph").dataset.icon}, img=${!root.querySelector(".art img").hidden}]`;
    const seen = [desc(R3.querySelector(".focus")), ...[...R3.querySelectorAll(".mini")].reverse().map(desc)];
    const n = seen.length;
    console.log("  active (focused first, then collapsed cards nearest-first):\n    " + seen.join("\n    "));
    check("V3 four players after dedupe (office, tv, kitchen_2, bedroom)", n === 4, `n=${n}`);
    check("V3 native twin kitchen (same name) hidden", !seen.some((x) => x.startsWith("Kitchen ::") && x.includes("Something else")));
    check("V3 native player with same title as MA hidden", !seen.some((x) => x.startsWith("Living Native")));
    check("V3 bedroom (another MA player) discovered", seen.some((x) => x.startsWith("Bedroom")));
    const tvSeen = seen.find((x) => x.startsWith("Lounge TV"));
    check("V3 Apple TV Netflix: title=Netflix, speaker=Lounge TV, TV icon, no img", !!tvSeen && tvSeen.includes(":: Netflix") && tvSeen.includes("ph=tv") && tvSeen.includes("img=false"), tvSeen);
    check("V3 first shown = most recently changed playing (office)", seen[0].startsWith("Office"), seen[0]);
    // Cheap scan: time 1000 activePlayer passes via renders.
    const t0 = Date.now(); for (let i = 0; i < 1000; i++) p3.update(t3.ha.hass, false); const ms = Date.now() - t0;
    check("V3 1000 renders with 2,943 entities < 1500 ms (jsdom)", ms < 1500, `${ms} ms`);
    // New entity appears (key count changes) -> picked up.
    const st = { ...t3.ha.hass.states, "media_player.new_speaker": { entity_id: "media_player.new_speaker", state: "playing", last_changed: new Date().toISOString(), attributes: { friendly_name: "New Speaker", media_title: "Hello" } } };
    t3.ha.hass = { ...t3.hass, states: st }; await sleep(1200);
    // New Speaker is now the most recent playing -> auto focus (no click choice made in this run).
    check("V3 newly added entity discovered + auto-focused (5 active)", q3(".spk").textContent === "New Speaker" && R3.querySelectorAll(".mini").length === 4,
      `${q3(".spk").textContent}, minis=${R3.querySelectorAll(".mini").length}`);
    // Cap: add 3 more -> 8 active, 7 others -> 4 cards + "+3 more" at the top.
    const st4 = { ...t3.ha.hass.states };
    for (const k of ["a", "b", "c"]) st4["media_player.extra_" + k] = { entity_id: "media_player.extra_" + k, state: "paused", last_changed: new Date(Date.now() - 4 * 60000).toISOString() /* < 5 min */, attributes: { friendly_name: "Extra " + k.toUpperCase(), media_title: "T" + k } };
    t3.ha.hass = { ...t3.hass, states: st4 }; await sleep(1200);
    const more = R3.querySelector(".more");
    check("V3 cap: 4 collapsed cards + '+3 more' row first in stack", R3.querySelectorAll(".mini").length === 4 && !more.hidden && more.textContent === "+3 more" && R3.querySelector(".stack").firstElementChild === more,
      `minis=${R3.querySelectorAll(".mini").length} more="${more.textContent}" hidden=${more.hidden}`);
    more.click();
    check("V3 '+N more' expands to all 7, label 'Show less'", R3.querySelectorAll(".mini").length === 7 && more.textContent === "Show less");
    more.click();
    check("V3 'Show less' back to 4", R3.querySelectorAll(".mini").length === 4);
    t3.w.__mq["(max-height: 560px)"] = true; await sleep(1100);
    check("V3 short window: cap 2 + '+5 more'", R3.querySelectorAll(".mini").length === 2 && more.textContent === "+5 more", `minis=${R3.querySelectorAll(".mini").length} more="${more.textContent}"`);
    // Most relevant collapsed card sits nearest the focused card (bottom of the stack).
    const lastMini = [...R3.querySelectorAll(".mini")].pop();
    check("V3 most relevant collapsed card is nearest the focused card", lastMini && lastMini.dataset.entity === "media_player.office", lastMini && lastMini.dataset.entity);
    t3.w.close();
  }


  // ---------- V5: paused timeout + swipe/× dismiss ----------
  {
    const now = Date.now(), ago = (ms) => new Date(now - ms).toISOString();
    const prep15 = (st) => {
      for (const k of Object.keys(st)) if (["playing", "paused"].includes(st[k].state)) st[k].state = "idle";
      const mk = (id, state, lc, title) => { st[id] = { ...(st[id] || { entity_id: id, attributes: { friendly_name: id.split(".")[1] } }), state, last_changed: lc };
        st[id].attributes = { ...st[id].attributes, media_title: title }; };
      mk("media_player.office", "playing", ago(30000), "Focus Song");           // MA, playing -> focus
      mk("media_player.extra_x", "playing", ago(60000), "Second Song");                   // playing
      mk("media_player.kitchen_2", "paused", ago(60000), "Paused 1 min");            // shown
      mk("media_player.lounge_tv", "paused", ago(5 * 60000 - 2500), "About to time out");      // drops out ~2.5 s in
      mk("media_player.bedroom", "paused", ago(10 * 60000), "Paused 10 min");              // hidden
      // idle/standby/on with stale media must never show
      mk("media_player.living_room", "idle", ago(1000), "Stale idle media");
      mk("media_player.kitchen", "on", ago(1000), "Stale on media");
    };
    const t5 = setup(real2026("light"), FIXTURE, prep15);
    t5.sb.setAttribute("expanded", ""); t5.sb.getBoundingClientRect = () => ({ width: 256, height: 800 });
    await sleep(1200);
    const p5 = t5.sb.shadowRoot.querySelector("sidebar-mini-player"), R5 = p5.shadowRoot;
    const fq = (x) => R5.querySelector(".focus " + x);
    const miniIds = () => [...R5.querySelectorAll(".mini")].map((n) => n.dataset.entity);
    const focusId = () => p5._entity;
    // Pointer events: jsdom 24 has no PointerEvent -> MouseEvent with pointerId/pointerType bolted on.
    const pev = (type, x, y, o = {}) => { const e = new t5.w.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(e, "pointerId", { value: o.id || 1 }); Object.defineProperty(e, "pointerType", { value: o.type || "touch" }); return e; };
    const drag = async (el, pts, o) => { el.dispatchEvent(pev("pointerdown", pts[0][0], pts[0][1], o));
      for (const [x, y, wait] of pts.slice(1)) { if (wait) await sleep(wait); el.dispatchEvent(pev("pointermove", x, y, o)); } };
    const up = (el, x, y, o) => el.dispatchEvent(pev("pointerup", x, y, o));

    console.log("  visible: focus=" + focusId() + " minis=" + miniIds().join(","));
    check("V5 paused 10 min ago (bedroom) hidden", focusId() !== "media_player.bedroom" && !miniIds().includes("media_player.bedroom"));
    check("V5 paused 1 min ago (kitchen_2) shown", miniIds().includes("media_player.kitchen_2"));
    check("V5 idle/on players with stale media never shown", !miniIds().some((x) => /living_room$|kitchen$/.test(x)));
    check("V5 focus = most recent playing (office), 3 collapsed cards", focusId() === "media_player.office" && miniIds().length === 3, miniIds().join(","));
    t5.sb.getBoundingClientRect = () => ({ width: 56, height: 800 }); await sleep(1100);
    check("V5 collapsed badge counts only visible players (4, not 5)", fq(".badge").textContent === "4" && !fq(".badge").hidden, fq(".badge").textContent);
    t5.sb.getBoundingClientRect = () => ({ width: 256, height: 800 }); await sleep(1100);
    // Timeout via the 1 s tick alone (same hass object, no state update): tv crosses 5 min.
    await sleep(1500);
    check("V5 tv drops out on the tick after 5 min paused (no state update)", !miniIds().includes("media_player.lounge_tv") && miniIds().length === 2, miniIds().join(","));

    // Short, slow swipe on a collapsed card -> springs back, no dismiss, trailing click swallowed.
    let lk = R5.querySelector('.mini[data-entity="media_player.kitchen_2"]');
    t5.calls.length = 0;
    await drag(lk.querySelector(".mtext"), [[10, 10], [22, 11, 0], [30, 11, 60], [40, 12, 60]]);
    check("V5 card follows finger while swiping (translateX 30px)", lk.style.transform === "translateX(30px)", lk.style.transform);
    lk.querySelector(".mtext").dispatchEvent(pev("pointermove", -20, 12));
    check("V5 right only: dragging back past start clamps to 0", lk.style.transform === "translateX(0px)", lk.style.transform);
    lk.querySelector(".mtext").dispatchEvent(pev("pointermove", 40, 12));
    up(lk.querySelector(".mtext"), 40, 12);
    lk.querySelector(".mtext").click(); // browsers fire a click after pointerup
    lk.querySelector(".mpp").click();   // ...even when the swipe started on a button
    await sleep(300);
    check("V5 short swipe (30px < 35% of 200) springs back, not dismissed", miniIds().includes("media_player.kitchen_2") && (lk.style.transform === "" || lk.style.transform === "translateX(0)"), lk.style.transform);
    check("V5 swipe does not trigger click (focus unchanged) or button (no service call)", focusId() === "media_player.office" && t5.calls.length === 0, JSON.stringify(t5.calls));
    await sleep(300);
    lk.querySelector(".mtext").click();
    check("V5 a normal click after the swipe works again (focus)", focusId() === "media_player.kitchen_2");
    p5._selected = null; p5._render(); // back to auto focus

    // Vertical drag -> not ours (sidebar scrolls): no transform, nothing dismissed.
    lk = R5.querySelector('.mini[data-entity="media_player.kitchen_2"]');
    await drag(lk, [[10, 10], [14, 40, 20], [16, 80, 20]]); up(lk, 16, 80);
    check("V5 vertical drag ignored (no transform, still shown)", lk.style.transform === "" && miniIds().includes("media_player.kitchen_2"));
    const css5 = R5.querySelector("style").textContent;
    check("V5 CSS touch-action: pan-y on cards", /\.wrap, \.mini \{ touch-action: pan-y/.test(css5));

    // Long swipe (100px = 50%) -> slides out, dismissed, persisted.
    await drag(lk, [[10, 10], [25, 11, 0], [60, 12, 60], [110, 12, 60]]); up(lk, 110, 12);
    await sleep(80);
    check("V5 slide-out animation: fading + moved off", lk.style.opacity === "0" && /translateX\(216px\)/.test(lk.style.transform), lk.style.transform + " op=" + lk.style.opacity);
    await sleep(250);
    check("V5 long swipe dismissed kitchen_2", !miniIds().includes("media_player.kitchen_2"), miniIds().join(","));
    const stored = JSON.parse(t5.w.localStorage.getItem("sidebar-mini-player:dismissed") || "{}");
    const lkState = t5.ha.hass.states["media_player.kitchen_2"];
    check("V5 dismissal persisted in localStorage (entity -> last_changed|state)", stored["media_player.kitchen_2"] && stored["media_player.kitchen_2"].k === `${lkState.last_changed}|paused`, JSON.stringify(stored));

    // Fast flick on the FOCUSED card (40px < 35% but fast) -> dismissed, focus moves to next.
    const wrap = R5.querySelector(".focus");
    await drag(fq(".text"), [[10, 10], [22, 10, 0], [30, 10, 5], [50, 10, 5]]); up(fq(".text"), 50, 10);
    fq(".text").click(); // must not open more-info
    await sleep(300);
    check("V5 flick dismisses focused card, focus moves to next player (extra_x)", focusId() === "media_player.extra_x" && wrap.style.transform === "", focusId());
    check("V5 nothing hidden left behind: no collapsed cards, stack hidden", miniIds().length === 0 && R5.querySelector(".stack").hidden);

    // Mouse drag works too (pointerType mouse, button 0); left button only.
    // Collapsed sidebar: swipe disabled.
    t5.sb.getBoundingClientRect = () => ({ width: 56, height: 800 }); await sleep(1100);
    await drag(wrap, [[10, 10], [40, 10, 0], [150, 10, 20]], { type: "mouse" }); up(wrap, 150, 10, { type: "mouse" });
    await sleep(300);
    check("V5 collapsed sidebar: swipe disabled", focusId() === "media_player.extra_x" && !p5.hidden);
    t5.sb.getBoundingClientRect = () => ({ width: 256, height: 800 }); await sleep(1100);

    // Reload: new page with the same states + this localStorage -> dismissals survive.
    const snapStates = t5.ha.hass.states, snapStore = { "sidebar-mini-player:dismissed": t5.w.localStorage.getItem("sidebar-mini-player:dismissed") };
    t5.w.close();
    const t6 = setup(real2026("light"), null, () => {}, { states: snapStates, storage: snapStore });
    t6.sb.setAttribute("expanded", ""); t6.sb.getBoundingClientRect = () => ({ width: 256, height: 800 });
    await sleep(1200);
    const p6 = t6.sb.shadowRoot.querySelector("sidebar-mini-player"), R6 = p6.shadowRoot;
    const mini6 = () => [...R6.querySelectorAll(".mini")].map((n) => n.dataset.entity);
    check("V5 after reload: dismissed players stay hidden, focus extra_x", p6._entity === "media_player.extra_x" && mini6().length === 0, `${p6._entity} / ${mini6()}`);
    // kitchen_2 plays again (new last_changed + state) -> comes back; stale key pruned.
    const st6 = { ...t6.ha.hass.states };
    st6["media_player.kitchen_2"] = { ...st6["media_player.kitchen_2"], state: "playing", last_changed: new Date().toISOString() };
    t6.ha.hass = { ...t6.hass, states: st6 }; await sleep(1200);
    const st6b = JSON.parse(t6.w.localStorage.getItem("sidebar-mini-player:dismissed") || "{}");
    check("V5 new last_changed brings a dismissed player back (now focused: most recent playing)", p6._entity === "media_player.kitchen_2" && mini6().includes("media_player.extra_x"), `${p6._entity} / ${mini6()}`);
    check("V5 its stale dismissal key was pruned; office's kept", !st6b["media_player.kitchen_2"] && !!st6b["media_player.office"], JSON.stringify(st6b));
    // Hover "x" (mouse): dismisses the focused player; focus moves on.
    t6.w.__mq["(hover: hover)"] = true;
    const x = R6.querySelector(".focus .dismiss");
    check("V5 hover dismiss button present in focused card, top-right CSS", !!x && /\.wrap \.dismiss \{\s*display: inline-flex; position: absolute; top: 3px; right: 3px/.test(R6.querySelector("style").textContent));
    t6.calls.length = 0; let mi6 = null; t6.ha.addEventListener("hass-more-info", (e) => (mi6 = e.detail.entityId));
    x.click(); await sleep(50);
    check("V5 × dismisses focused player (no service call, no more-info), focus -> extra_x", p6._entity === "media_player.extra_x" && !mi6 && t6.calls.length === 0, `${p6._entity} calls=${JSON.stringify(t6.calls)}`);
    // Selected (clicked) player gets timed out -> focus falls back to auto.
    const st7 = { ...t6.ha.hass.states };
    st7["media_player.kitchen_2"] = { ...st7["media_player.kitchen_2"], state: "paused", last_changed: new Date().toISOString() };
    t6.ha.hass = { ...t6.hass, states: st7 }; await sleep(1200);
    R6.querySelector('.mini[data-entity="media_player.kitchen_2"] .mtext').click();
    check("V5 paused-again player is back and can be selected", p6._entity === "media_player.kitchen_2");
    const st8 = { ...st7 }; st8["media_player.kitchen_2"] = { ...st7["media_player.kitchen_2"], last_changed: new Date(Date.now() - 6 * 60000).toISOString() };
    t6.ha.hass = { ...t6.hass, states: st8 }; await sleep(1200);
    check("V5 selected player times out -> focus moves to next (extra_x)", p6._entity === "media_player.extra_x" && p6._selected === null);
    // Nothing visible -> whole player hidden.
    R6.querySelector(".focus .dismiss").click(); await sleep(50);
    check("V5 all dismissed/timed out -> player hidden", p6.hidden === true);
    t6.w.close();
  }

  // ---------- T51: iOS touch path + no re-render mid-drag ----------
  // Simulates iOS WKWebView event sequences (touch events; iOS also sends pointer events
  // for the same finger, and fires pointercancel once it thinks it owns the gesture).
  {
    const now = Date.now(), ago = (ms) => new Date(now - ms).toISOString();
    const prep = (st) => {
      for (const k of Object.keys(st)) if (["playing", "paused"].includes(st[k].state)) st[k].state = "idle";
      const mk = (id, state, lc, title) => { st[id] = { ...(st[id] || { entity_id: id, attributes: { friendly_name: id.split(".")[1] } }), state, last_changed: lc };
        st[id].attributes = { ...st[id].attributes, media_title: title }; };
      mk("media_player.office", "playing", ago(30000), "Focus Song");
      mk("media_player.extra_x", "playing", ago(60000), "Second Song");
      mk("media_player.kitchen_2", "paused", ago(60000), "Paused 1 min");
      mk("media_player.lounge_tv", "paused", ago(90000), "Paused 1.5 min");
    };
    const t = setup(real2026("light"), FIXTURE, prep);
    t.sb.setAttribute("expanded", ""); t.sb.getBoundingClientRect = () => ({ width: 256, height: 800 });
    await sleep(1200);
    const p = t.sb.shadowRoot.querySelector("sidebar-mini-player"), R = p.shadowRoot;
    const miniIds = () => [...R.querySelectorAll(".mini")].map((n) => n.dataset.entity);
    const mini = (id) => R.querySelector(`.mini[data-entity="${id}"]`);
    // jsdom has TouchEvent but no Touch constructor -> plain Event with touch lists bolted on.
    const tev = (type, pts, o = {}) => {
      const e = new t.w.Event(type, { bubbles: true, cancelable: o.cancelable !== false, composed: true });
      const list = pts.map(([x, y, id = 7]) => ({ identifier: id, clientX: x, clientY: y }));
      Object.defineProperty(e, "touches", { value: type === "touchend" || type === "touchcancel" ? [] : (o.touches || list) });
      Object.defineProperty(e, "changedTouches", { value: list });
      return e;
    };
    const pev = (type, x, y, o = {}) => { const e = new t.w.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(e, "pointerId", { value: o.id || 1 }); Object.defineProperty(e, "pointerType", { value: o.type || "touch" }); return e; };
    // Does a touchmove escape the card (would the drawer / page see it)?
    let leaked = 0; R.querySelector(".minis").addEventListener("touchmove", () => leaked++);
    check(`T51 VERSION ${PKG.version} loaded (matches package.json)`, t.w.__sidebarMiniPlayerLoaded === PKG.version, t.w.__sidebarMiniPlayerLoaded);
    console.log("  visible: focus=" + p._entity + " minis=" + miniIds().join(","));

    // 1) Pure touch swipe, short -> follows finger, fades, blocks native pan, springs back.
    let lk = mini("media_player.kitchen_2"), tx = lk.querySelector(".mtext");
    tx.dispatchEvent(tev("touchstart", [[10, 10]]));
    let m = tev("touchmove", [[15, 11]]); tx.dispatchEvent(m);
    check("T51 undecided but rightward-horizontal touchmove is preventDefault'ed (iOS can't start a pan)", m.defaultPrevented && lk.style.transform === "");
    m = tev("touchmove", [[30, 13]]); tx.dispatchEvent(m);
    check("T51 touch swipe locks: card follows finger (translateX 20px)", lk.style.transform === "translateX(20px)", lk.style.transform);
    check("T51 swipe touchmove preventDefault + stopPropagation (drawer never sees it)", m.defaultPrevented && leaked === 0, `leaked=${leaked}`);
    check("T51 render frozen while swiping", p._swipeHoldUntil > Date.now());
    tx.dispatchEvent(tev("touchmove", [[60, 14]]));
    check("T51 card fades as it moves (opacity < 1)", Number(lk.style.opacity) < 1 && Number(lk.style.opacity) > 0.5, lk.style.opacity);
    // slow release at 50px < 35% of 200 -> spring back
    await sleep(150); tx.dispatchEvent(tev("touchmove", [[60, 14]])); await sleep(150);
    const te = tev("touchend", [[60, 14]]); tx.dispatchEvent(te);
    tx.click(); // iOS may still fire a click
    await sleep(320);
    check("T51 touchend after swipe is preventDefault'ed (no synthetic click)", te.defaultPrevented);
    check("T51 short touch swipe springs back, not dismissed, click swallowed", miniIds().includes("media_player.kitchen_2") && lk.style.transform === "" && p._entity === "media_player.office" && p._swipeHoldUntil === 0, lk.style.transform);

    // 2) iOS order: pointerdown(touch) first, then touchstart; iOS fires pointercancel mid-swipe.
    //    The swipe must survive the pointercancel sprang back here) and dismiss.
    await sleep(450);
    lk.dispatchEvent(pev("pointerdown", 10, 10));
    lk.dispatchEvent(tev("touchstart", [[10, 10]]));
    lk.dispatchEvent(pev("pointermove", 25, 11));
    lk.dispatchEvent(tev("touchmove", [[25, 11]]));
    lk.dispatchEvent(pev("pointercancel", 25, 11)); // iOS claims the pointer
    lk.dispatchEvent(tev("touchmove", [[60, 12]]));
    check("T51 pointercancel from iOS does NOT kill the touch swipe", lk.style.transform === "translateX(50px)", lk.style.transform);
    await sleep(60); lk.dispatchEvent(tev("touchmove", [[100, 12]])); await sleep(60);
    lk.dispatchEvent(tev("touchend", [[100, 12]]));
    await sleep(80);
    check("T51 long touch swipe slides out (opacity 0)", lk.style.opacity === "0", lk.style.opacity);
    await sleep(250);
    check("T51 long touch swipe (90px > 35%) dismissed kitchen_2", !miniIds().includes("media_player.kitchen_2"), miniIds().join(","));

    // 3) Re-render during a drag: start a swipe on tv, then HA state changes so the order
    //    and focus change (tv becomes the newest playing = would be FOCUSED). Wait > 1 tick.
    const tvCard = mini("media_player.lounge_tv");
    tvCard.dispatchEvent(tev("touchstart", [[10, 10]]));
    tvCard.dispatchEvent(tev("touchmove", [[30, 11]]));
    const st = { ...t.ha.hass.states };
    st["media_player.lounge_tv"] = { ...st["media_player.lounge_tv"], state: "playing", last_changed: new Date().toISOString() };
    st["media_player.extra_x"] = { ...st["media_player.extra_x"], attributes: { ...st["media_player.extra_x"].attributes, media_title: "Changed Title" } };
    t.ha.hass = { ...t.hass, states: st };
    await sleep(2300); // two ticks
    check("T51 mid-drag: card not removed/moved by the tick", tvCard.isConnected && mini("media_player.lounge_tv") === tvCard, miniIds().join(","));
    check("T51 mid-drag: transform kept through re-render ticks", tvCard.style.transform === "translateX(20px)", tvCard.style.transform);
    check("T51 mid-drag: focused card content not swapped", p._entity === "media_player.office");
    tvCard.dispatchEvent(tev("touchmove", [[45, 11]]));
    check("T51 mid-drag: still follows the finger after ticks", tvCard.style.transform === "translateX(35px)", tvCard.style.transform);
    await sleep(150); tvCard.dispatchEvent(tev("touchmove", [[45, 11]])); await sleep(120);
    tvCard.dispatchEvent(tev("touchend", [[45, 11]]));
    await sleep(400);
    check("T51 after release: render catches up (tv now focused, extra_x title updated)", p._entity === "media_player.lounge_tv" && R.querySelector('.mini[data-entity="media_player.extra_x"] .title').textContent === "Changed Title", `${p._entity} / ${miniIds()}`);

    // 4) Vertical touch: not ours, NOT prevented (sidebar keeps scrolling).
    const ex = mini("media_player.extra_x");
    ex.dispatchEvent(tev("touchstart", [[10, 10]]));
    const v1 = tev("touchmove", [[11, 16]]); ex.dispatchEvent(v1);
    const v2 = tev("touchmove", [[12, 40]]); ex.dispatchEvent(v2);
    ex.dispatchEvent(tev("touchend", [[12, 40]]));
    check("T51 vertical touch drag: not prevented, no transform", !v1.defaultPrevented && !v2.defaultPrevented && ex.style.transform === "");

    // 5) iOS already scrolling (non-cancelable touchmove while undecided) -> we let go.
    ex.dispatchEvent(tev("touchstart", [[10, 10]]));
    ex.dispatchEvent(tev("touchmove", [[20, 11]], { cancelable: false }));
    ex.dispatchEvent(tev("touchmove", [[60, 11]]));
    ex.dispatchEvent(tev("touchend", [[60, 11]]));
    check("T51 non-cancelable touchmove (iOS owns it) -> gesture abandoned", ex.style.transform === "" && miniIds().includes("media_player.extra_x"));

    // 6) touchcancel mid-swipe -> spring back, not dismissed.
    ex.dispatchEvent(tev("touchstart", [[10, 10]]));
    ex.dispatchEvent(tev("touchmove", [[30, 10]]));
    ex.dispatchEvent(tev("touchmove", [[150, 10]]));
    ex.dispatchEvent(tev("touchcancel", [[150, 10]]));
    await sleep(320);
    check("T51 touchcancel mid-swipe springs back, not dismissed", ex.style.transform === "" && miniIds().includes("media_player.extra_x"));

    // 7) Second finger cancels.
    await sleep(450);
    ex.dispatchEvent(tev("touchstart", [[10, 10]]));
    ex.dispatchEvent(tev("touchmove", [[30, 10]]));
    ex.dispatchEvent(tev("touchstart", [[50, 50, 8]], { touches: [{ identifier: 7, clientX: 30, clientY: 10 }, { identifier: 8, clientX: 50, clientY: 50 }] }));
    ex.dispatchEvent(tev("touchmove", [[150, 10]]));
    await sleep(320);
    check("T51 second finger cancels the swipe", ex.style.transform === "" && miniIds().includes("media_player.extra_x"));

    // 8) Volume row excluded on the focused card (touch).
    await sleep(450);
    const wrap = R.querySelector(".focus"), vin = R.querySelector(".focus .vol input");
    vin.dispatchEvent(tev("touchstart", [[10, 10]]));
    const vm = tev("touchmove", [[80, 10]]); vin.dispatchEvent(vm);
    vin.dispatchEvent(tev("touchend", [[80, 10]]));
    check("T51 touch on volume slider never swipes the card", wrap.style.transform === "" && !vm.defaultPrevented);

    // 9) Touch tap (no movement) still works: focuses the collapsed card.
    ex.dispatchEvent(tev("touchstart", [[10, 10]])); ex.dispatchEvent(tev("touchend", [[10, 10]]));
    ex.querySelector(".mtext").click();
    check("T51 plain tap still focuses a collapsed card", p._entity === "media_player.extra_x");
    p._selected = null; p._render();

    // 10) Mouse drag still works on the focused card (pointer path).
    const before = p._entity, txt = R.querySelector(".focus .text");
    txt.dispatchEvent(pev("pointerdown", 10, 10, { type: "mouse" }));
    txt.dispatchEvent(pev("pointermove", 25, 10, { type: "mouse" }));
    txt.dispatchEvent(pev("pointermove", 120, 10, { type: "mouse" }));
    txt.dispatchEvent(pev("pointerup", 120, 10, { type: "mouse" }));
    txt.click();
    await sleep(300);
    check("T51 mouse drag still dismisses the focused card", p._entity !== before && !!p._entity, `${before} -> ${p._entity}`);

    // 11) Safety cap: a swipe that never ends doesn't freeze rendering forever.
    const ex2 = R.querySelector(".mini") || R.querySelector(".focus");
    ex2.dispatchEvent(tev("touchstart", [[10, 10]])); ex2.dispatchEvent(tev("touchmove", [[30, 10]]));
    check("T51 hold is capped (<= 8 s)", p._swipeHoldUntil > Date.now() && p._swipeHoldUntil <= Date.now() + 8000);
    p._swipeHoldUntil = Date.now() - 1; p._render();
    check("T51 render resumes once the hold expires", p._swipeHoldUntil === 0);
    ex2.dispatchEvent(tev("touchcancel", [[30, 10]]));
    const css = R.querySelector("style").textContent;
    check("T51 CSS: iOS callout off on cards", /-webkit-touch-callout: none/.test(css));
    t.w.close();
  }


  // ---------- C: user configuration (window.sidebarMiniPlayerConfig) ----------
  {
    const now = Date.now(), ago = (ms) => new Date(now - ms).toISOString();
    // office playing (focus), lounge_tv playing, kitchen_2 (MA) paused 1 min, bedroom (MA) paused 10 min,
    // kitchen (native twin of kitchen_2, same friendly name) playing.
    const prepC = (st) => {
      for (const k of Object.keys(st)) if (["playing", "paused"].includes(st[k].state)) st[k].state = "idle";
      const set = (id, state, lc) => { st[id] = { ...st[id], state, last_changed: lc }; };
      set("media_player.office", "playing", ago(10000));
      set("media_player.lounge_tv", "playing", ago(20000));
      set("media_player.kitchen_2", "paused", ago(60000));
      set("media_player.kitchen", "playing", ago(30000));
      set("media_player.bedroom", "paused", ago(10 * 60000));
    };
    const open = async (config, extra = {}) => {
      const t = setup(real2026("light"), FIXTURE, prepC, { config, ...extra });
      t.sb.setAttribute("expanded", ""); t.sb.getBoundingClientRect = () => ({ width: 256, height: 800 });
      await sleep(1200);
      const p = t.sb.shadowRoot.querySelector("sidebar-mini-player");
      const ids = () => (p && !p.hidden ? [p._entity, ...[...p.shadowRoot.querySelectorAll(".mini")].map((n) => n.dataset.entity)] : []);
      return { t, p, R: p && p.shadowRoot, ids };
    };

    // Defaults (no config at all)
    let c = await open(undefined);
    check("C1 zero-config: resolved config exposed as window.sidebarMiniPlayer.config with defaults",
      c.t.w.sidebarMiniPlayer && c.t.w.sidebarMiniPlayer.version === PKG.version && c.t.w.sidebarMiniPlayer.config.paused_timeout_minutes === 5 &&
      c.t.w.sidebarMiniPlayer.config.position === "bottom" && c.t.w.sidebarMiniPlayer.config.swipe_to_dismiss === true);
    check("C1 zero-config: 3 players (office, lounge_tv, kitchen_2), twin + 10-min-paused hidden",
      c.ids().length === 3 && ["media_player.office", "media_player.lounge_tv", "media_player.kitchen_2"].every((x) => c.ids().includes(x)), c.ids().join(","));
    check("C1 default position: directly before the bottom list", c.p.nextElementSibling && c.p.nextElementSibling.matches("ha-list-nav.after-spacer"));
    check("C1 accent defaults to theme (no inline accent variable)", c.p.style.getPropertyValue("--sidebar-mini-player-accent-color") === "");
    const cssC = c.R.querySelector("style").textContent;
    check("C1 CSS: accent variable chain --sidebar-mini-player-accent-color -> --primary-color",
      /--smp-accent: var\(--sidebar-mini-player-accent-color, var\(--primary-color/.test(cssC) && !/[^-]var\(--primary-color\)/.test(cssC.replace(/--smp-accent:[^;]*;/, "")));
    // Live config change after load: picked up on the next tick, no reload needed.
    c.t.w.sidebarMiniPlayerConfig = { position: "top", accent_color: "#ff8800" };
    await sleep(1200);
    const pl = c.t.sb.shadowRoot.querySelector(".panels-list");
    check("C2 live change: position top -> first child of .panels-list", pl.firstElementChild === c.p, order(pl));
    check("C2 live change: accent_color applied as inline CSS variable", c.p.style.getPropertyValue("--sidebar-mini-player-accent-color") === "#ff8800");
    c.t.w.sidebarMiniPlayerConfig = {};
    await sleep(1200);
    check("C2 back to defaults: bottom again + accent removed",
      c.p.nextElementSibling && c.p.nextElementSibling.matches("ha-list-nav.after-spacer") && c.p.style.getPropertyValue("--sidebar-mini-player-accent-color") === "");
    c.t.w.close();

    // position top on an older layout without .panels-list -> right after the header
    {
      const t = setup(LAYOUTS.settingsTop, FIXTURE, null, { config: { position: "top" } }); await sleep(150);
      const sr2 = t.sb.shadowRoot, p2 = sr2.querySelector("sidebar-mini-player");
      check("C3 position top (older layout): right after the header", p2 && p2.previousElementSibling && p2.previousElementSibling.classList.contains("menu"), order(sr2));
      t.w.close();
    }

    // include / exclude (patterns, single string)
    c = await open({ exclude: ["media_player.lounge_*"] });
    check("C4 exclude pattern hides lounge_tv", !c.ids().includes("media_player.lounge_tv") && c.ids().includes("media_player.office"), c.ids().join(","));
    c.t.w.close();
    c = await open({ include: "media_player.office" });
    check("C4 include (single string) shows only office", c.ids().join(",") === "media_player.office", c.ids().join(","));
    c.t.w.close();
    c = await open({ include: ["media_player.*"], exclude: ["media_player.office"] });
    check("C4 exclude wins over include", !c.ids().includes("media_player.office") && c.ids().length === 2, c.ids().join(","));
    c.t.w.close();

    // paused timeout
    c = await open({ paused_timeout_minutes: 0 });
    check("C5 paused_timeout_minutes 0: 10-min-paused bedroom shown", c.ids().includes("media_player.bedroom"), c.ids().join(","));
    c.t.w.close();
    c = await open({ paused_timeout_minutes: 15 });
    check("C5 paused_timeout_minutes 15: bedroom (10 min) shown", c.ids().includes("media_player.bedroom"));
    c.t.w.close();
    c = await open({ paused_timeout_minutes: 0.5 });
    // Timed-out players are dropped BEFORE dedupe, so the playing native twin (kitchen) takes its place.
    check("C5 paused_timeout_minutes 0.5: kitchen_2 (1 min) hidden, its playing native twin shown",
      !c.ids().includes("media_player.kitchen_2") && c.ids().includes("media_player.kitchen") && c.ids().length === 3, c.ids().join(","));
    c.t.w.close();

    // idle_as_paused: players that go playing -> idle (e.g. Sonos) linger as "paused"
    {
      const goIdle = (t, id, lcMs, clear = true) => {
        const old = t.states[id];
        t.states[id] = { ...old, state: "idle", last_changed: new Date(Date.now() - lcMs).toISOString(),
          attributes: clear ? { friendly_name: old.attributes.friendly_name, supported_features: old.attributes.supported_features } : old.attributes };
      };
      const label = (c, id) => { const n = c.R.querySelector(`.mini[data-entity="${id}"] .spk`); return n ? n.textContent : null; };
      // default (off): playing -> idle disappears at once
      c = await open(undefined);
      goIdle(c.t, "media_player.lounge_tv", 5000); await sleep(1200);
      check("C12 default: player that went idle is hidden immediately", !c.ids().includes("media_player.lounge_tv"), c.ids().join(","));
      c.t.w.close();
      // on: stays, shown as paused, with the last known title (idle attributes were cleared)
      c = await open({ idle_as_paused: true });
      const title = c.t.states["media_player.lounge_tv"].attributes.media_title;
      goIdle(c.t, "media_player.lounge_tv", 5000); await sleep(1200);
      const mini = c.R.querySelector('.mini[data-entity="media_player.lounge_tv"]');
      check("C12 idle_as_paused: idle player stays visible", c.ids().includes("media_player.lounge_tv"), c.ids().join(","));
      check("C12 idle_as_paused: shown as paused, last title kept", mini && /· paused$/.test(label(c, "media_player.lounge_tv")) && (!title || mini.querySelector(".title").textContent === title), mini && mini.querySelector(".title").textContent);
      check("C12 idle_as_paused: idle player never seen active (living_room) is not shown", !c.ids().some((x) => /living_room$/.test(x)), c.ids().join(","));
      // paused_timeout_minutes counts from the idle transition (no state update needed)
      goIdle(c.t, "media_player.lounge_tv", 6 * 60000); await sleep(1200);
      check("C12 idle_as_paused: hidden after paused_timeout_minutes (5) idle", !c.ids().includes("media_player.lounge_tv"), c.ids().join(","));
      // once timed out, it does not come back when idle again later
      goIdle(c.t, "media_player.lounge_tv", 1000); await sleep(1200);
      check("C12 idle_as_paused: timed-out player does not linger again", !c.ids().includes("media_player.lounge_tv"), c.ids().join(","));
      c.t.w.close();
      // unavailable / off drops the snapshot
      c = await open({ idle_as_paused: true });
      goIdle(c.t, "media_player.lounge_tv", 5000); await sleep(1200);
      c.t.states["media_player.lounge_tv"] = { ...c.t.states["media_player.lounge_tv"], state: "unavailable" }; await sleep(1200);
      c.t.states["media_player.lounge_tv"] = { ...c.t.states["media_player.lounge_tv"], state: "idle", last_changed: new Date().toISOString() }; await sleep(1200);
      check("C12 idle_as_paused: idle after unavailable is not resurrected", !c.ids().includes("media_player.lounge_tv"), c.ids().join(","));
      c.t.w.close();
      // dismissal of a lingering card persists (key uses the real state, idle)
      c = await open({ idle_as_paused: true });
      goIdle(c.t, "media_player.lounge_tv", 5000); await sleep(1200);
      c.p._dismiss("media_player.lounge_tv"); await sleep(1200);
      check("C12 idle_as_paused: dismissed lingering card stays dismissed", !c.ids().includes("media_player.lounge_tv"), c.ids().join(","));
      c.t.w.close();
      // play/pause on a lingering card -> service call on the real entity
      c = await open({ idle_as_paused: true });
      goIdle(c.t, "media_player.lounge_tv", 5000); await sleep(1200);
      c.R.querySelector('.mini[data-entity="media_player.lounge_tv"] button.mpp').click(); await sleep(100);
      check("C12 idle_as_paused: play button calls media_play_pause", c.t.calls.some((x) => x[1] === "media_play_pause" && x[2].includes("media_player.lounge_tv")), JSON.stringify(c.t.calls));
      c.t.w.close();
      c = await open({ idle_as_paused: "yes" }, { warnings: [] });
      check("C12 invalid idle_as_paused falls back to false", c.t.w.sidebarMiniPlayer.config.idle_as_paused === false);
      c.t.w.close();
    }

    // dedupe off -> native twin shows
    c = await open({ dedupe_music_assistant: false });
    check("C6 dedupe_music_assistant false: native twin (kitchen) shown", c.ids().includes("media_player.kitchen") && c.ids().length === 4, c.ids().join(","));
    c.t.w.close();

    // collapsed-card cap
    c = await open({ max_collapsed_cards: 1 });
    const more = c.R.querySelector(".more");
    check("C7 max_collapsed_cards 1: one mini + '+1 more'", c.R.querySelectorAll(".mini").length === 1 && !more.hidden && more.textContent === "+1 more", more.textContent);
    c.t.w.__mq["(max-height: 560px)"] = true; c.t.w.sidebarMiniPlayerConfig = { max_collapsed_cards_short_window: 0 }; await sleep(1200);
    check("C7 max_collapsed_cards_short_window 0: no minis, '+2 more'", c.R.querySelectorAll(".mini").length === 0 && more.textContent === "+2 more", more.textContent);
    c.t.w.close();

    // show_volume / show_progress / show_dismiss_button
    c = await open({ show_volume: false, show_progress: false, show_dismiss_button: false });
    check("C8 show_volume false: volume row hidden", c.R.querySelector(".focus .vol").hidden);
    check("C8 show_progress false: progress bar hidden", c.R.querySelector(".focus .bar").hidden);
    check("C8 show_dismiss_button false: host attribute + CSS hide the x",
      c.p.hasAttribute("no-dismiss-button") && /:host\(\[no-dismiss-button\]\) \.wrap \.dismiss \{ display: none !important/.test(c.R.querySelector("style").textContent));
    c.t.w.sidebarMiniPlayerConfig = {}; await sleep(1200);
    check("C8 defaults again: volume + progress shown, x allowed", !c.R.querySelector(".focus .vol").hidden && !c.R.querySelector(".focus .bar").hidden && !c.p.hasAttribute("no-dismiss-button"));
    c.t.w.close();

    // swipe_to_dismiss false
    c = await open({ swipe_to_dismiss: false });
    {
      const mk = c.R.querySelector(".mini"), id = mk.dataset.entity;
      const tev = (type, x, y) => { const e = new c.t.w.Event(type, { bubbles: true, cancelable: true, composed: true });
        const l = [{ identifier: 3, clientX: x, clientY: y }];
        Object.defineProperty(e, "touches", { value: type === "touchend" ? [] : l }); Object.defineProperty(e, "changedTouches", { value: l }); return e; };
      mk.dispatchEvent(tev("touchstart", 10, 10));
      const m1 = tev("touchmove", 40, 10); mk.dispatchEvent(m1);
      mk.dispatchEvent(tev("touchmove", 150, 10)); mk.dispatchEvent(tev("touchend", 150, 10));
      await sleep(400);
      check("C9 swipe_to_dismiss false: no transform, not prevented, not dismissed", mk.style.transform === "" && !m1.defaultPrevented && c.ids().includes(id));
    }
    c.t.w.close();

    // remember_dismissed false: x dismisses, nothing written to localStorage
    c = await open({ remember_dismissed: false });
    {
      const before = c.p._entity;
      c.R.querySelector(".focus .dismiss").click(); await sleep(50);
      check("C10 remember_dismissed false: dismiss works in memory", c.p._entity !== before && !c.ids().includes(before));
      check("C10 remember_dismissed false: nothing written to localStorage", c.t.w.localStorage.getItem("sidebar-mini-player:dismissed") === null);
    }
    c.t.w.close();

    // invalid values -> defaults + warnings, never a crash
    {
      const warnings = [];
      c = await open({ paused_timeout_minutes: -3, position: "left", include: 5, swipe_to_dismiss: "yes", bogus: 1 }, { warnings });
      const cfg = c.t.w.sidebarMiniPlayer.config;
      check("C11 invalid values fall back to defaults", cfg.paused_timeout_minutes === 5 && cfg.position === "bottom" && cfg.include.length === 0 && cfg.swipe_to_dismiss === true, JSON.stringify(cfg));
      check("C11 one warning per bad/unknown option (5)", warnings.filter((w) => w.includes("sidebar-mini-player")).length === 5, warnings.join(" | "));
      check("C11 player still works with a bad config", c.ids().length === 3);
      c.t.w.close();
    }
    {
      const warnings = [];
      c = await open("not an object", { warnings });
      check("C11 non-object config -> defaults + warning", c.ids().length === 3 && warnings.some((w) => w.includes("must be an object")));
      c.t.w.close();
    }
  }

  // ---------- P: packaging / loading routes ----------
  {
    // extra_module_url timing: module runs BEFORE <home-assistant> exists; config defined later.
    const t = setup(real2026("light"), FIXTURE, null, { evalFirst: true });
    t.w.sidebarMiniPlayerConfig = { accent_color: "rebeccapurple" }; // a config module loaded after us
    await sleep(1300);
    const p = t.sb.shadowRoot.querySelector("sidebar-mini-player");
    check("P1 loaded before the frontend exists (extra_module_url): injects once it appears", !!p && !p.hidden);
    check("P1 config defined AFTER the module loaded is still applied", p && p.style.getPropertyValue("--sidebar-mini-player-accent-color") === "rebeccapurple");
    // Loaded a second time (extra_module_url AND a dashboard resource): no second player.
    t.w.eval(SRC); await sleep(1200);
    check("P2 loaded twice: still exactly one player", t.d.querySelector("home-assistant").shadowRoot.querySelector("home-assistant-main").shadowRoot.querySelector("ha-drawer")
      .querySelector("ha-sidebar").shadowRoot.querySelectorAll("sidebar-mini-player").length === 1);
    t.w.close();

    // Version is consistent everywhere a release reads it.
    const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
    const top = (changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1];
    const jsVer = (SRC.match(/const VERSION = "([^"]+)"/) || [])[1];
    check("P3 VERSION == package.json version == top CHANGELOG entry", jsVer === PKG.version && top === PKG.version, `js=${jsVer} pkg=${PKG.version} changelog=${top}`);
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const readmeVers = [...readme.matchAll(/ha-sidebar-mini-player\.js\?v=(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    check("P3 README ?v= examples match the version", readmeVers.length > 0 && readmeVers.every((v) => v === PKG.version), readmeVers.join(","));
    const hacs = JSON.parse(fs.readFileSync(path.join(ROOT, "hacs.json"), "utf8"));
    check("P4 hacs.json filename exists and matches the repo name", hacs.filename === "ha-sidebar-mini-player.js" && fs.existsSync(path.join(ROOT, hacs.filename)));
    const urls = SRC.match(/https?:\/\/[^\s"'`)]+/g) || [];
    check("P5 shipped file is generic: only github.com URLs, no private LAN IPs, no internal change log",
      urls.every((u) => u.startsWith("https://github.com/")) &&
      !/\b(?:10\.\d+|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+\b/.test(SRC) && !/CHANGE HISTORY/.test(SRC), urls.join(" "));
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})();
