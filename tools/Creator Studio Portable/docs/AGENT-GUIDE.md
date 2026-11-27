# Creator Studio: guide for AI agents

Creator Studio makes and repairs custom content for a TSPS-style RuneScape private server: items, armour, weapons,
capes, NPCs, boss models and animations, ported from an RS3 cache or made from what the game already has. It is its
own program in its own folder. It reads caches and data files freely and writes into a game server only when a
command is given `--write` (or the user presses **Port to game** in the app).

It was built and checked on one server (OSRS cache 242, RS3 cache build 950). Section 0 tells you how to find out
what works on the computer you are on. Where something is not built yet, section 12 says so.

## 0. First: which folders, which mode, which cache

Run these before anything else. They change nothing.

```
node cli.js status      # mode, folders in use, what this server can load, next free ids, packet sizes, problems
node cli.js setup       # the same, plus every server and cache the Studio can see near itself
node cli.js find        # search Downloads, Desktop, Documents and the Studio's folders for caches and servers
```

**Two modes.**

- `mode: "server"`: a game server was found (a folder holding `data/definitions`). A port writes into it.
- `mode: "standalone"`: no server. Everything else works from an OSRS cache, and a port writes the same files into
  the Studio's own `export/` folder (`export/data/definitions`, `export/data/models`). Nothing is installed anywhere.
  Tell the user that plainly: an export is files to hand over, not something in their game.

`needsSetup: true` means there is no OSRS cache at all, so nothing can be shown. Fix it with `setup`.

**What this server can load.** `status.capabilities` is read from the server's own plugin code:

| Key | True when | If false |
|---|---|---|
| `items` | a plugin loads `custom-items.json` | items are written but do not appear in game |
| `npcs` | the cache-editor plugin loads `custom-definitions.json` | custom NPC rows are written but ignored |
| `animations` | something sends the `customSeqs` dataset | `custom-seqs.json` is written but nothing plays |
| `particles` | something sends `customParticles` | capes port without their effects |
| `autoRestart` | the server has `nodemon.json` | restart the server yourself after a port |
| `log` | `logs/server.log` exists | `restart-status` cannot tell you anything |

Every dry run repeats the relevant warning. Never tell the user something is "in the game" when its capability is
false: say it was written and what the server is missing. Section 3 lists what a server needs for each file.

**Choosing folders.** Settings live in `config.json` next to `cli.js`. A missing file is fine: the Studio looks
around itself (`../Server/server`, `../server`, the folder it sits in, its `rs3-cache` and `osrs-cache` folders).

```
node cli.js setup --server "D:\my server\server"          # game server (a folder with data/definitions)
node cli.js setup --osrs-cache "C:\caches\osrs-242"        # use this OSRS cache (needed when there is no server)
node cli.js setup --rs3-cache "C:\Users\me\Downloads\rs3"  # the RS3 cache to port from
node cli.js setup --standalone                             # no game server: ports go to export/
node cli.js setup --server ""                              # clear a setting
```

A folder one or two levels above the real one is accepted (`...\rs3\cache` is found from `...\rs3`). Paths are
checked before anything is saved; a wrong one changes nothing and says why. In the app the same thing is the
**Game folder** and **RS3 cache** buttons at the top: "Search this computer", or click through folders to it.

### 0.1 RS3 caches: how to check one and load it

The Studio reads RS3 caches in **flat-file layout**: one numbered folder per index, one `.dat` file per group
(`47/86771.dat`, `255/19.dat`). A cache in any other form (`.jcache` SQLite files from a game install,
`main_file_cache.dat2`) has to be converted to flat files first; the Studio does not do that.

To load one: put it anywhere and run `setup --rs3-cache <folder>`, or put it in the Studio's `rs3-cache` folder and
it is found by itself. Several caches can sit side by side (`rs3-cache/950/...`, `rs3-cache/910/...`); the first one
found is used unless `config.json` names another. Each cache keeps its own item name list in `workspace/cache`.

