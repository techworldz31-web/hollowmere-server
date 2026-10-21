# Hollowmere: game server

The online version of Hollowmere: the game files (`Play Hollowmere.html`, `game.js`, `sprites/`, `music/`)
and the server (`host/`). A Hetzner Cloud server set up with `server-setup/hetzner-cloud-config.yaml`
runs it with https and pulls new versions from this repository automatically every 2 minutes.

Player saves and the admin password live only on the server (`/opt/hollowmere/data`), never in this repository.
