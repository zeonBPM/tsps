import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GameState } from "@runelite/api/GameState";
import { ConfigChanged, GameStateChanged, StatChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { getLevelForXp, getXpForLevel, SkillId } from "../rs/skill/skills";
import { WidgetType } from "../widgets/custom/dynamicWidgets";
import { SKILL_DATA, skillDataAt } from "../game/plugins/skillsprogressbars/SkillData";
import {
    DarkenType,
    SkillsProgressBarsConfig,
} from "../game/plugins/skillsprogressbars/SkillsProgressBarsConfig";
import { SkillsProgressBarsPlugin } from "../game/plugins/skillsprogressbars/SkillsProgressBarsPlugin";
import { alpha, hsbToArgb, lerpAlpha, lerpHsb, progressFraction, rgbToHsb } from "../game/plugins/skillsprogressbars/color";

// --- The ported data/API -------------------------------------------------------------------------
assert.equal(SkillsProgressBarsConfig.group, "skillstabprogressbars");
assert.equal(SkillsProgressBarsConfig.items.barHeight.default, 2);
assert.equal(SkillsProgressBarsConfig.items.barHeight.range?.max, 30);
assert.equal(SkillsProgressBarsConfig.items.showOnHover.keyName, "showOnlyOnHover");
assert.equal(SkillsProgressBarsConfig.items.darkenType.default, DarkenType.XP200m);
assert.equal(SkillsProgressBarsConfig.items.darkenCustomXP.default, getXpForLevel(99));
assert.equal(SkillsProgressBarsConfig.items.progressBarStartColor.default, 0xffff0000);
assert.equal(SkillsProgressBarsConfig.items.goalBarEndColor.default, 0xffff0080);
assert.equal(SkillsProgressBarsPlugin.descriptor.configKey, "skillstabprogressbarsplugin");
assert.equal(SkillsProgressBarsPlugin.descriptor.enabledByDefault, undefined, "on by default, as upstream");

const registry = readFileSync(join(__dirname, "../runelite/client/plugins/index.ts"), "utf8");
const list = registry.slice(registry.indexOf("CORE_PLUGINS"), registry.indexOf("];", registry.indexOf("CORE_PLUGINS")));
assert.match(list, /^\s+SkillsProgressBarsPlugin,$/m, "registered as a core plugin");

assert.equal(SKILL_DATA.length, 24);
assert.deepEqual(SKILL_DATA.slice(0, 8).map((entry) => entry.skill), [
    SkillId.Attack, SkillId.Strength, SkillId.Defence, SkillId.Ranged,
    SkillId.Prayer, SkillId.Magic, SkillId.Runecraft, SkillId.Construction,
]);
assert.equal(skillDataAt(0)?.goalStartVarp, 1229);
assert.equal(skillDataAt(0)?.goalEndVarp, 1253);
assert.equal(skillDataAt(23)?.skill, SkillId.Sailing);
assert.equal(skillDataAt(23)?.goalStartVarp, 4964);
assert.equal(skillDataAt(23)?.goalEndVarp, 4965);

assert.deepEqual(rgbToHsb(0xffff0000), [0, 1, 1]);
assert.equal(hsbToArgb([0, 1, 1]), 0xffff0000);
assert.equal(lerpHsb(rgbToHsb(0xffff0000), rgbToHsb(0xff00ff00), 0.5), 0xffffff00, "red -> green passes through yellow");
assert.equal(lerpAlpha(0, 255, 0.5), 128);
assert.equal(alpha(0x800000ff), 0x80);
assert.equal(progressFraction(150, 100, 200), 0.5);
assert.equal(progressFraction(200, 200, 200), 1);
assert.equal(progressFraction(100, 200, 200), 0);

// --- A fake stats tab and the client surfaces the plugin uses ------------------------------------
const UNIVERSE = (320 << 16) | 0;

function widget(uid: number, type: number = WidgetType.LAYER): any {
    return {
        uid, id: uid, parentUid: uid === UNIVERSE ? -1 : UNIVERSE, groupId: 320, fileId: -1,
        type, isIf3: true, isHidden: false, hidden: false, children: null,
        x: 0, y: 0, width: 48, height: 30, rawWidth: 48, rawHeight: 30,
        xPositionMode: 0, yPositionMode: 0, widthMode: 0, heightMode: 0,
        filled: false, transparency: 0, textColor: 0, color: 0,
    };
}

class FakeWidgetManager {
    readonly widgets = new Map<number, any>();
    private readonly staticChildren = new Map<number, any[]>();
    private nextDynamicUid = 0x7000_0000;

    getWidgetByUid(uid: number): any | undefined { return this.widgets.get(uid); }
    getStaticChildrenByParentUid(uid: number): any[] { return this.staticChildren.get(uid) ?? []; }
    addStaticChild(parentUid: number, child: any): void {
        const children = this.staticChildren.get(parentUid) ?? [];
        children.push(child);
        this.staticChildren.set(parentUid, children);
        this.widgets.set(child.uid, child);
    }
    allocateDynamicUid(): number { return this.nextDynamicUid++; }
    registerWidget(w: any): void { this.widgets.set(w.uid, w); }
    unregisterWidgetTree(w: any): void {
        this.widgets.delete(w.uid);
        for (const child of w.children ?? []) if (child) this.unregisterWidgetTree(child);
    }
    invalidateDynamicChildrenCache(): void {}
    invalidateWidget(): void {}
    invalidateWidgetRender(): void {}
}

const manager = new FakeWidgetManager();
manager.widgets.set(UNIVERSE, widget(UNIVERSE));
const attackTile = widget((320 << 16) | 1);
const strengthTile = widget((320 << 16) | 2);
manager.addStaticChild(UNIVERSE, attackTile);

const experience = new Array(24).fill(0);
const varps = new Map<number, number>();
varps.set(1229, 100); // Attack goal start
varps.set(1253, 1000); // Attack goal end

const client: any = {
    getGameState: () => GameState.LOGGED_IN,
    getVarpValue: (id: number) => varps.get(id) ?? 0,
};
const osrsClient: any = {
    widgetManager: manager,
    cs2Vm: { context: { getStatXp: (skill: SkillId) => experience[skill] ?? 0 } },
};
const configManager = new ConfigManager();
function change(key: string, value: unknown): void {
    configManager.setConfiguration(SkillsProgressBarsConfig.group, key, String(value));
    plugin.onConfigChanged(new ConfigChanged(SkillsProgressBarsConfig.group, key, undefined, String(value)));
}

const attackStart = getXpForLevel(10);
const attackEnd = getXpForLevel(11);
experience[SkillId.Attack] = Math.floor((attackStart + attackEnd) / 2);
experience[SkillId.Strength] = getXpForLevel(20);

const plugin = new SkillsProgressBarsPlugin(osrsClient, client, configManager);
const vm: any = { sourceScriptEvent: { widget: attackTile } };

async function main(): Promise<void> {
    await plugin.start();

    // Startup builds the five rectangles for the already-open skills tab.
    assert.equal(attackTile.children?.length, 5, "darken + four bar rectangles");
    const [darken, barBackground, barForeground, goalBackground, goalForeground] = attackTile.children!;
    assert.equal(darken.filled, true);
    assert.equal(barBackground.type, WidgetType.RECTANGLE);
    assert.equal(barForeground.yPositionMode, 2, "bottom-anchored");
    assert.equal(barBackground.widthMode, 1, "background is minus-width");
    assert.equal(barForeground.widthMode, 0, "foreground is absolute-width");

    const expectedBarPercent = progressFraction(experience[SkillId.Attack], attackStart, attackEnd);
    assert.ok(barForeground.rawWidth > 0, "a level bar is drawn");
    assert.equal(barForeground.rawWidth, Math.floor(40 * expectedBarPercent), "indented by four pixels each side");
    assert.equal(barBackground.rawHeight, 2);
    assert.equal(goalForeground.transparency, 255, "goals are off by default");
    assert.equal(goalBackground.transparency, 255);
    assert.equal(darken.transparency, 255, "not darkened below 200m");

    // A repeated init for the same tile must not duplicate the widgets.
    plugin.onScriptPreFired(394, vm);
    plugin.onScriptFinished(394);
    assert.equal(attackTile.children?.length, 5, "the same skill's bars are not rebuilt twice");

    // A different skill arrives through the init script event.
    vm.sourceScriptEvent.widget = strengthTile;
    manager.addStaticChild(UNIVERSE, strengthTile);
    plugin.onScriptPreFired(394, vm);
    plugin.onScriptFinished(394);
    assert.equal(strengthTile.children?.length, 5, "a script-built skill gets its own bars");

    // Goal varps are polled on game ticks, and an enabled goal bar uses the blue -> pink fade.
    varps.set(1229, 0);
    varps.set(1253, 2000);
    change("showGoals", true);
    assert.equal(goalBackground.transparency, 0, "black background is opaque");
    assert.ok(goalForeground.rawWidth > 0, "the goal bar follows the varps");
    assert.equal(goalForeground.textColor, lerpHsb(rgbToHsb(0xff0000ff), rgbToHsb(0xffff0080), experience[SkillId.Attack] / 2000));

    // 200m darkens the tile by default and hides the level bar, but not the goal bar.
    experience[SkillId.Attack] = 200_000_000;
    plugin.onStatChanged(new StatChanged(SkillId.Attack, experience[SkillId.Attack], 126, 126));
    assert.equal(darken.transparency, 255 - 127);
    assert.equal(barForeground.transparency, 255, "the level bar is not calculated at 200m");
    assert.ok(goalForeground.rawWidth > 0, "the goal bar is still shown");
    change("virtualLevels", true);
    change("stillShowAt200m", true);
    assert.equal(barForeground.transparency, 0, "full, opaque level bar at 200m with virtual levels");

    // Hover-only mode hides all five children until the skill is hovered, and the container
    // listener hides the last hovered skill again.
    change("showOnlyOnHover", true);
    for (const child of attackTile.children!) assert.equal(child.hidden, true);
    (attackTile as any).jsListeners.onMouseOver();
    for (const child of attackTile.children!) assert.equal(child.hidden, false);
    (manager.getWidgetByUid(UNIVERSE) as any).jsListeners.onMouseLeave();
    for (const child of attackTile.children!) assert.equal(child.hidden, true);

    // Game state and shutdown clean up the widgets and listeners.
    plugin.onGameStateChanged(new GameStateChanged(GameState.HOPPING));
    assert.equal(attackTile.children?.length, 0);
    assert.equal(strengthTile.children?.length, 0);
    assert.equal((manager.getWidgetByUid(UNIVERSE) as any).jsListeners.onMouseLeave, undefined);
    assert.equal((attackTile as any).jsListeners.onMouseOver, undefined);

    experience[SkillId.Attack] = 1000;
    await plugin.start();
    plugin.onGameStateChanged(new GameStateChanged(GameState.LOGGED_IN));
    assert.equal(attackTile.children?.length, 5, "login rebuilds the bars");
    await plugin.stop();
    assert.equal(attackTile.children?.length, 0);
}

void main();
