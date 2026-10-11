# Publishing checklist

This file is for the maintainer. It covers everything needed to take this repo
public and grow its audience. Nothing here has been done yet: the repo only
exists locally.

## 0. Before anything goes public

- [ ] Evan has reviewed the code, README and images.
- [ ] Pick the GitHub account. Replace every `Evski` placeholder:
      `sh scripts/set-owner.sh <github-username>` (needs GNU sed, as on Linux), then
      `git diff` and commit (`git commit -am "Set repository owner"`).
- [ ] Optional: change the commit author from the placeholder
      `Evan <Evski@users.noreply.github.com>` to your real noreply address. While the
      repo is unpublished it's safe to rewrite:
      ```bash
      git config user.name "Evan"
      git config user.email "<id>+<username>@users.noreply.github.com"
      git rebase --root --exec 'git commit --amend --no-edit --reset-author'
      ```
- [ ] Run `npm ci && npm test`. All checks must pass.
- [ ] Optional: replace the screenshots (see section 6).

### Every `Evski` placeholder

`scripts/set-owner.sh` handles all of these. Re-list them with
`git grep -n -w Evski -- ':!scripts/set-owner.sh'`:

| File | What |
|---|---|
| `README.md` | Badges (release, downloads, licence, tests, HACS validation), My Home Assistant link, custom-repository URL, releases, issues and Discussions links |
| `ha-sidebar-mini-player.js` | Repo URL in the header comment |
| `LICENSE` | Copyright line `Evan <Evski>` |
| `package.json` | `author` email, `repository`, `bugs`, `homepage` |
| `CHANGELOG.md` | Compare and release links at the bottom |
| `CONTRIBUTING.md` | Issues link, clone URL |
| `SECURITY.md` | Private advisory link |
| `.github/ISSUE_TEMPLATE/config.yml` | Discussions and advisory links |
| `PUBLISHING.md` | Commands and links in this file |

## 1. Repository settings (apply with `gh`)

- **Repository name:** `ha-sidebar-mini-player`
  - No GitHub repo with this name or `sidebar-mini-player` existed when checked
    (11 Oct 2026). The closest project is `now-playing-sidebar-card`, which is a card for
    the separate `sidebar-card` plugin, so there's no clash.
  - HACS needs a `.js` file named after the repo: `ha-sidebar-mini-player.js` at the root.
