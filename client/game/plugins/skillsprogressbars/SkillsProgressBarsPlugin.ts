/*
 * Ported from m0bilebtw's Skills Tab Progress Bars 1.5.3 (BSD-2-Clause).
 * Copyright (c) 2020, m0bilebtw
 * Copyright (c) 2021, Hydrox6 <ikada@protonmail.ch>
 * See LICENSE in this directory.
 */
import type { Client } from "@runelite/api/Client";
import type { ConfigChanged, GameStateChanged, StatChanged } from "@runelite/api/events";
import { STATS } from "@runelite/api/gameval/InterfaceID";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import type { ConfigOf } from "@runelite/client/config/ConfigItem";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientImpl } from "@runelite/impl/ClientImpl";
import {
    MAX_REAL_LEVEL,
    MAX_VIRTUAL_LEVEL,
    MAX_XP,
    SKILL_COUNT,
    SKILL_IDS,
    SkillId,
    getLevelForXp,
    getXpForLevel,
} from "../../../rs/skill/skills";
import type { Cs2Vm } from "../../../rs/cs2/Cs2Vm";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import {
    WidgetJsListeners,
    WidgetPositionMode,
    WidgetSizeMode,
    WidgetType,
    createChild,
    jsListeners,
    revalidate,
    setHidden,
    setTextColor,
} from "../../../widgets/custom/dynamicWidgets";
import type { OsrsClient } from "../../OsrsClient";
import { SKILL_DATA, skillDataAt, skillDataFor, type SkillData } from "./SkillData";
import { DarkenType, SkillsProgressBarsConfig } from "./SkillsProgressBarsConfig";
import { Hsb, alpha, lerpHsb, lerpAlpha, progressFraction, rgbToHsb } from "./color";

const SCRIPTID_STATS_INIT = 394;
const SCRIPTID_STATS_REFRESH = 393;
const SCRIPTID_STATS_SKILLTOTAL = 396;

const MINIMUM_BAR_HEIGHT = 1;
const MAXIMUM_BAR_HEIGHT = 30;
const INDENT_WIDTH_ONE_SIDE = 4;
const WIDGET_CHILD_ID_MASK = 0xffff;
const STATS_UNIVERSE = (STATS << 16) | 0;

const SKILLS_F2P = new Set<SkillId>([
    SkillId.Attack,
    SkillId.Strength,
    SkillId.Defence,
    SkillId.Ranged,
    SkillId.Prayer,
    SkillId.Magic,
    SkillId.Runecraft,
    SkillId.Hitpoints,
    SkillId.Crafting,
    SkillId.Mining,
    SkillId.Smithing,
    SkillId.Fishing,
    SkillId.Cooking,
    SkillId.Firemaking,
    SkillId.Woodcutting,
]);

type JsWidget = WidgetNode & { jsListeners?: WidgetJsListeners };

interface SkillBarWidgetGrouping {
    readonly parent: WidgetNode;
    readonly skill: SkillData;
    readonly darken: WidgetNode;
    readonly barBackground: WidgetNode;
    readonly barForeground: WidgetNode;
    readonly goalBackground: WidgetNode;
    readonly goalForeground: WidgetNode;
    readonly widgets: readonly WidgetNode[];
    /** Avoids re-laying out five widgets every tick when nothing they read has changed. */
    signature?: string;
}

function contains(grouping: SkillBarWidgetGrouping, widget: WidgetNode | null | undefined): boolean {
    return !!widget && grouping.widgets.includes(widget);
}

function setGroupHidden(manager: WidgetManager, grouping: SkillBarWidgetGrouping, hidden: boolean): void {
    for (const widget of grouping.widgets) setHidden(manager, widget, hidden);
}