Which folders are read: **255** index tables, **19** items, **47** models, **26** materials, **53** textures,
**27** particles. Keep **16** (objects) and **18** (NPCs) too. The rest can be left out to save space (build 950 is
about 23 GB whole, about 3.3 GB with only these).

**Diagnose a cache before trusting it:**

```
node cli.js rs3check                 # the cache in use
node cli.js rs3check "D:\some cache" # any folder, without loading it
```

It reads a spread of item definitions, then the models and textures of those items, and answers with a `verdict`:

| Verdict | Meaning | What to do |
|---|---|---|
| `works` | items, models and textures all read | port from it |
| `partly` | something reads and something does not | read `problems`; port only what is not affected, and render it before writing |
| `no` | not a flat-file RS3 cache, or the item list or models cannot be read | do not port from it |

How to read the rest of the answer:

- `indexes`: which folders exist and how many groups each holds. A missing 19, 47 or 255 is fatal.
- `items.notUnderstood` / `unknownCodes`: item definitions that use a code the reader does not know. A handful is
  harmless (those items are skipped in search; build 950 shows about 10 in 8,000, codes 3 and 182). Many means this build stores items differently: the reader is
  `decodeItem` in `lib/rs3.js`, one line per code, and the fix is to add the code with the right number of bytes.
  Work the byte count out from several items that stop at it; do not guess from one.
- `models.failed`: `unsupported RS3 model format N` means an older or newer model format than the one this reader
  knows (format 2). `is not in the cache` means folder 47 is incomplete. `layout mismatch` means the format changed
  inside format 2; compare `formatVersions` with a cache that works (build 950 reports versions 6 to 23).
- `textures`: few textures found means folder 53 or 26 is missing or stored differently; ports still work but take
  colour from vertex colours alone and look flat.
- `particles: null` means cape effects cannot be read from this cache.

A cache that checks as `works` can still hold a model the converter handles badly. The check tells you the cache is
readable, not that every port will look right: always `render` a port and look at it before `--write`.

## 1. Rules that are not optional

- **If the project has its own rules file** (`CLAUDE.md` or `AGENTS.md` in a folder above this one), read it first.
  Its rules win over this guide.
- **Never write into the game server by hand** when a Studio command can do it. Every write through the Studio
  copies the old files to the server's `backups/creator-studio-<what>-<time>/` first, writes model files before
  JSON, and keeps a manifest so the change can be undone.
- **Never delete anything in a game server or a cache.** The Studio never does: an undo moves the files a port
  created into a `_to_delete` folder next to the server and leaves them for the owner.
- **Never link into a server or cache.** No junctions, symlinks or hard links (`mklink`, `ln -s`, `cp -l`,
  `New-Item -ItemType Junction`), and nothing in a temp or scratch folder that points at them. A cleaned-up scratch
  folder with a junction in it has emptied a live server before. A test copy is a real copy.
- **Never open or change the server's saves.** The Studio has no reason to touch them and neither do you.
- **A write can restart a live server.** If the server runs under nodemon (`capabilities.autoRestart`), saving a
  `.json` restarts it and players are disconnected. So: do every dry run first, then write once. Several items go in
  one command (`port a b c --write`); several NPC repairs too (`gamefix npc 17000 17015 --write`). Follow the
  owner's rule about asking first; if they have not said, tell them before the first write.
- **After a write, check.** `node cli.js restart-status`. A restart usually shows within 20 seconds but can take 90.
  `restarted: true`, `errors: []`, `listening: true` is a clean start, and `loaded` lists the content loaders that
  came up. If custom content is missing or errors appear, `node cli.js undo <key>` and tell the user.
  `restarted: null` means this server's log cannot answer: say so, and ask the user to check.
- **Caches are the game owner's data.** Read them where they are. Do not copy a cache into the Studio folder to
  pass it on, and do not upload one anywhere.
