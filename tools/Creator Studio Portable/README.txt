Creator Studio
==============

Make and repair custom items, armour, weapons, capes, NPCs, boss models and animations for a RuneScape private
server, and port items from an RS3 cache in the old-school style. You look at everything in a 3D viewer you can
drag around, and nothing changes in your game until you press "Port to game".

What you need
  1. Node.js 18 or newer (https://nodejs.org). Nothing else to install.
  2. Your game: a game server folder (TSPS style: it has data\definitions inside), or just an OSRS cache.
  3. For RS3 items: an RS3 cache in "flat file" layout. Game caches are not included with the Studio.

Start it
  Windows:    double-click "Start Creator Studio.cmd"
  Mac, Linux: run  ./start-creator-studio.sh   (or:  node server.js --open)
  It opens http://localhost:4777 in your browser. It runs on your computer only.

First time
  The app asks where your game is. Press "Search this computer", or click through the folders to it.
  Then press "RS3 cache" at the top and do the same for your RS3 cache. It can be anywhere, for example in
  Downloads. A cache placed in the Studio's own rs3-cache folder is found by itself.
  Both choices are saved in config.json. Change them any time with the same two buttons.

With or without a game server
  With a server:    "Port to game" copies the old files to the server's backups folder, writes the new ones, and
                    you can undo it from the Ported tab. The Game folder window shows what your server can load.
  Without a server: the button reads "Export files". The same files are written to the Studio's export folder
                    for you to pass on. Nothing is installed anywhere.

Help
  The Guide button in the app, or docs\guide.html
  Command line:  node cli.js help

For an AI helper (Claude, Codex, Cursor and others)
  CLAUDE.md and AGENTS.md in this folder are the rules. docs\AGENT-GUIDE.md has every command, how to check and
  load a cache, and how each kind of fault is found and fixed.

Folders
  lib\         the engine (shared by the app and the command line)
  ui\          the app's screen
  docs\        the guides
  rs3-cache\   put an RS3 cache here and it is found by itself (portable copy)
  osrs-cache\  the same for an OSRS cache, if you have no game server (portable copy)
  workspace\   your drafts, the record of every port (for undo), saved name lists, test pictures
  export\      where ports go when there is no game server
  config.json  your folder choices and the port number (made when you first choose)

RuneScape and its game data belong to Jagex. The Studio contains none of it: it reads the caches you point it at.
