/*
 * Ported from m0bilebtw's Skills Tab Progress Bars (BSD-2-Clause).
 * Copyright (c) 2020, m0bilebtw
 * Copyright (c) 2021, Hydrox6 <ikada@protonmail.ch>
 * See LICENSE in this directory.
 */
import * as VarPlayerID from "@runelite/api/gameval/VarPlayerID";
import { SKILL_DISPLAY_ORDER, SkillId } from "../../../rs/skill/skills";

export interface SkillData {
    readonly skill: SkillId;
    readonly goalStartVarp: number;
    readonly goalEndVarp: number;
}

/** RuneLite's XPDROPS_* goal varps, in this client's skill display order. */
const GOAL_VARPS: Record<SkillId, readonly [number, number]> = {
    [SkillId.Attack]: [VarPlayerID.XPDROPS_ATTACK_START, VarPlayerID.XPDROPS_ATTACK_END],
    [SkillId.Strength]: [VarPlayerID.XPDROPS_STRENGTH_START, VarPlayerID.XPDROPS_STRENGTH_END],
    [SkillId.Defence]: [VarPlayerID.XPDROPS_DEFENCE_START, VarPlayerID.XPDROPS_DEFENCE_END],
    [SkillId.Ranged]: [VarPlayerID.XPDROPS_RANGED_START, VarPlayerID.XPDROPS_RANGED_END],
    [SkillId.Prayer]: [VarPlayerID.XPDROPS_PRAYER_START, VarPlayerID.XPDROPS_PRAYER_END],
    [SkillId.Magic]: [VarPlayerID.XPDROPS_MAGIC_START, VarPlayerID.XPDROPS_MAGIC_END],
    [SkillId.Runecraft]: [VarPlayerID.XPDROPS_RUNECRAFT_START, VarPlayerID.XPDROPS_RUNECRAFT_END],
    [SkillId.Construction]: [VarPlayerID.XPDROPS_CONSTRUCTION_START, VarPlayerID.XPDROPS_CONSTRUCTION_END],
    [SkillId.Hitpoints]: [VarPlayerID.XPDROPS_HITPOINTS_START, VarPlayerID.XPDROPS_HITPOINTS_END],
    [SkillId.Agility]: [VarPlayerID.XPDROPS_AGILITY_START, VarPlayerID.XPDROPS_AGILITY_END],
    [SkillId.Herblore]: [VarPlayerID.XPDROPS_HERBLORE_START, VarPlayerID.XPDROPS_HERBLORE_END],
    [SkillId.Thieving]: [VarPlayerID.XPDROPS_THIEVING_START, VarPlayerID.XPDROPS_THIEVING_END],
    [SkillId.Crafting]: [VarPlayerID.XPDROPS_CRAFTING_START, VarPlayerID.XPDROPS_CRAFTING_END],
    [SkillId.Fletching]: [VarPlayerID.XPDROPS_FLETCHING_START, VarPlayerID.XPDROPS_FLETCHING_END],
    [SkillId.Slayer]: [VarPlayerID.XPDROPS_SLAYER_START, VarPlayerID.XPDROPS_SLAYER_END],
    [SkillId.Hunter]: [VarPlayerID.XPDROPS_HUNTER_START, VarPlayerID.XPDROPS_HUNTER_END],
    [SkillId.Mining]: [VarPlayerID.XPDROPS_MINING_START, VarPlayerID.XPDROPS_MINING_END],
    [SkillId.Smithing]: [VarPlayerID.XPDROPS_SMITHING_START, VarPlayerID.XPDROPS_SMITHING_END],
    [SkillId.Fishing]: [VarPlayerID.XPDROPS_FISHING_START, VarPlayerID.XPDROPS_FISHING_END],
    [SkillId.Cooking]: [VarPlayerID.XPDROPS_COOKING_START, VarPlayerID.XPDROPS_COOKING_END],
    [SkillId.Firemaking]: [VarPlayerID.XPDROPS_FIREMAKING_START, VarPlayerID.XPDROPS_FIREMAKING_END],
    [SkillId.Woodcutting]: [VarPlayerID.XPDROPS_WOODCUTTING_START, VarPlayerID.XPDROPS_WOODCUTTING_END],
    [SkillId.Farming]: [VarPlayerID.XPDROPS_FARMING_START, VarPlayerID.XPDROPS_FARMING_END],
    [SkillId.Sailing]: [VarPlayerID.XPDROPS_SAILING_START, VarPlayerID.XPDROPS_SAILING_END],
};

/** Indexed the same way as the stats tab's skill tiles (`child id - 1`). */
export const SKILL_DATA: readonly SkillData[] = SKILL_DISPLAY_ORDER.map((skill) => ({
    skill,
    goalStartVarp: GOAL_VARPS[skill][0],
    goalEndVarp: GOAL_VARPS[skill][1],
}));

/** The child widget id's low 16 bits minus one, as RuneLite's `SkillData.get`. */
export function skillDataAt(index: number): SkillData | undefined {
    return SKILL_DATA[index];
}

export function skillDataFor(skill: SkillId): SkillData | undefined {
    return SKILL_DATA.find((entry) => entry.skill === skill);
}
