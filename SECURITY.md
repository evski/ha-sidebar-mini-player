# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report them
privately through GitHub's
[private vulnerability reporting](https://github.com/Evski/ha-sidebar-mini-player/security/advisories/new).
You should get a reply within a week.

## Scope

Sidebar Mini Player is a frontend-only module. It runs in your browser with the
permissions of the logged-in Home Assistant user. It only calls `media_player`
services through the frontend's existing connection, and it stores swipe dismissals
in the browser's local storage. It makes no network requests of its own apart from
loading artwork URLs that your media players report.
