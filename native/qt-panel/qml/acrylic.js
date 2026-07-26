.pragma library

// Port of the Fluent acrylic tint math from microsoft-ui-xaml's AcrylicBrush
// (dev/Materials/Acrylic/AcrylicBrush.cpp). Constants are theirs, verbatim.
//
// The point of porting rather than eyeballing: Fluent does not use the tint
// opacity you hand it. It derives an effective opacity from the tint colour's
// HSV value, suppressing it for very light or very dark tints and for
// saturated ones. Picking a number by hand lands somewhere this curve never
// would, which is why a hand-tuned surface reads as "close but not it".

// AcrylicBrush.h: sc_exclusionColor { 26, 255, 255, 255 } — white at 26/255,
// blended in Exclusion mode over the blurred, saturated backdrop.
//
// Qt Quick exposes no exclusion blend mode, but for a *white* layer it does not
// need one. Exclusion is B(base, layer) = base + layer - 2·base·layer, so with
// layer = 1 it collapses to (1 - base), and applying that at opacity a gives:
//
//   out = (1-a)·base + a·(1-base) = base·(1-2a) + a
//
// A normal alpha blend of colour C at opacity b gives out = (1-b)·base + b·C.
// Equating the two: b = 2a and C = 0.5. So Fluent's exclusion layer is exactly
// a mid-grey fill at twice the exclusion alpha — a plain Rectangle.
//
// Exact within a single blending space. Qt Quick composites in sRGB; if Windows
// runs its effect graph linearly the composited result differs slightly.
var exclusionAlpha = 26 / 255;              // 0.10196…
var exclusionGrey = 0.5;
var exclusionOpacity = exclusionAlpha * 2;  // 0.20392…

function rgbToHsv(r, g, b) {
    const max = Math.max(r, Math.max(g, b));
    const min = Math.min(r, Math.min(g, b));
    const delta = max - min;
    let h = 0;
    if (delta > 0) {
        if (max === r)      h = 60 * (((g - b) / delta) % 6);
        else if (max === g) h = 60 * (((b - r) / delta) + 2);
        else                h = 60 * (((r - g) / delta) + 4);
    }
    if (h < 0)
        h += 360;
    return { h: h, s: max <= 0 ? 0 : delta / max, v: max };
}

function hsvToRgb(h, s, v) {
    const c = v * s;
    const h1 = h / 60;
    const x = c * (1 - Math.abs((h1 % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h1 < 1)      { r = c; g = x; }
    else if (h1 < 2) { r = x; g = c; }
    else if (h1 < 3) { g = c; b = x; }
    else if (h1 < 4) { g = x; b = c; }
    else if (h1 < 5) { r = x; b = c; }
    else             { r = c; b = x; }
    return { r: r + m, g: g + m, b: b + m };
}

// AcrylicBrush::GetTintOpacityModifier
function tintOpacityModifier(color) {
    const midPoint = 0.50;
    const whiteMaxOpacity = 0.45;
    const midPointMaxOpacity = 0.90;
    const blackMaxOpacity = 0.85;

    const hsv = rgbToHsv(color.r, color.g, color.b);
    if (hsv.v === midPoint)
        return midPointMaxOpacity;

    let maxDeviation;
    let lowestMaxOpacity;
    if (hsv.v > midPoint) {
        maxDeviation = 1.0 - midPoint;
        lowestMaxOpacity = whiteMaxOpacity;
    } else {
        maxDeviation = midPoint;
        lowestMaxOpacity = blackMaxOpacity;
    }

    let maxOpacitySuppression = midPointMaxOpacity - lowestMaxOpacity;
    if (hsv.s > 0)
        maxOpacitySuppression *= Math.max(1 - (hsv.s * 2), 0.0);

    const normalizedDeviation = Math.abs(hsv.v - midPoint) / maxDeviation;
    return midPointMaxOpacity - (maxOpacitySuppression * normalizedDeviation);
}

// AcrylicBrush::GetEffectiveTintColor — the alpha the tint layer actually gets.
function effectiveTintAlpha(color, tintOpacity) {
    return Math.min(1, Math.max(0, tintOpacity * tintOpacityModifier(color)));
}

// Fluent stacks a luminosity layer under the tint layer. We cannot reproduce
// the luminosity *blend mode* in plain QML, so this folds the two same-hued
// layers into the single alpha that alpha-compositing would produce. It is an
// approximation of the blend, but of the right magnitude rather than a guess.
function compositeTintAlpha(color, tintOpacity) {
    const aTint = effectiveTintAlpha(color, tintOpacity);
    const aLum = luminosityColor(color, tintOpacity).a;
    return 1 - ((1 - aLum) * (1 - aTint));
}

// AcrylicBrush::GetLuminosityColor with no explicit TintLuminosityOpacity.
// Returns { r, g, b, a } with components in 0..1.
function luminosityColor(color, tintOpacity) {
    const minHsvV = 0.125;
    const maxHsvV = 0.965;
    const hsv = rgbToHsv(color.r, color.g, color.b);
    const clampedV = Math.min(maxHsvV, Math.max(minHsvV, hsv.v));
    const rgb = hsvToRgb(hsv.h, hsv.s, clampedV);

    const minLuminosityOpacity = 0.15;
    const maxLuminosityOpacity = 1.03;
    const range = maxLuminosityOpacity - minLuminosityOpacity;
    const mapped = (tintOpacity * range) + minLuminosityOpacity;

    return { r: rgb.r, g: rgb.g, b: rgb.b, a: Math.min(mapped, 1.0) };
}
