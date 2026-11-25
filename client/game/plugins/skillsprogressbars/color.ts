/*
 * Ported from m0bilebtw's Skills Tab Progress Bars (BSD-2-Clause).
 * Copyright (c) 2020, m0bilebtw
 * Copyright (c) 2021, Hydrox6 <ikada@protonmail.ch>
 * See LICENSE in this directory.
 */

/** A Java `float[]` from `Color.RGBtoHSB`: hue, saturation and brightness in [0, 1]. */
export type Hsb = readonly [number, number, number];

export function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

/** The fraction of `start..end` reached by `current`, with a safe zero-width range. */
export function progressFraction(current: number, start: number, end: number): number {
    if (!(end > start)) return current >= end ? 1 : 0;
    return clamp01((current - start) / (end - start));
}

export function alpha(argb: number): number {
    return ((argb >>> 24) & 0xff) | 0;
}

export function rgbToHsb(argb: number): Hsb {
    const r = ((argb >>> 16) & 0xff) / 255;
    const g = ((argb >>> 8) & 0xff) / 255;
    const b = (argb & 0xff) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const saturation = max === 0 ? 0 : delta / max;
    let hue = 0;
    if (delta !== 0) {
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue /= 6;
        if (hue < 0) hue += 1;
    }
    return [hue, saturation, max];
}

/** Java `Color.getHSBColor`: an opaque ARGB int, as the widget colour fields expect it. */
export function hsbToArgb(hsb: Hsb): number {
    const [rawHue, saturation, brightness] = hsb;
    // Java's Color.HSBtoRGB treats hue 1 as 0.
    const hue = rawHue === 1 ? 0 : rawHue;
    const sector = Math.min(5, Math.max(0, Math.floor(hue * 6)));
    const fraction = hue * 6 - sector;
    // Java's p, q and t: p is the contribution left after removing saturation,
    // q fades in over the sector and t fades out.
    const p = brightness * (1 - saturation);
    const q = brightness * (1 - saturation * fraction);
    const t = brightness * (1 - saturation * (1 - fraction));
    let r: number;
    let g: number;
    let b: number;
    switch (sector) {
        case 0: r = brightness; g = t; b = p; break;
        case 1: r = q; g = brightness; b = p; break;
        case 2: r = p; g = brightness; b = t; break;
        case 3: r = p; g = q; b = brightness; break;
        case 4: r = t; g = p; b = brightness; break;
        default: r = brightness; g = p; b = q; break;
    }
    const byte = (value: number) => Math.min(255, Math.max(0, Math.round(value * 255))) & 0xff;
    return (0xff000000 | (byte(r) << 16) | (byte(g) << 8) | byte(b)) >>> 0;
}

/** Linear interpolation in HSB, as upstream `lerpHSB`. */
export function lerpHsb(start: Hsb, end: Hsb, percent: number): number {
    const t = clamp01(percent);
    return hsbToArgb([
        start[0] + t * (end[0] - start[0]),
        start[1] + t * (end[1] - start[1]),
        start[2] + t * (end[2] - start[2]),
    ]);
}

export function lerpAlpha(start: number, end: number, percent: number): number {
    return Math.round(start + clamp01(percent) * (end - start));
}
