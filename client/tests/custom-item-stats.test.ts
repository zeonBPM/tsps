import assert from "node:assert/strict";
import { test } from "node:test";

import { CustomItemRegistry } from "../custom/items/CustomItemRegistry";
import { CustomObjTypeLoader } from "../custom/items/CustomObjTypeLoader";
import { readItemStats } from "../game/plugins/itemstats/itemStats";
import { ObjType } from "../rs/config/objtype/ObjType";

const info = {
    name: "test",
    game: "oldschool",
    environment: "live",
    revision: 235,
    timestamp: 0,
    size: 0,
} as const;

test("custom item bonuses replace inherited base stats in hover tooltips", (t) => {
    CustomItemRegistry.clear();
    t.after(() => CustomItemRegistry.clear());

    const base = new ObjType(35, info);
    base.params = new Map([
        [1, 65], [8, 3], [10, 71], [11, 2], [12, 5], [189, 9], [299, 40], [14, 5],
    ]);
    const loader = new CustomObjTypeLoader({
        load: (id: number) => id === 35 ? base : new ObjType(id, info),
        getCount: () => 35000,
        clearCache() {},
    }, info);

    const bonuses = [58, 69, -2, 0, 0, 0, 3, 2, 15, 0, 71, 0, 0, 2];
    CustomItemRegistry.register({
        id: 60002,
        baseItemId: 35,
        objType: { name: "Caledfwlch" },
        itemDef: { bonuses },
    });
    const custom = loader.load(60002);
    const stats = readItemStats(custom);
    assert.equal(stats.attackSlash, 69);
    assert.equal(stats.defenceMagic, 15);
    assert.equal(stats.strength, 71);
    assert.equal(stats.rangedStrength, 0, "the base item's separate ranged strength params must not survive");
    assert.equal(stats.magicDamage, 0, "the base item's magic damage must not survive");
    assert.equal(stats.prayer, 2);
    assert.equal(custom.params?.get(1), 69);
    assert.equal(base.params.get(1), 65, "custom stat overrides must not mutate the cached base item");

    CustomItemRegistry.register({
        id: 60003,
        baseItemId: 35,
        objType: { name: "Inherited stats" },
    });
    const inherited = readItemStats(loader.load(60003));
    assert.equal(inherited.attackSlash, 65, "custom items without explicit bonuses still inherit the base stats");

    CustomItemRegistry.register({
        id: 60004,
        baseItemId: 35,
        objType: { name: "Ranged and magic" },
        itemDef: { bonuses: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 15, 1] },
    });
    const hybrid = readItemStats(loader.load(60004));
    assert.equal(hybrid.rangedStrength, 7);
    assert.equal(hybrid.magicDamage, 15, "percent magic damage is stored in cache params as tenths");
    assert.equal(hybrid.prayer, 1);
});