/** Five rectangle children, created once per skill tile, with the modes RuneLite sets. */
function initRect(manager: WidgetManager, widget: WidgetNode, bottom: boolean, minusWidth: boolean): void {
    widget.filled = true;
    widget.hasListener = true;
    widget.transparency = 255;
    if (bottom) widget.yPositionMode = WidgetPositionMode.ABSOLUTE_BOTTOM;
    if (minusWidth) widget.widthMode = WidgetSizeMode.MINUS;
    (widget as JsWidget).jsListeners = {};
    revalidate(manager, widget);
}

/**
 * RuneLite 1.5.3 Skills Progress Bars: five rectangles per skill tile showing progress to the
 * next level and, optionally, to the in-game XP goal. Colours fade with progress; skills can be
 * darkened at a level/XP threshold.
 *
 * XP comes from each StatChanged event (and the CS2 stat table at login), because this client's
 * Client facade has no `getSkillExperience`. Widget onVarTransmit listeners do not exist here, so
 * goal varps are checked on game ticks instead.
 */
export class SkillsProgressBarsPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Skills Progress Bars",
        description: "Adds progress bars to the skills tab to show how close the next level ups are",
        tags: ["skills", "stats", "levels", "goals", "progress", "bars", "darken"],
        configKey: "skillstabprogressbarsplugin",
    };

    static config = SkillsProgressBarsConfig;

    private readonly configManager: ConfigManager;
    readonly config: ConfigOf<typeof SkillsProgressBarsConfig>;
    private readonly client: Client;
    private readonly osrsClient: OsrsClient;

    private currentWidget?: WidgetNode | null;
    private lastSkillBuiltBarsFor?: SkillData;
    private currentHovered?: SkillBarWidgetGrouping;
    private skillBars: (SkillBarWidgetGrouping | undefined)[] = new Array(SKILL_DATA.length);
    private readonly experience: number[] = new Array(SKILL_COUNT).fill(0);

    private progressStartHSB?: Hsb;
    private progressEndHSB?: Hsb;
    private goalStartHSB?: Hsb;
    private goalEndHSB?: Hsb;
    private configRevision = 0;

    constructor(osrsClient?: OsrsClient, client?: Client, configManager?: ConfigManager) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.client = client ?? new ClientImpl(this.osrsClient);
        this.configManager = configManager ?? inject(ConfigManager);
        this.config = this.configManager.getConfig(SkillsProgressBarsConfig);
    }

    protected override async startUp(): Promise<void> {
        this.loadExperience();
        if (this.client.getGameState() === GameState.LOGGED_IN) this.buildSkillBars();
    }

    protected override async shutDown(): Promise<void> {
        this.removeSkillBars();
        this.currentWidget = undefined;
        this.lastSkillBuiltBarsFor = undefined;
    }

    onConfigChanged(event: ConfigChanged): void {
        if (!this.isStarted() || event.getGroup() !== SkillsProgressBarsConfig.group) return;
        switch (event.getKey()) {
            case "progressBarStartColor": this.progressStartHSB = undefined; break;
            case "progressBarEndColor": this.progressEndHSB = undefined; break;
            case "goalBarStartColor": this.goalStartHSB = undefined; break;
            case "goalBarEndColor": this.goalEndHSB = undefined; break;
            case "showOnlyOnHover":
            case "showOnHover":
                this.handleContainerListener();
                break;
        }
        this.configRevision++;
        for (let i = 0; i < SKILL_DATA.length; i++) {
            const grouping = this.skillBars[i];
            if (!grouping) continue;
            this.handleHoverListener(grouping.parent, grouping);
            this.updateSkillBar(SKILL_DATA[i], grouping, true);
        }
    }

    onGameStateChanged(event: GameStateChanged): void {
        if (!this.isStarted()) return;
        const state = event.getGameState();
        if (state === GameState.LOGIN_SCREEN || state === GameState.HOPPING) {
            this.experience.fill(0);
            this.removeSkillBars();
            this.currentWidget = undefined;
            this.lastSkillBuiltBarsFor = undefined;
        }
        if (state === GameState.LOGGED_IN) {
            this.loadExperience();
            this.buildSkillBars();
        }
    }

    onStatChanged(event: StatChanged): void {
        if (!this.isStarted()) return;
        const skill = event.getSkill();
        if (!(skill in this.experience)) return;
        const xp = event.getXp();
        this.experience[skill] = Number.isFinite(xp) && xp >= 0 ? xp : 0;
        const data = skillDataFor(skill);
        if (data) this.updateSkillBar(data, this.skillBars[SKILL_DATA.indexOf(data)], false);
    }

    /** Replaces the upstream per-widget onVarTransmit listeners for the two goal varps. */
    onGameTick(): void {
        if (!this.isStarted()) return;
        for (let i = 0; i < SKILL_DATA.length; i++) {
            const grouping = this.skillBars[i];
            if (grouping) this.updateSkillBar(SKILL_DATA[i], grouping, false);
        }
    }

    onScriptPreFired(scriptId: number, vm?: Cs2Vm): void {
        if (!this.isStarted()) return;
        if (scriptId !== SCRIPTID_STATS_INIT && scriptId !== SCRIPTID_STATS_REFRESH) return;
        const source = this.scriptSource(vm);
        this.currentWidget = source && source.uid !== STATS_UNIVERSE ? source : null;
    }

    onScriptFinished(scriptId: number): void {
        if (!this.isStarted()) return;
        if ((scriptId === SCRIPTID_STATS_INIT || scriptId === SCRIPTID_STATS_REFRESH) && this.currentWidget) {
            this.buildSkillBar(this.currentWidget);
        } else if (scriptId === SCRIPTID_STATS_SKILLTOTAL) {
            // Always fires once when the skills tab is built, after all five bars per skill.
            this.handleContainerListener();
        }
    }

    private scriptSource(vm?: Cs2Vm): WidgetNode | null {
        const sourceVm = vm ?? this.osrsClient.cs2Vm;
        const event = (sourceVm as unknown as { sourceScriptEvent?: { widget?: WidgetNode | null } } | undefined)
            ?.sourceScriptEvent;
        return event?.widget ?? null;
    }

    private loadExperience(): void {
        const getStatXp = this.osrsClient.cs2Vm?.context?.getStatXp;
        if (!getStatXp) return;
        for (const skill of SKILL_IDS) {
            const xp = getStatXp(skill);
            if (Number.isFinite(xp) && xp >= 0) this.experience[skill] = xp;
        }
    }

    /** Adds bars to an already-built skills tab, for plugins enabled after the tab opened. */
    private buildSkillBars(): void {
        const manager = this.osrsClient.widgetManager;
        const container = manager?.getWidgetByUid(STATS_UNIVERSE);
        if (!manager || !container) return;
        for (const tile of manager.getStaticChildrenByParentUid(STATS_UNIVERSE)) this.buildSkillBar(tile);
        this.handleContainerListener();
    }

    private buildSkillBar(parent: WidgetNode): void {
        const manager = this.osrsClient.widgetManager;
        if (!manager || parent.type !== WidgetType.LAYER) return;

        const idx = ((parent.uid & WIDGET_CHILD_ID_MASK) - 1) | 0;
        const skill = skillDataAt(idx);
        if (!skill || skill === this.lastSkillBuiltBarsFor) return;
        this.lastSkillBuiltBarsFor = skill;

        // Upstream: the bottom three tiles are 32 high, which hides short bars behind the
        // full-width total-level bar. Restore the 30 used by every other skill tile.
        if (skill.skill === SkillId.Construction || skill.skill === SkillId.Hunter || skill.skill === SkillId.Sailing) {
            parent.rawHeight = MAXIMUM_BAR_HEIGHT;
            revalidate(manager, parent);
        }

        const darken = createChild(manager, parent, WidgetType.RECTANGLE);
        darken.xPositionMode = WidgetPositionMode.ABSOLUTE_CENTER;
        darken.yPositionMode = WidgetPositionMode.ABSOLUTE_CENTER;
        darken.widthMode = WidgetSizeMode.MINUS;
        darken.heightMode = WidgetSizeMode.MINUS;
        darken.rawWidth = 0;
        darken.rawHeight = 0;
        darken.filled = true;
        darken.transparency = 255;
        setTextColor(manager, darken, 0xff000000);
        darken.hasListener = true;

        const barBackground = createChild(manager, parent, WidgetType.RECTANGLE);
        initRect(manager, barBackground, true, true);
        const barForeground = createChild(manager, parent, WidgetType.RECTANGLE);
        initRect(manager, barForeground, true, false);
        const goalBackground = createChild(manager, parent, WidgetType.RECTANGLE);
        initRect(manager, goalBackground, true, true);
        const goalForeground = createChild(manager, parent, WidgetType.RECTANGLE);
        initRect(manager, goalForeground, true, false);

        const grouping: SkillBarWidgetGrouping = {
            parent,
            skill,
            darken,
            barBackground,
            barForeground,
            goalBackground,
            goalForeground,
            widgets: [darken, barBackground, barForeground, goalBackground, goalForeground],
        };

        this.updateSkillBar(skill, grouping, true);
        this.handleHoverListener(parent, grouping);

        // The init script can build a tile twice: remove the previous five children before
        // dropping the reference to them.
        const previous = this.skillBars[idx];
        if (previous) this.removeGroupWidgets(previous, false);
        this.skillBars[idx] = grouping;
    }

    private removeGroupWidgets(grouping: SkillBarWidgetGrouping, removeListeners: boolean): void {
        const manager = this.osrsClient.widgetManager;
        if (removeListeners) this.removeHoverListener(grouping);
        const children = grouping.parent.children;
        if (!manager || !Array.isArray(children)) return;
        const remaining = children.filter((child) => !contains(grouping, child));
        if (remaining.length === children.length) return;
        for (const child of children) {
            if (child && contains(grouping, child)) manager.unregisterWidgetTree(child);
        }
        grouping.parent.children = remaining;
        manager.invalidateDynamicChildrenCache(grouping.parent);
        manager.invalidateWidgetRender(grouping.parent);
    }

    private removeSkillBars(): void {
        for (const grouping of this.skillBars) if (grouping) this.removeGroupWidgets(grouping, true);
        this.skillBars = new Array(SKILL_DATA.length);
        this.currentHovered = undefined;
        this.removeContainerListener();
    }

    private handleHoverListener(parent: WidgetNode, grouping: SkillBarWidgetGrouping): void {
        if (this.config.showOnHover() === true) this.addHoverListener(parent, grouping);
        else this.removeHoverListener(grouping);
    }

    private addHoverListener(parent: WidgetNode, grouping: SkillBarWidgetGrouping): void {
        const manager = this.osrsClient.widgetManager;
        if (!manager) return;
        const node = parent as JsWidget;
        const listeners = (node.jsListeners ??= {});
        listeners.onMouseOver = () => {
            if (this.currentHovered && this.currentHovered !== grouping) {
                setGroupHidden(manager, this.currentHovered, true);
                this.updateSkillBar(this.currentHovered.skill, this.currentHovered, false);
            }
            this.currentHovered = grouping;
            setGroupHidden(manager, grouping, false);
            this.updateSkillBar(grouping.skill, grouping, false);
        };
        node.hasListener = true;
        setGroupHidden(manager, grouping, true);
        grouping.signature = undefined;
    }

    private removeHoverListener(grouping: SkillBarWidgetGrouping): void {
        const manager = this.osrsClient.widgetManager;
        const node = grouping.parent as JsWidget;
        if (jsListeners(node)) delete node.jsListeners?.onMouseOver;
        if (this.currentHovered === grouping) this.currentHovered = undefined;
        if (!manager) return;
        setGroupHidden(manager, grouping, false);
        grouping.signature = undefined;
    }

    private handleContainerListener(): void {
        const manager = this.osrsClient.widgetManager;
        const container = manager?.getWidgetByUid(STATS_UNIVERSE);
        if (!manager || !container) return;
        const node = container as JsWidget;
        const listeners = (node.jsListeners ??= {});
        if (this.config.showOnHover() === true) {
            listeners.onMouseLeave = () => {
                if (this.currentHovered) {
                    setGroupHidden(manager, this.currentHovered, true);
                    this.updateSkillBar(this.currentHovered.skill, this.currentHovered, false);
                }
                this.currentHovered = undefined;
            };
            node.hasListener = true;
        } else {
            delete listeners.onMouseLeave;
        }
    }

    private removeContainerListener(): void {
        const container = this.osrsClient.widgetManager?.getWidgetByUid(STATS_UNIVERSE) as JsWidget | undefined;
        if (container?.jsListeners) delete container.jsListeners.onMouseLeave;
    }

    private shouldDarken(skill: SkillId, currentLevel: number, currentXP: number): boolean {
        if (this.config.darkenMembersSkills() === true && !SKILLS_F2P.has(skill)) return true;
        switch (this.config.darkenType()) {
            case DarkenType.None:
                return false;
            case DarkenType.Level99:
                return currentLevel >= MAX_REAL_LEVEL;
            case DarkenType.LevelCustom:
                return currentLevel >= Number(this.config.darkenCustomLevel());
            case DarkenType.XP200m:
                return currentXP >= MAX_XP;
            case DarkenType.XPCustom:
                return currentXP >= Number(this.config.darkenCustomXP());
            default:
                return false;
        }
    }

    private getProgressStartHSB(): Hsb {
        return (this.progressStartHSB ??= rgbToHsb(Number(this.config.progressBarStartColor())));
    }

    private getProgressEndHSB(): Hsb {
        return (this.progressEndHSB ??= rgbToHsb(Number(this.config.progressBarEndColor())));
    }

    private getGoalStartHSB(): Hsb {
        return (this.goalStartHSB ??= rgbToHsb(Number(this.config.goalBarStartColor())));
    }

    private getGoalEndHSB(): Hsb {
        return (this.goalEndHSB ??= rgbToHsb(Number(this.config.goalBarEndColor())));
    }

    private updateSkillBar(skill: SkillData, grouping: SkillBarWidgetGrouping | undefined, force: boolean): void {
        const manager = this.osrsClient.widgetManager;
        if (!grouping || !manager) return;

        const currentXP = this.experience[skill.skill] ?? 0;
        const currentLevel = getLevelForXp(currentXP);
        const currentLevelXP = getXpForLevel(currentLevel);
        const nextLevelXP = currentLevel >= MAX_VIRTUAL_LEVEL ? MAX_XP : getXpForLevel(currentLevel + 1);
        const goalStartXP = this.client.getVarpValue(skill.goalStartVarp);
        const goalEndXP = this.client.getVarpValue(skill.goalEndVarp);
        const barPercent = progressFraction(currentXP, currentLevelXP, nextLevelXP);
        const goalPercent = progressFraction(currentXP, goalStartXP, goalEndXP);

        const signature = `${this.configRevision}|${currentXP}|${goalStartXP}|${goalEndXP}|${grouping === this.currentHovered}`;
        if (!force && signature === grouping.signature) return;
        grouping.signature = signature;

        const startX = this.config.indent() === true ? INDENT_WIDTH_ONE_SIDE : 0;
        const indentWidth = this.config.indent() === true ? INDENT_WIDTH_ONE_SIDE * 2 : 0;
        const maxWidth = Math.max(0, (grouping.parent.rawWidth ?? grouping.parent.width ?? 0) - indentWidth);

        const darkened = this.shouldDarken(skill.skill, currentLevel, currentXP);
        const showNormal =
            this.config.showOnlyGoals() !== true &&
            (currentLevel < MAX_REAL_LEVEL || this.config.virtualLevels() === true) &&
            (currentXP < MAX_XP || this.config.stillShowAt200m() === true) &&
            (!darkened || this.config.hideProgressBarWhenDarkened() !== true);
        const showGoal =
            goalEndXP > 0 &&
            this.config.showGoals() === true &&
            (!darkened || this.config.hideGoalBarWhenDarkened() !== true);
        const renderBars = this.config.showOnHover() !== true || grouping === this.currentHovered;

        let barHeight = Math.floor(Number(this.config.barHeight()));
        if (!Number.isFinite(barHeight)) barHeight = MINIMUM_BAR_HEIGHT;
        barHeight = Math.min(MAXIMUM_BAR_HEIGHT, Math.max(MINIMUM_BAR_HEIGHT, barHeight));
        if (barHeight > MAXIMUM_BAR_HEIGHT / 2 && showNormal && showGoal) barHeight = Math.floor(barHeight / 2);

        const darkenOpacity = Math.min(255, Math.max(0, Math.floor(Number(this.config.darkenOpacity()))));
        this.applyRect(manager, grouping.darken, {
            x: 0, y: 0, width: 0, height: 0,
            color: 0xff000000,
            transparency: darkened ? 255 - darkenOpacity : 255,
        });

        const backgroundColor = Number(this.config.backgroundColor());
        const backgroundTransparency = 255 - alpha(backgroundColor);
        const progressStartColor = Number(this.config.progressBarStartColor());
        const progressEndColor = Number(this.config.progressBarEndColor());

        if (showNormal) {
            setHidden(manager, grouping.barBackground, !renderBars);
            setHidden(manager, grouping.barForeground, !renderBars);
            this.applyRect(manager, grouping.barBackground, {
                x: startX, y: 0, width: indentWidth, height: barHeight,
                color: backgroundColor, transparency: backgroundTransparency,
            });
            this.applyRect(manager, grouping.barForeground, {
                x: startX, y: 0, width: Math.floor(maxWidth * barPercent), height: barHeight,
                color: lerpHsb(this.getProgressStartHSB(), this.getProgressEndHSB(), barPercent),
                transparency: 255 - lerpAlpha(alpha(progressStartColor), alpha(progressEndColor), barPercent),
            });
        } else {
            this.setInvisible(manager, grouping.barBackground);
            this.setInvisible(manager, grouping.barForeground);
        }

        if (showGoal) {
            const y = barHeight * (showNormal ? 1 : 0);
            const goalStartColor = Number(this.config.goalBarStartColor());
            const goalEndColor = Number(this.config.goalBarEndColor());
            setHidden(manager, grouping.goalBackground, !renderBars);
            setHidden(manager, grouping.goalForeground, !renderBars);
            this.applyRect(manager, grouping.goalBackground, {
                x: startX, y, width: indentWidth, height: barHeight,
                color: backgroundColor, transparency: backgroundTransparency,
            });
            this.applyRect(manager, grouping.goalForeground, {
                x: startX, y, width: Math.floor(maxWidth * goalPercent), height: barHeight,
                color: lerpHsb(this.getGoalStartHSB(), this.getGoalEndHSB(), goalPercent),
                transparency: 255 - lerpAlpha(alpha(goalStartColor), alpha(goalEndColor), goalPercent),
            });
        } else {
            this.setInvisible(manager, grouping.goalBackground);
            this.setInvisible(manager, grouping.goalForeground);
        }
    }

    private applyRect(
        manager: WidgetManager,
        widget: WidgetNode,
        rect: { x: number; y: number; width: number; height: number; color: number; transparency: number },
    ): void {
        widget.rawX = rect.x;
        widget.rawY = rect.y;
        widget.rawWidth = rect.width;
        widget.rawHeight = rect.height;
        widget.transparency = Math.min(255, Math.max(0, Math.round(rect.transparency)));
        setTextColor(manager, widget, rect.color);
        revalidate(manager, widget);
    }

    private setInvisible(manager: WidgetManager, widget: WidgetNode): void {
        widget.transparency = 255;
        revalidate(manager, widget);
    }
}