- **Description (272 characters, under GitHub's 350 limit):**

  > Now-playing mini media player docked in the Home Assistant sidebar on every page. Auto-detects any media_player (Music Assistant, Apple TV, Sonos, Spotify, Cast, Kodi) with artwork, play/pause, skip, volume and swipe to dismiss. Zero config, iOS app friendly, HACS plugin.

- **Homepage:** `https://github.com/Evski/ha-sidebar-mini-player#readme`. Change it to
  the Home Assistant Community forum thread once that exists, since it drives traffic both ways.
- **Topics (20, GitHub's maximum):**
  `home-assistant`, `homeassistant`, `hacs`, `hacs-plugin`, `hacs-dashboard`,
  `home-assistant-frontend`, `lovelace`, `media-player`, `mini-player`, `now-playing`,
  `music-assistant`, `sidebar`, `home-automation`, `smart-home`, `sonos`, `airplay`,
  `apple-tv`, `chromecast`, `spotify`, `kodi`
- **Social preview image:** upload `docs/images/social-preview.png` (1280×640) under
  Settings → General → Social preview. GitHub has no API for this, so do it in the web UI.
  Its text reads: "Sidebar Mini Player for Home Assistant. Now playing on every page, in
  the sidebar. Any media_player · Music Assistant aware. Swipe to dismiss · HACS".

### Why these words

People search GitHub, HACS and the forum with phrases like "home assistant sidebar media
player", "now playing", "mini media player", "music assistant player" and "HACS". The repo
name, description, topics, README headings and image alt text all use those phrases where
they're accurate. Integrations that are listed but not yet confirmed are marked "expected to
work" in the README.

## 2. Create and push (GitHub CLI)

```bash
gh auth login                                   # the repo owner signs in themselves
cd ha-sidebar-mini-player                       # this local repository
gh repo create Evski/ha-sidebar-mini-player --public --source . --remote origin \
  --description "Now-playing mini media player docked in the Home Assistant sidebar on every page. Auto-detects any media_player (Music Assistant, Apple TV, Sonos, Spotify, Cast, Kodi) with artwork, play/pause, skip, volume and swipe to dismiss. Zero config, iOS app friendly, HACS plugin." \
  --homepage "https://github.com/Evski/ha-sidebar-mini-player#readme"
git push -u origin main

gh repo edit Evski/ha-sidebar-mini-player \
  --enable-issues --enable-discussions --enable-wiki=false \
  --add-topic home-assistant,homeassistant,hacs,hacs-plugin,hacs-dashboard,home-assistant-frontend,lovelace,media-player,mini-player,now-playing,music-assistant,sidebar,home-automation,smart-home,sonos,airplay,apple-tv,chromecast,spotify,kodi
```

Then, in the web UI:
- Settings → General → Social preview → upload `docs/images/social-preview.png`.
- Settings → Code security → enable **Private vulnerability reporting** (`SECURITY.md` links to it).
- Discussions → add categories such as "Show your setup" and "Q&A". Optionally pin a welcome post.
- Check that the **Tests** and **HACS validation** workflows pass on `main` (Actions tab).

## 3. First release

```bash
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

The **Release** workflow runs the tests, checks the tag matches `VERSION`, and publishes the
GitHub release with `ha-sidebar-mini-player.js` attached and notes taken from `CHANGELOG.md`.
HACS uses releases, not tags, so make sure the release appears under Releases.

Smoke test as a user would: in Home Assistant, go to **HACS → Custom repositories**, add the repo
as type **Dashboard**, download it, load it via `extra_module_url`, restart, and check the
player. If Evan is still using the old `/local/sidebar-mini-player.js` line, remove it first so
the HACS copy is the one that loads.

## 4. HACS default store (later)

Being in the default store makes the plugin show up in every HACS search without a custom
repository. Requirements (from hacs.xyz "Include default repositories"):

- [ ] Public GitHub repo that can be added to HACS as a custom repository
- [ ] **Description** set, **issues** enabled, **topics** set (done in step 2)
- [ ] `hacs.json` in the root with at least `name` (included)
- [ ] The **HACS Action** (`.github/workflows/validate.yml`) passes **with no ignores**
- [ ] A full **GitHub release** (not just a tag) created *after* the actions passed
- [ ] **Images in the README** (the "check images" step for plugins). Included: `docs/images/*.png`.
- [ ] Not archived
- [ ] The PR is opened by the repo owner, from a personal account (not an organisation),
      so it's editable

Steps:
1. Fork `hacs/default`, then create a new branch from `master`.
2. Add `"Evski/ha-sidebar-mini-player"` to the file `plugin`, **in alphabetical order**.
3. Open the PR and fill in the template completely and truthfully. Incomplete PRs are closed.
4. Expect a wait of months. You can track the backlog on the HACS site.
5. When it's merged, swap the README's "HACS Custom" badge for
   `https://img.shields.io/badge/HACS-Default-41BDF5.svg`.

## 5. Launch posts (DRAFTS: do not post without Evan's approval)

> **DRAFT. These go out under Evan's name. Evan must approve the final wording and post them
> himself (or explicitly approve posting).** Add the real link and an image or GIF before posting.

### 5a. Home Assistant Community forum. Category: *Share your Projects!* (or *Frontend*)

**Title:** Sidebar Mini Player: now playing in the sidebar on every page (Music Assistant aware, HACS)

> I wanted to pause the music or turn it down without leaving the page I was on, so I built
> (with an AI assistant doing most of the typing) a small frontend module that docks a
> now-playing mini player at the bottom of the main Home Assistant sidebar, just above
> Settings. It's on every page (dashboards, settings, history), not inside a dashboard card.
>
> **What it does**
> - Finds every `media_player` that's playing or paused automatically. No config needed.
> - Artwork, title, artist and speaker, prev / play-pause / next, progress, volume and mute
> - Hides Music Assistant's duplicate players, so each room shows once
> - Several players: a focused card plus slim cards above it
> - Paused players tidy themselves away after 5 minutes
> - Swipe a card right to dismiss it. This works in the iOS companion app too.
> - Follows your theme. Optional settings for include/exclude, position, accent colour and more.
>
> I use it daily with Music Assistant and an Apple TV on 2026.10. I'd love to hear how it
> behaves with Sonos, Cast, Spotify, Kodi and others.
>
> Install via HACS (custom repository for now): https://github.com/Evski/ha-sidebar-mini-player
>
> [screenshot]
>
> Built by Grok Bot (Homeassistant Expert), conducted by Evan. MIT licensed. Feedback and PRs welcome.

### 5b. Reddit r/homeassistant

Check the subreddit rules on self-promotion and flair first. Use the "Personal Setup" or
"Release" flair if available, and post once rather than cross-posting widely.

**Title:** I made a now-playing mini player that lives in the HA sidebar on every page (HACS, Music Assistant aware)

> Got tired of opening a dashboard just to pause music, so here's a tiny frontend module that
> docks a mini player at the bottom of the Home Assistant sidebar, above Settings.
>
> - zero config: anything playing or paused shows up automatically
> - artwork, controls, volume, progress
> - Music Assistant duplicates hidden
> - paused players auto-hide after 5 min, swipe right to dismiss (works in the iOS app)
> - follows your theme
>
> GitHub / HACS custom repo: https://github.com/Evski/ha-sidebar-mini-player
>
> Tested on 2026.10 with Music Assistant and Apple TV. Reports from Sonos/Cast/Spotify/Kodi
> users very welcome. Credit where due: built by Grok Bot (Homeassistant Expert), conducted
> by me.
>
> [image or GIF]

## 6. Screenshots

| File | Status | What it shows |
|---|---|---|
| `docs/images/hero.png` | **Composite**, labelled as such in the image and README | Illustrative mock sidebar and dashboard (Overview, Energy, Media, Map, Logbook, History, then Settings, Notifications, User) around the real player crop |
| `docs/images/multi.png` | **Real** iOS screenshot crop, edited | Two players: a slim collapsed card above the focused card, with progress bar and volume |
| `docs/images/mobile.png` | **Real** iOS screenshot crop, edited | The iOS companion app: a collapsed card above the focused card |
| `docs/images/social-preview.png` | Generated graphic using the real crop | GitHub social preview (1280×640) |
| `docs/images/swipe.gif` | **Not captured yet (optional)** | A swipe-right dismiss on a phone: the card follows the finger, fades and the next player slides in |

In the edited crops, the original artwork was replaced with neutral gradient tiles. The track,
artist and room names were replaced with placeholders ("Example Track", "Example Artist",
"Morning Show", "Kitchen", "Living Room").

Worth capturing for a stronger README (keep each PNG under about 300 KB, and use only
placeholder names and artwork with no real album art or photos):
- A **real desktop** screenshot of the full sidebar with the player, to replace the composite hero.
- The **collapsed (icons-only) sidebar** with the artwork, play/pause overlay and count badge.
- `swipe.gif`, about 3 seconds at 2× size, under about 2 MB. If you add it, put it in the README
  under "Gestures and controls".
