# Skills Progress Bars

A native TSPS browser-client port of [m0bilebtw/skills-tab-progress-bars](https://github.com/m0bilebtw/skills-tab-progress-bars) 1.5.3. It draws up to five rectangle widgets on each skill tile: a darken overlay, a level-progress background/foreground and an optional goal background/foreground. Progress colours fade with the fraction completed, and the skill can be darkened at a level or XP threshold.

The upstream BSD-2-Clause notice, including Hydrox6's 2021 copyright on the skill-order/grouping code, is preserved in [`LICENSE`](LICENSE) and in each ported source file.

## Settings

Config group `skillstabprogressbars`, enabled by default, with the upstream keys and defaults: indent, bar height, virtual levels, still show at 200m, show goals, show only goals, show only on hover, the Darken section (type, members skills, opacity, custom level/XP, hide bars when darkened) and the Bar Colours section (five ARGB colours). The generated plugin-hub settings panel renders these from `SkillsProgressBarsConfig`.

## Porting notes

- The five children are created with the shared `createChild`/`revalidate` widget helpers and the same position and size modes as RuneLite's rectangles. The bottom three tiles (Construction, Hunter, Sailing) have their height reset to 30, as upstream does, so short bars are not hidden behind the total-level bar.
- Widgets are attached after clientscripts 394/393 (stats init/refresh) using the script source widget; script 396 (skill total) installs the hover-leave listener. An already-open skills tab is populated at startup/login.
- This client has no `Client.getSkillExperience`, so XP is taken from `StatChanged` events and the CS2 stat table at login. `onVarTransmit` widget listeners do not exist either, so goal varps are polled on game ticks with a per-skill signature that avoids redundant layout work.
- Skill lookup uses this client's `SKILL_DISPLAY_ORDER`; the goal varps are RuneLite's `XPDROPS_*` ids, including Sailing's 4964/4965.
- Colour interpolation is a local TypeScript implementation of Java's HSB/alpha interpolation. Widget opacity is the CS2 transparency value (`0` opaque, `255` hidden), matching RuneLite's `setOpacity(255 - alpha)`.
