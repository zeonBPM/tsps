# Porting a RuneLite-style plugin into the TSPS browser client

This is the checklist I use when bringing an external RuneLite/external-repo plugin into TSPS as a **native client plugin**. The worked example is `client/game/plugins/skillsprogressbars/`, ported from `m0bilebtw/skills-tab-progress-bars` 1.5.3.

## 1. Read the upstream source before writing any TS

- Clone into a temp dir and record the exact revision: `git rev-parse HEAD` and the tag/version from `build.gradle` or README.
- Read, in this order:
  1. `*Config.java` — group, `keyName`s, defaults, ranges, sections, colours, enums.
  2. `*Plugin.java` — lifecycle, `@Subscribe` methods, widget lifecycle.
  3. data/enum helpers — especially skill ordering.
  4. `LICENSE` — preserve the notice verbatim, including any secondary copyright holders.
- Never copy generated JSON blindly. If the plugin needs cache-derived data, use existing TSPS gameval/definitions or dump from the cache; do not hand-edit generated files.

## 2. Create the native plugin skeleton

Directory: `client/game/plugins/<slug>/`

```ts
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientImpl } from "@runelite/impl/ClientImpl";
import type { OsrsClient } from "../../OsrsClient";

export class FooPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Foo",
        description: "...",
        tags: ["..."],
        // Stable: minified class names are not.
        configKey: "fooplugin",
    };

    private readonly configManager: ConfigManager;
    private readonly client: Client;
    private readonly osrsClient: OsrsClient;

    constructor(osrsClient?: OsrsClient, client?: Client, configManager?: ConfigManager) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.client = client ?? new ClientImpl(this.osrsClient);
        this.configManager = configManager ?? inject(ConfigManager);
    }

    protected override async startUp(): Promise<void> { /* ... */ }
    protected override async shutDown(): Promise<void> { /* ... */ }
}
```

- `enabledByDefault` defaults to `true`; don't set it unless upstream disables the plugin.
- Register in `client/runelite/client/plugins/index.ts`: import the class **and** add it to `CORE_PLUGINS`.
- Add `LICENSE` and a short `README.md` in the plugin directory. State the upstream repo/version and every behavioural difference.

## 3. Port the config exactly

Use `ConfigGroup`, `ConfigItem`, `ConfigSection` from `@runelite/client/config/ConfigItem`.

Mapping table:

| RuneLite | TSPS |
| --- | --- |
| `@ConfigGroup("x")` | `ConfigGroup("x", { ... })` |
| `@ConfigItem(keyName = "foo", ...)` | property `foo: ConfigItem({ keyName: "foo", ... })` |
| `@Range(min, max)` | `range: { min, max }` |
| `@Alpha`, `Color` | `color: true, alpha: true`, ARGB `number` default |
| `@ConfigSection` | `ConfigSection({ name, position })`, referenced by `section: name` |
| enum dropdown | `enum: MyEnum, enumLabels: { ... }` |

Gotchas:
- `ConfigChanged.getKey()` returns the **storage key** (`keyName`), not the TS accessor name. Example: upstream `showOnlyOnHover` is exposed as `config.showOnHover()` but events use `"showOnlyOnHover"`.
- Get typed accessors from `configManager.getConfig(MyConfig)`: `this.config.barHeight()`.
- Invalidate cached colour conversions or layouts in `onConfigChanged`, then force one update.
- Attach `static config = MyConfig` to the plugin so the generated settings panel renders it.

## 4. Map events and hooks

Two different systems exist; don't mix them up.

### EventBus (`@Subscribe` equivalents)

Implement a method named `on<EventName>` and the `EventBus` registers it automatically when the plugin starts:

- `onConfigChanged(event: ConfigChanged)`
- `onGameStateChanged(event: GameStateChanged)`
- `onStatChanged(event: StatChanged)`
- `onGameTick()`

Import event classes from `@runelite/api/events`. Use `static subscribe = { onGameTick: { priority: 5 } }` only when ordering matters.

### `ClientPluginManager` hooks

These are bespoke methods on the plugin class, not EventBus events:

- `onScriptPreFired(scriptId, vm?)`
- `onScriptFinished(scriptId)`
- `onScriptCallback(event)`
- `widgetOverlay`, `widgetOverlays()`, `renderHud()`, `transformMenuEntries()`, etc.

Check `client/game/plugins/ClientPluginManager.ts` before assuming a RuneLite callback exists. If it isn't there, use the closest available hook and document the substitution.

