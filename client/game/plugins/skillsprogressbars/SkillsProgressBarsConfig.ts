/*
 * Ported from m0bilebtw's Skills Tab Progress Bars (BSD-2-Clause).
 * Copyright (c) 2020, m0bilebtw
 * Copyright (c) 2021, Hydrox6 <ikada@protonmail.ch>
 * See LICENSE in this directory.
 */
import { MAX_REAL_LEVEL, MAX_VIRTUAL_LEVEL, MAX_XP, getXpForLevel } from "../../../rs/skill/skills";
import { ConfigGroup, ConfigItem, ConfigSection } from "@runelite/client/config/ConfigItem";

export enum DarkenType {
    None = "None",
    Level99 = "Level99",
    LevelCustom = "LevelCustom",
    XP200m = "XP200m",
    XPCustom = "XPCustom",
}

const SECTION_DARKEN = ConfigSection({ name: "Darken", position: 10 });
const SECTION_COLOURS = ConfigSection({ name: "Bar Colours", position: 20 });

/** Upstream 1.5.3 SkillsTabProgressBarsConfig: group, keys, defaults, ranges and sections. */
export const SkillsProgressBarsConfig = ConfigGroup(
    "skillstabprogressbars",
    {
        indent: ConfigItem({
            name: "Match skill panel indent",
            description: "Progress bars and backgrounds will start and stop a few pixels indented to match the skill panel.",
            position: 1,
            default: true,
        }),
        barHeight: ConfigItem({
            name: "Progress bar height",
            description: "The total height of the progress bars displayed over the skills tab (with goals showing, height is shared between the bars if set too high).",
            position: 2,
            range: { min: 1, max: 30 },
            default: 2,
        }),
        virtualLevels: ConfigItem({
            name: "Show for virtual levels",
            description: "Show progress towards 'virtual levels' past 99.",
            position: 3,
            default: false,
        }),
        stillShowAt200m: ConfigItem({
            name: "Still show at 200m",
            description: "Show full progress bar at 200m XP. This was previous unintentional behaviour, kept available for those that want it.",
            position: 4,
            default: false,
        }),
        showGoals: ConfigItem({
            name: "Show goals progress",
            description: "Show progress towards the goals you set using the in-game XP menu in addition to progress towards individual levels.",
            position: 6,
            default: false,
        }),
        showOnlyGoals: ConfigItem({
            name: "Show ONLY goals progress",
            description: "Hides progress towards individual levels leaving only goals progress.",
            position: 7,
            default: false,
        }),
        showOnHover: ConfigItem({
            keyName: "showOnlyOnHover",
            name: "Only show when hovered",
            description: "Only show the progress bars and goals for a skill when it is being hovered over.",
            position: 8,
            default: false,
        }),
        darkenType: ConfigItem<DarkenType>({
            name: "Darken skills",
            description: "When, if ever, should a skill stone be darkened?",
            position: 1,
            section: SECTION_DARKEN.name,
            enum: DarkenType,
            enumLabels: {
                None: "None",
                Level99: "Level 99",
                LevelCustom: "Custom Level",
                XP200m: "200m XP",
                XPCustom: "Custom XP",
            },
            default: DarkenType.XP200m,
        }),
        darkenMembersSkills: ConfigItem({
            name: "Always darken members skills",
            description: "In addition to the 'Darken skills' option, should members skills always be darkened?",
            position: 2,
            section: SECTION_DARKEN.name,
            default: false,
        }),
        darkenOpacity: ConfigItem({
            keyName: "grayOutOpacity",
            name: "Darken skills opacity",
            description: "Controls how dark skills get when darkened, either by level or XP limits.",
            position: 3,
            section: SECTION_DARKEN.name,
            range: { min: 0, max: 255 },
            default: 127,
        }),
        darkenCustomLevel: ConfigItem({
            name: "Custom darken level",
            description: "If Darken skills is set to Custom Level, this is the override value to use.",
            position: 4,
            section: SECTION_DARKEN.name,
            range: { min: 1, max: MAX_VIRTUAL_LEVEL },
            default: MAX_REAL_LEVEL,
        }),
        darkenCustomXP: ConfigItem({
            name: "Custom darken XP",
            description: "If Darken skills is set to Custom XP, this is the override value to use.",
            position: 5,
            section: SECTION_DARKEN.name,
            range: { min: 0, max: MAX_XP },
            default: getXpForLevel(MAX_REAL_LEVEL),
        }),
        hideProgressBarWhenDarkened: ConfigItem({
            name: "Hide progress bar if darkened",
            description: "If a skill is darkened by a level or XP threshold, this option will also hide its progress bar.",
            position: 6,
            section: SECTION_DARKEN.name,
            default: false,
        }),
        hideGoalBarWhenDarkened: ConfigItem({
            name: "Hide goal bar if darkened",
            description: "If a skill is darkened by a level or XP threshold, this option will also hide its goal bar.",
            position: 7,
            section: SECTION_DARKEN.name,
            default: false,
        }),
        progressBarStartColor: ConfigItem({
            name: "Start color",
            description: "The color from which the progress bar fades.",
            position: 1,
            section: SECTION_COLOURS.name,
            color: true,
            alpha: true,
            default: 0xffff0000,
        }),
        progressBarEndColor: ConfigItem({
            name: "End color",
            description: "The color to which the progress bar fades.",
            position: 2,
            section: SECTION_COLOURS.name,
            color: true,
            alpha: true,
            default: 0xff00ff00,
        }),
        backgroundColor: ConfigItem({
            name: "Background color",
            description: "Sets the color for the background drawn behind progress bars.",
            position: 3,
            section: SECTION_COLOURS.name,
            color: true,
            alpha: true,
            default: 0xff000000,
        }),
        goalBarStartColor: ConfigItem({
            name: "Goal start color",
            description: "The color from which the goal bar fades.",
            position: 4,
            section: SECTION_COLOURS.name,
            color: true,
            alpha: true,
            default: 0xff0000ff,
        }),
        goalBarEndColor: ConfigItem({
            name: "Goal end color",
            description: "The color to which the goal bar fades.",
            position: 5,
            section: SECTION_COLOURS.name,
            color: true,
            alpha: true,
            default: 0xffff0080,
        }),
    },
    { sections: { [SECTION_DARKEN.name]: SECTION_DARKEN, [SECTION_COLOURS.name]: SECTION_COLOURS } },
);
