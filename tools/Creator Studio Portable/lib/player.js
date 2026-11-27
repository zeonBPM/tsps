'use strict';
// Builds the player model the way the game client does: identity kits for the body parts that are showing,
// then the worn items. Worn armour decides which kits are hidden (an item's wearPos2/wearPos3).
const Model = require('./model');
const PART_NAMES = ['head', 'jaw', 'torso', 'arms', 'hands', 'legs', 'feet'];
const SLOT_TO_PART = { 4: 2, 6: 3, 7: 5, 8: 0, 9: 4, 10: 6, 11: 1 };   // composition slot -> kit part
const SLOT_REPLACES = { 4: 2, 7: 5, 9: 4, 10: 6 };                     // an item in this slot replaces that kit
const SLOT_NAMES = { 0: 'head', 1: 'cape', 2: 'amulet', 3: 'weapon', 4: 'body', 5: 'shield', 7: 'legs', 9: 'hands', 10: 'feet', 12: 'ring', 13: 'ammo' };

/** Which kit parts an item hides. */
function hiddenParts(wear) {
  const hidden = new Set();
  for (const w of wear) {
    if (SLOT_REPLACES[w.wearPos] !== undefined) hidden.add(SLOT_REPLACES[w.wearPos]);
    for (const s of [w.wearPos2, w.wearPos3]) if (SLOT_TO_PART[s] !== undefined) hidden.add(SLOT_TO_PART[s]);
  }
  return hidden;
}
/**
 * wear: [{ tag, meshes:[mesh], wearPos, wearPos2, wearPos3 }]
 * returns { mesh (merged, labels deduplicated like the client), sources:[tag per source model], hidden:[part names] }
 */
function build(osrs, opt) {
  const female = !!opt.female, wear = opt.wear || [], hidden = hiddenParts(wear);
  const list = [], sources = [];
  const kits = osrs.defaultKits(female);
  for (let part = 0; part < 7; part++) {
    if (hidden.has(part) || !kits[part] || opt.noBody) continue;
    for (const id of kits[part].models) {
      const m = osrs.mesh(id); if (!m) continue;
      kits[part].recolorFrom.forEach((f, i) => Model.recolor(m, f, kits[part].recolorTo[i]));
      list.push(m); sources.push('kit:' + PART_NAMES[part]);
    }
  }
  for (const w of wear) for (const m of w.meshes) { if (m) { list.push(m); sources.push(w.tag || 'item'); } }
  const mesh = Model.merge(list);
  return { mesh, sources, hidden: [...hidden].map((p) => PART_NAMES[p]) };
}
/** The worn meshes of a cache item for one sex, with the definition's recolours and offsets applied. */
function wornMeshes(osrs, def, female) {
  const ids = female ? [def.femaleModel, def.femaleModel1, def.femaleModel2] : [def.maleModel, def.maleModel1, def.maleModel2];
  const off = female ? def.womanwear : def.manwear, out = [];
  for (const id of ids) {
    if (id === undefined || id < 0) continue;
    const m = osrs.mesh(id); if (!m) continue;
    (def.recolorFrom || []).forEach((f, i) => Model.recolor(m, f, def.recolorTo[i]));
    if (off && (off[0] || off[1] || off[2])) Model.transform(m, { translate: off });
    out.push(m);
  }
  return out;
}
module.exports = { build, wornMeshes, hiddenParts, PART_NAMES, SLOT_TO_PART, SLOT_REPLACES, SLOT_NAMES };