- **You cannot see the game.** Renders (`render`, `anim render`, `rs3npc rebuild --out`) are how you look at a
  result. A good measurement is not proof it looks right: say plainly what was measured and what still needs the
  user's eyes in game. (The Vorago case in section 9 is what happens when this is skipped.)
- If you change the Studio's own code through a file-sync tool, check the copy that arrived (compare md5): a stale
  copy has been written before.

## 2. Where to run it

```
cd "<the Creator Studio folder>"
node cli.js help          # every command
node cli.js status        # section 0
```

Node 18 or newer, no packages to install. The user opens the app with `Start Creator Studio.cmd` on Windows or
`start-creator-studio.sh` elsewhere (`node server.js --open`, http://localhost:4777, this computer only). The app
and the command line share one engine (`lib/studio.js`), so a draft made in one shows up in the other.

## 3. How custom content reaches the game

| What | File the server reads | Ids | Sent to players as |
|---|---|---|---|
| Items | `data/definitions/custom-items.json` (+ `data/models/<folder>/*.dat`) | items 50000+, models 1100000+ | `customItems`, one packet |
| NPC and object models | `data/definitions/custom-models.json` (id -> file) | 1000000+ | `customModels`, one packet per model |
| Custom NPCs (Studio) | `data/definitions/custom-definitions.json` rows `{kind:"npc", id, baseId, fields}` | 60000-65534 | `customDefinitions` |
| Bosses and added NPCs/objects | `data/definitions/<name>.json` "definition bundles" (`angel-of-death.json`, `vorago.json`...) | 17000+ | `definitionArchives` |
| Animations | `data/definitions/custom-seqs.json` | 60100+ (Studio uses 61000+) | `customSeqs`, **all in one packet** |
| Cape particles | `data/definitions/custom-particles.json` | by item id | `customParticles` |
| NPC combat numbers | `data/definitions/npc-combat-defs.json` (one line per NPC) | | server only |

**What a server needs for each file** (for a server that is not the one this was built on):

- `custom-items.json`: an item loader that reads the rows (`{id, baseItemId, objType, itemDef, models}`), registers
  each model file under its id, and sends the rows to clients as dataset `customItems`. The client must accept item
  ids above its cache's and model ids of 1,000,000 and up.
- `custom-definitions.json`: the cache-editor plugin, which overlays `{kind:"npc", id, baseId, fields}` on a cache NPC.
- `custom-seqs.json`: server code that sends every row as dataset `customSeqs`, and a client that registers them
  (rows are `{id, template, frameLengths, frames:[base64 frame]}` plus optional skeleton rows `{kind:"base", id, data,
  rotationDivisor}`). Without both, a custom animation cannot play.
- `custom-particles.json`: a plugin that sends `customParticles`, and a client that draws them.
- Model files are standard OSRS model files (`.dat`), readable by any OSRS model tool, so an export is useful even
  to a server with a different content system: the models and the numbers in the JSON are all there.

Hard limits the Studio checks before every write:

- **Every packet is at most 65,535 bytes** after compression. One bad row in `custom-items.json` makes the loader
  throw and **no custom item loads at all**, so the Studio runs the loader's own checks first.
- Model file names match `^[a-zA-Z0-9._/-]+\.dat$`, 18 bytes to 1 MiB, and one model must fit one packet.
- A custom NPC row may only name animations that exist in the cache (the cache-editor refuses custom animation ids
  there). Bosses in bundles can use custom animations.
- All custom animations share one packet. `node cli.js port <anim draft>` prints the size it would reach.

## 4. How a model animates, and the three ways it goes wrong

This is the part every fault so far came back to.

**The classic system.** Each vertex of a model carries one *label* (a bone number). A skeleton ("frame base") is a
fixed list of groups; each group is a kind of move (set pivot, move, rotate, scale) and a list of labels. A frame
says "group 30: rotate by x,y,z; group 9: ...", always starting from the rest pose. A rotation turns its labels
around the **pivot**: the average position of every vertex carrying the pivot group's labels. If no vertex carries
them, the pivot is the model's origin, which is the floor under the feet.

Human skeleton (base 0) pivots: shoulders are labels **21** (right, the weapon arm) and **25** (left), elbows 17 / 23,
waist 29, neck 3+2, hips 122+42+103 (right) / 40+101+102 (left), knees 34+31 / 35+37.

**What the game client does to every model before drawing it** (`ModelData.merge` in the client; players *and* NPCs,
even an NPC made of one model). It rebuilds the model face by face, and in doing so:

1. **A vertex no face uses is dropped.**
2. **Vertices at exactly the same position become one**, and the first one met keeps its label.

Neither shows up if you test the file. Both change the animation. So the three root causes are:

| Cause | What you see in game | Found in |
|---|---|---|
| **Missing pivot.** Nothing carries a joint's pivot label, usually because a converter threw away RS3's hidden "marker" triangles, or the game hid the body part that carried it. | A whole limb swings around the floor: long sheets from the shoulder to the ground. | Elite tectonic top (labels 21/25: 92.9x stretch). Vorago (21 joints). |
| **Fused vertices.** Two parts that follow different bones touch at one point. The client joins them. | A face of one part has a corner stuck to the other part: a sheet stretching between two limbs. | Angel of Death greaves (1 vertex, 5 faces, 190 units). Vorago (644 vertices). |
| **Dropped helpers.** Hidden vertices put there to hold a pivot in place have no faces, so the client drops them and the pivot moves. | Joints a few units off; seams open or overlap. | Angel of Death (3 pivots, up to 4.5 units). |

**Stretch is measured, not guessed.** For every face and every frame the Studio compares each edge with its
rest length. `1x` never changes; cloth in OSRS stretches on purpose (a real Virtus robe bottom reaches 7.6x), so worn
items are judged against the OSRS item they play as, not against 1x.

## 5. Recipes

Dry runs print JSON. Read `problems` (blocks a port) and `warnings` (your call) every time.

### 5.1 Port an RS3 weapon

```
node cli.js search rs3 zaros godsword            # find the RS3 item id
node cli.js search item armadyl godsword         # find the OSRS item it should play as
node cli.js new rs3 37640 --base 11802 --name "Zaros godsword"
node cli.js build zaros-godsword                 # sizes, icon, problems
node cli.js render zaros-godsword --slot male --out workspace/tmp/zgs.png   # look at it on the player
node cli.js port zaros-godsword                  # dry run: id, files, packet size
node cli.js port zaros-godsword --write
node cli.js restart-status
```

The base item gives the stats, slot, attack animations and special attack (`aliasBase`). Override anything with
`set`, e.g. `node cli.js set zaros-godsword item.itemDef.bonuses "[0,132,80,0,0,0,0,0,0,0,132,0,0,8]"` or
`set <draft> item.specialAttack "{\"from\":11802,\"energy\":50}"`. Which hand: `set <draft> item.models.male.label 50`
(50 right hand, 27 bow hand, 161 shield).

### 5.2 Port RS3 armour (stretch-tested and fixed automatically)

```
node cli.js new rs3 28611 --base 26243 --name "Tectonic robe top"     # base decides slot and hidden body parts
node cli.js build tectonic-robe-top
```

In `models.male.stretch` compare `thisItem` with `reference` (the base item measured the same way). Good means
`pivotProblems: []` and numbers near the reference. Then render the worst pose it names:
`node cli.js render <draft> --slot male --poses 419:5,808:0 --heat --out x.png` (red faces stretch past the limit).

Knobs, all under `item.models.<male|female>`: `pads` (`auto` | `chest` | `arm`: big RS3 pauldrons flip over the
head on OSRS attack animations unless they sit on the chest), `pivots` (`auto` | `source` RS3's own markers |
`reference` copied from the base item), `threshold` (default 1.4), `plates` (false = never cut faces), `maxTris`,
`fit.offset` `[x,y,z]` and `fit.scale` to seat it on the body, `tint` (grey detail textures take the vertex colour).

### 5.3 Capes and particles

`new rs3 <id> --base <an OSRS cape> --type cape`. Cape vertices take the bones of the nearest vertex of the base
cape, and `item.particles: "rs3"` carries the RS3 emitters over. On the real cache this reproduces the Attack master
cape's emitters exactly, and the result passes the server plugin's own validator.
A custom copy of a cape that already has particles copies them (`item.particles: {"copyFrom": <id>}`).
Items with particles are ported one at a time. Limits: see section 12.

### 5.4 Custom version of something already in the game

```
node cli.js new item 4151 --name "Frost whip"        # a new item with its own id; 4151 stays as it is
node cli.js new item 50334 --replace                 # edit custom item 50334 in place, same id
```

### 5.5 Colour and paint

```
node cli.js colours <draft> male                     # every colour: faces, the box it sits in, bone labels
node cli.js colour "#3a6ea5"                         # web colour <-> game colour number
node cli.js recolour <draft> 5560 43300              # swap one colour everywhere (free: no new model file)
node cli.js paint <draft> male --colour "#c0392b" --label 8                # a whole body part
node cli.js paint <draft> male --colour 960 --box -40,-170,-30,40,-120,30  # everything inside a box
node cli.js paint <draft> ground --colour 960 --where 5560 --faces 12,13,14
```

Model space: x left/right, **y up is negative** (head about -200, feet 0), z front/back. Game colours are 16 bits:
hue 0-63, richness 0-7, lightness 0-127. Paint is stored per face and is dropped (with a warning) if the model's
shape changes afterwards, so paint last.

### 5.6 A custom NPC

```
node cli.js new npc 2215 --name "Frost general"
node cli.js set frost-general npc.fields.combatLevel 500
node cli.js set frost-general npc.fields.heightScale 160
node cli.js set frost-general npc.combat "{\"maxHit\":45,\"attackType\":\"melee\",\"anims\":{\"attack\":7018,\"block\":7019,\"death\":7020}}"
node cli.js recolour frost-general 274 38328
node cli.js port frost-general --write             # then in game: ::npc <id>
```

Allowed fields are listed in `lib/port.js` (`NPC_FIELDS`). Take stand, walk and combat animations from the same
creature the model comes from.

### 5.7 Is a worn item stretching? (items already in the game)

```
node cli.js diagnose item 50334
```

`pivotProblems` not empty means a joint has no pivot: that is the swinging-limb fault. Fix it by rebuilding from the
RS3 source (5.2 with `--replace`: `new item 50334 --replace`, then point `item.models.male.source` at
`{"type":"rs3","model":<id>}` with `mode: "armour"`), or for a model with no RS3 source set
`item.models.male.fix true`, which copies the missing pivots from the base item and plates what still stretches.

### 5.8 Is an NPC or boss broken by the client's rebuild?

```
node cli.js gamecheck npc 17000        # any NPC: cache, boss bundles, custom
node cli.js gamefix npc 17000          # dry run of the repair
node cli.js gamefix npc 17000 17015 --write
```

Read `models[].verticesTheGameJoinsAcrossParts` and `unusedVerticesTheGameDrops`, then `inGameNow`. The repair
moves fused vertices 1 unit apart and gives hidden helpers a zero-size face so the client keeps them. It changes no
visible face. `inGameAfterRepair` must be no worse than the creature's own skin (for the Angel of Death: stock Nex).

### 5.9 Rebuild a boss that was ported from RS3

```
node cli.js rs3npc rebuild 17015 --model 86771 --limit 1.2 --out workspace/tmp/vorago.png
node cli.js rs3npc rebuild 17015 --model 86771 --limit 1.2 --write
```

This rebuilds the NPC's single model file from the RS3 model, testing against the NPC's own animations
(`lib/npcport.js`). In order: real RS3 colours (texture x vertex colour), see-through effect layers left out, glow
lines kept, RS3 bone labels kept, simplify to `--tris` (3500), RS3's pivot markers kept as hidden points, **pivot
lock** (hidden points that hold every joint pivot exactly where the full RS3 model has it), rigid plates for faces
stretching past `--limit` between two bones (1.2 for rock or armour, 1.5 for soft creatures), then the client-safe
repair, then a measurement as the game builds it. Always look at the `--out` picture before writing.
The RS3 model id is in the old port script (`Server/server/scripts/rs3-port/`) or the RS3 NPC definition.

### 5.10 A custom animation

```
node cli.js anim joints player                     # or npc:17015 - the joints you can pose
node cli.js anim new "Victory roar" --for player   # or --from 863 to start from an existing animation
node cli.js anim key victory-roar 0     "right arm"=0,0,0
node cli.js anim key victory-roar 0.4s  "right arm"=0,0,150 "left arm"=0,0,-150 head=-20,0,0
node cli.js anim key victory-roar 1.0s  "right arm"=0,0,0
node cli.js anim render victory-roar --out workspace/tmp/roar.png      # 8 tiles across the animation
node cli.js port victory-roar                      # dry run: id, frames, packet size
node cli.js port victory-roar --write              # then in game: ::anim <id>
```

- A **key** is a pose at a time. Time is ticks of 20 ms or seconds (`0.4s`). A joint not mentioned in a key is at
  rest in that key, so repeat a joint in the next key to hold it.
- Rotate values are degrees: **x swings forward/back, y twists around the upright axis, z tilts sideways** (raising
  an arm out to the side is z). Move values are model units; scale is 128 = unchanged.
- Joints are named on the human skeleton (`right arm`, `left forearm`, `head`, `upper body`, `whole body`,
  `right leg`, `left lower leg`, `weapon`...). Other skeletons list `Joint <n>` with where it is and how much of the
  model it moves; render one key per joint to learn them.
- Between keys the Studio makes a frame every `anim.step` ticks (default 2 = 25 a second), easing in and out
  (`anim.ease`: `smooth` | `linear`). `anim.endHold` is how long the last pose is held.
- `anim.template` is a cache animation whose other settings are copied (what it can interrupt, whether it repeats):
  863 for a one-off emote, 808 for something that loops, or the creature's own attack.
- Smoothness: classic rotations step 1.4 degrees. The Studio writes a copy of the skeleton with
  `rotationDivisor: 16` (the client supports this; Vorago uses 64), so steps are 16 times finer.
- Undo removes the animation and its skeleton row if nothing else uses it.

## 6. Draft files (`workspace/drafts/<slug>.json`)

Edit with `set <draft> <dotted.path> <json>`; `show <draft>` prints it.

**Item**: `name`, `item.baseItemId` (-1 none), `item.aliasBase`, `item.examine`, `item.inventoryActions` (5 slots),
`item.isTradable`, `item.itemDef` (`equipmentType`, `weaponInterface`, `bonuses[14]`, `requirements[23]`, `value`,
`standAnim` `walkAnim` `runAnim` `attackAnim` `blockAnim`), `item.specialAttack {from, energy}`, `item.recolor
[[from,to]]`, `item.icon {auto, zoom2d, xan2d, yan2d, zan2d, offsetX2d, offsetY2d}`, `item.replaceId`,
`item.particles`, and `item.models.<ground|male|female|male1|female1|male2|female2>`:

```
{ "source": { "type": "rs3" | "osrs" | "custom" | "file" | "none", "model": <id> | "file": "<folder/x.dat>" | "path": "<abs>" },
  "mode": "ground" | "weapon" | "armour" | "cape" | "asis",
  "maxTris": 1400, "tint": true, "label": 50, "fit": { "scale": 1, "offset": [0,0,0] },
  "pads": "auto", "pivots": "auto", "plates": true, "threshold": 1.4, "fix": false, "relabel": false,
  "edits": { "scale": 1, "rotate": [0,0,0], "translate": [0,0,0], "recolor": [[from,to]], "paint": { "faces": n, "list": [[face, colour]] } } }
```

**NPC**: `name`, `npc.baseNpcId`, `npc.fields {...}`, `npc.models` (null = the base's; else a list of model specs),
`npc.combat {anims{attack,block,death}, maxHit, attackType, respawn, deathTicks, huntRange}`, `npc.spawns [{x,y,level}]`.

**Animation**: `name`, `anim.for` (`player` | `npc:<id>`), `anim.template`, `anim.fine` (16), `anim.step` (2),
`anim.ease`, `anim.endHold`, `anim.keys [{ "t": <ticks>, "pose": { "<group id>": [x,y,z] } }]`.

## 7. Port, undo, check

```
node cli.js port <draft> [more drafts]     # dry run
node cli.js port <draft> [more] --write
node cli.js ports                          # every port and repair, newest first, with its undo key
node cli.js undo <key>
node cli.js restart-status [since ms]
```

Porting a draft again updates what it made before (same ids). Undo puts the previous rows and files back; files a
port created are moved to a `_to_delete` folder next to the server, never deleted. In standalone mode the same
happens inside `export/`.

## 8. Symptom to cause to command

| The user says | Likely cause | First command |
|---|---|---|
| "the arm/leg stretches to the floor", sheets from a limb down | missing pivot on a worn item | `diagnose item <id>` |
| "a grey bit stretches from leg to leg / between two parts" | fused vertices | `gamecheck npc <id>` |
| "the boss is a mess of spikes / sheets when it attacks" | fused vertices and missing pivot markers | `gamecheck npc <id>`, then 5.9 |
| "the colours are washed out / white / wrong" on an RS3 port | texture used without the vertex colour | 5.9 (bosses); `tint` for items |
| "big flat shards, glows are solid" | see-through RS3 effect layers baked solid | 5.9 |
| "shoulder pads flip over the head" | RS3 pauldrons on the arm bone | `set <draft> item.models.male.pads chest` |
| "it floats / sits too low / too big" | fit | `item.models.<slot>.fit.offset` / `.scale` |
| "the icon is tiny / off-centre" | icon | `set <draft> item.icon.auto true`, or zoom/offsets |
| "nothing custom shows up after a port" | a loader threw, or the server cannot load that kind | `restart-status`, read `errors`; `status`, read `capabilities`; `undo` |
| "the RS3 item I want is not in the search" | no cache loaded, a cache the reader half understands, or a name list from before | `rs3check`; section 0.1 |
| "the RS3 tab is empty" | no RS3 cache set | `setup`, then `setup --rs3-cache <folder>` |
| "the animation is jerky" | too few frames | `set <draft> anim.step 1` |

## 9. Case studies (what went wrong, so it is not repeated)

**Elite tectonic robe top.** Ported from RS3 by a Python script. The top hides the player's arms (its base, Virtus,
has `wearPos2 = 6`), and the arms were the only thing carrying shoulder labels 21 and 25. The converter had dropped
RS3's own pivot-marker triangles, so in game the arms turned around the feet: 92.9x. The old check passed because it
left the arms in. Fix: rebuilt from RS3 with the markers kept as hidden points; now 4.9x against Virtus's 4.6x.

**Angel of Death armour.** `aod_armour.py` layered plates over Nex and proved, on the file, that nothing stretched.
The left and right greave each had a corner at (0,-43,14). The client fused them; five silver faces of the left
greave followed the right leg. It also dropped 252 hidden helper vertices. Fix: `gamefix` moved one vertex 1 unit
and made the helpers survive; she now measures the same as stock Nex (11.35x, her own wing skin).

**Vorago (not solved; kept here as a warning).** Three passes by another agent cut him into overlapping rigid plates
*that share corner positions*, which is exactly what the client fuses: 644 vertices, 760 faces stretching, worst
1,726 units. RS3's 24 pivot markers were dropped, so 21 joints turned around the floor. A Studio rebuild (5.9)
brought the measured stretch from 111x to 1.2x with no joint left without a pivot, and was written to the game on
that measurement. In game the owner found the face gone and the movement still wrong. Two things went wrong in the
method, not just the model: a rule that drops soft effect textures also dropped the face, and nobody compared a
render with the real RS3 creature before writing. Measure, then look, then write.

The lesson in all three: **test what the game builds, not what the file says**, never throw away RS3's marker
triangles, and compare a picture with the real thing before writing.

## 10. Looking at things

`render <draft|item:<id>|npc:<id>> --slot male --poses 808:0,419:5 --heat --out file.png`, `anim render`, and
`rs3npc rebuild --out` write PNG sheets. In a cloud session, stage the PNG to read it. Rows are front then back.

## 11. Code map

`lib/studio.js` core (drafts, build, port, bosses, game-build report) · `lib/build.js` draft to models and rows ·
`lib/port.js` the only code that writes into the server · `lib/serverdata.js` server files, ids, packet sizes ·
`lib/osrs.js` cache, definitions, animations (cache and custom) · `lib/rs3.js` RS3 cache reader and `check()` · `lib/convert.js` RS3
model to OSRS mesh · `lib/rs3shade.js` real RS3 colours, coverage, glow, pivot markers · `lib/npcport.js` RS3 creature
pipeline · `lib/stretch.js` measuring, anchors, plates, worn-item fixer · `lib/wear.js` armour labels and shoulder
pads · `lib/clientsafe.js` what the client's rebuild changes, and the repair · `lib/animedit.js` animation keys to
frames · `lib/anim.js` + `lib/model.js` shared with the browser · `lib/player.js` the player as the client builds it ·
`lib/particles.js`, `lib/icon.js`, `lib/raster.js`, `lib/png.js`, `lib/cache.js`, `lib/lzma.js` · `server.js` the
app's local server · `ui/` the app · `cli.js` this command line.

## 12. Not built yet, and known limits (be honest with the user about these)

- **RS3 caches in other forms.** Only flat-file layout is read (section 0.1), and only build 950 has been ported
  from. Other builds may read or not: `rs3check` says. Old caches with classic models (before format 2) do not.
- **Arena / area porting from RS3.** Not in the Studio. On the server this was built for, one arena was ported by a
  script (`scripts/rs3-port/vorago_arena.py`) and still has wrong colours (texture without vertex colour) and a
  two-tone floor: a flat tile floor under RS3's rock-slab objects, cutting through them.
- **Object (scenery) creator and map placement.** Not built. Objects are definition-bundle rows of kind `loc`;
  placement is `data/regions/<region>.pack` or `data/definitions/object-spawns.json`; in game `::object`.
- **Flow textures** (fire cape, infernal cape style). Not built. The Studio's model writer has no textured faces
  yet (textures are baked to their average colour), so a flowing texture cannot be assigned to a face.
- **Porting RS3 animations.** The Studio rebuilds models against animations that are already converted
  (`custom-seqs.json`). Converting RS3 animation data itself is still the Python scripts (`rs3anim.py`,
  `osrsanim.py`, `rs3skel.py`); the 950 cache has no classic frames, they came from a 2016 cache.
- **Skeletal animations** (TzKal-Zuk) are listed but not played, measured or edited.
- **One packet for all custom animations** (65,535 bytes; 47,033 used on 27 Nov 2026). Lifting it needs a client and
  server change so `customSeqs` appends like `customParticles` does.
- **RS3 capes**: only the first worn model is converted. Master capes also have a skill-emblem model that needs the
  decal rebuild in `port_capes.py` (`decal_geometry`), not ported to the Studio.
- **Custom NPCs made in the Studio cannot use custom animations** (server-side rule in the cache-editor).
- Player animations with fine rotations need the client's fractional-rotation path. If one looks wrong in game,
  set `anim.fine` to 1 on the draft and port again.
- `workspace/tmp` holds test pictures. They are the Studio's own files and safe for the user to remove.