## 5. Port client APIs and data

Use the `@runelite/api/*` facade for types/constants, but expect gaps. Common substitutions from the skills-bars port:

| Upstream | TSPS substitute |
| --- | --- |
| `client.getSkillExperience(skill)` | `StatChanged` events plus `osrsClient.cs2Vm.context.getStatXp(skill)` at login |
| widget `onVarTransmit` | poll varps on `onGameTick()` with a per-widget signature |
| `Experience.getLevelForXp` | `getLevelForXp` from `client/rs/skill/skills.ts` |
| `Skill.values()` / display index | `SKILL_DISPLAY_ORDER` from `client/rs/skill/skills.ts`, **not** numeric `SkillId` order |
| Java `Color.RGBtoHSB` / `HSBtoRGB` | local TS helper; Java sector order is `p/q/t`, and hue `1` wraps to `0` |
| `setOpacity(255 - alpha)` | widget `transparency` (`0` opaque, `255` hidden) |

## 6. Port widgets

Use the shared helpers in `client/game/widgets/custom/dynamicWidgets.ts`:

- `createChild(manager, parent, WidgetType.RECTANGLE)`
- `revalidate(manager, widget)` after changing geometry/colour/transparency
- `setHidden(manager, widget, hidden)`
- `setTextColor(manager, widget, argb)`
- `jsListeners` for `onMouseOver` / `onMouseLeave`

Patterns that saved time:
- Keep a typed group holding all child nodes and a `signature` string; skip relayout when XP, varps, config revision and hover state are unchanged.
- Identify skill tiles by `(uid & 0xffff) - 1`, then index into `SKILL_DISPLAY_ORDER`.
- Attach after clientscripts `394`/`393`, and install container listeners after script `396`.
- `sourceScriptEvent.widget` on the `Cs2Vm` gives the parent widget for script-driven builds.
- Remove dynamic children with `manager.unregisterWidgetTree(child)`, clear `parent.children`, and invalidate caches on shutdown/logout.
- Fix known upstream layout quirks explicitly (e.g. bottom three skill tiles need height `30`, not `32`).

## 7. Test locally

From `client/`:

```powershell
node scripts/run-tests.mjs <slug>
.\node_modules\.bin\tsc --noEmit -p tsconfig.json
```

- Add `client/tests/<slug>.test.ts` covering config keys/defaults, registration, ordering, colour math, widget creation, updates, config changes and cleanup.
- Don't rely on `yarn typecheck` on this checkout; use the direct `tsc` binary above.
- A full `node scripts/run-tests.mjs` has many pre-existing failures on this checkout (missing `server/dist`, stale mocks, cache drift). Compare against the baseline rather than treating those as regressions.

## 8. Verify in the browser

- Use `http://127.0.0.1:3000`; `localhost` has hit CORS on `/api/world-info` here.
- `window.osrsClient` is exposed for inspection.
- Check `osrsClient.clientPlugins.plugins` for the started instance, then inspect `widgetManager.getWidgetByUid(...)` children.
- If a test login stalls at ~95%, `loadingTracker.markComplete("map")` can move it to game state `30`.
- Screenshots need a visible desktop tab; widget-tree assertions are reliable when screenshots aren't.
- Clean up throwaway accounts from `server/data/saves/players.sqlite` when done, and confirm the real saves still match the backup.

## 9. Final diff hygiene

- Keep unrelated tooling churn out: don't leave `.yarnrc.yml`, `package.json` or `yarn.lock` changes in a plugin PR unless they are truly required.
- Preserve pre-existing uncommitted user changes; note them instead of reverting them.
- Run `git diff --check`.
- Confirm `LICENSE`, `README.md`, every ported source file header, the registry change and the test are all present.

## Quick done-checklist

- [ ] Upstream commit/version recorded.
- [ ] BSD/MIT notice copied into `LICENSE` and every source file.
- [ ] `ConfigGroup` keys/defaults/sections match upstream.
- [ ] Stable `configKey` set; plugin imported and in `CORE_PLUGINS`.
- [ ] `SKILL_DISPLAY_ORDER` used where upstream used skill order.
- [ ] EventBus vs ClientPluginManager hook distinction checked.
- [ ] Widgets cleaned up on config change, logout and shutdown.
- [ ] Focused test passes; direct `tsc` passes.
- [ ] Live widget verified; throwaway accounts removed.
- [ ] No unrelated Yarn/package-manager churn in the diff.
