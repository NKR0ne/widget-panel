pragma Singleton
import QtQuick
import QtPanel.Native
import "acrylic.js" as Acrylic

// Design tokens — single source of truth for color, radius, and spacing.
QtObject {
    readonly property bool contrastEnabled: Ui.highContrast || Sys.highContrast
    // Windows drops acrylic and mica to solid when the user turns off
    // transparency effects; a panel that kept blurring would stand out as the
    // one surface ignoring the preference — and it is a perf/accessibility
    // setting, not a cosmetic one.
    // In composition mode the blur/tint/grain stack is Windows' job, so the
    // in-scene reconstruction switches off rather than compositing a second
    // recipe over a surface that already has one.
    readonly property bool materialEnabled: Sys.transparencyEnabled && !contrastEnabled
                                            && !Panel.compositionMode

    // Surface tint. Following the system uses the shade the shell paints Start
    // with, but only when the user actually asked for accent on those surfaces
    // (ColorPrevalence); otherwise Windows itself uses a neutral, so we do too.
    readonly property color baseTint: Qt.rgba(0.043, 0.055, 0.09, 1)
    readonly property bool systemMaterial: Ui.followSystemMaterial && Sys.accentOnSurfaces
                                           && Sys.accentPalette.length >= 8 && materialEnabled
    // StartColorMenu is a tint the shell composites at high opacity over a
    // darkened backdrop, not the colour Start ends up reading as — used
    // directly it lands far too light. AccentDark2 is where Start actually
    // sits once composited.
    // AccentDark2, unmodified. It was previously interpolated a quarter-step
    // toward AccentDark3 to hit Start's measured colour, but that was
    // compensating for a tint alpha that was too high; with the alpha correct
    // the compensation would only re-darken what the transparency is for.
    readonly property color surfaceTint: systemMaterial ? Sys.accentPalette[5] : baseTint
    // Start is a flat surface: no animated sheen, no cursor-tracked glow. The
    // decorative lighting is scaled back rather than switched off so the panel
    // keeps its own depth cues without reading as a different material.
    readonly property real lightingScale: systemMaterial ? 0.55 : 1.0
    // NOT Fluent's 0.8. DWMSBT_TRANSIENTWINDOW is already a finished acrylic
    // surface — DWM has done the blur, luminosity, tint and noise inside its
    // own pipeline. Painting Fluent's full tint on top applies the recipe a
    // second time, which is what flattened the light and killed the
    // transparency. What belongs here is only the accent wash the shell adds
    // when ColorPrevalence is set, over a material that is already correct.
    readonly property real systemTintOpacity: 0.25
    readonly property real systemTintAlpha: systemMaterial
        ? Acrylic.effectiveTintAlpha(surfaceTint, systemTintOpacity) : 1.0

    // Shell accent ramp: 3 is the base accent, 4 is Start's darker shade.
    // The composition path is palette-driven too: its backdrop is the shell's
    // own acrylic, so neutral white card fills over it read as grey slabs
    // pasted onto a coloured surface rather than as part of it.
    readonly property bool paletteDriven: (systemMaterial || compositionMaterial)
                                          && Sys.accentPalette.length >= 8
    readonly property color accentBase: paletteDriven ? Sys.accentPalette[3] : accent
    readonly property color accentLight: paletteDriven ? Sys.accentPalette[2] : accent

    // Mica is a static, desaturated wallpaper sample, so the tint over it can
    // be much lighter than the one needed to tame acrylic's live desktop blur.
    // On the composition path the material behind the scene is Windows' own
    // acrylic, produced by DesktopAcrylicController with its tint, blur and
    // luminosity already applied. Anything we paint here lands on top of it and
    // covers it -- which is precisely the failure that path exists to escape.
    // So the background becomes fully transparent and the material is left to
    // Windows.
    readonly property bool compositionMaterial: Panel.compositionMode

    readonly property color bgTint: {
        if (compositionMaterial)
            return Qt.rgba(0, 0, 0, 0)
        if (contrastEnabled)
            return Qt.rgba(0.043, 0.055, 0.09, 0.82)
        if (!materialEnabled)
            return panelSolid
        const t = surfaceTint
        // Start is close to opaque: the desktop reads as a faint influence
        // behind it, not as visible content. A light tint over acrylic looks
        // nothing like it.
        // Derived by Fluent's own curve rather than picked by hand — see
        // acrylic.js. For this accent it lands near 0.72, well below the 0.92
        // that was guessed, which is most of why the surface read as a flat
        // slab instead of a lit one: the extra opacity was covering the DWM
        // acrylic underneath rather than tinting it.
        if (systemMaterial)
            return Qt.rgba(t.r, t.g, t.b, systemTintAlpha)
        // Acrylic live-blurs the desktop and needs a heavier tint to stay
        // legible; mica is a static wallpaper sample and needs far less.
        return Qt.rgba(t.r, t.g, t.b, Panel.micaBackdrop ? 0.28 : 0.45)
    }
    readonly property color panelSolid: "#11151e"
    // Elevation ladder. These used to sit within ~9% of each other, which read
    // as one flat plane; the steps below are deliberately further apart so
    // background / card / hover / active are distinguishable at a glance.
    // Mica also lightens the background, so cards need more fill to separate.
    // Following the system pulls the card fills right down. Start reads as one
    // continuous surface whose tiles are barely there at rest, where our own
    // material deliberately stacks visible card slabs; keeping our fills here
    // is what stopped Windows mode feeling like the shell, far more than the
    // background tint did.
    // On the composition path the backdrop is a dark accent acrylic, so cards
    // carry the LIGHT end of the same ramp. That is what makes them read as
    // raised surfaces of one material instead of white film over a coloured
    // one -- the fill is doing the lifting here, not the stroke.
    readonly property color cardFill: compositionMaterial
        ? Qt.rgba(accentLight.r, accentLight.g, accentLight.b, contrastEnabled ? 0.22 : 0.15)
        : systemMaterial
        ? Qt.rgba(1, 1, 1, 0.035)
        : Qt.rgba(1, 1, 1, contrastEnabled ? 0.09 : 0.075)
    readonly property color cardStroke: compositionMaterial
        ? Qt.rgba(accentLight.r, accentLight.g, accentLight.b, contrastEnabled ? 0.30 : 0.18)
        : systemMaterial
        ? Qt.rgba(1, 1, 1, 0.055)
        : Qt.rgba(1, 1, 1, contrastEnabled ? 0.20 : 0.10)
    readonly property color cardHoverFill: compositionMaterial
        ? Qt.rgba(accentLight.r, accentLight.g, accentLight.b, contrastEnabled ? 0.30 : 0.22)
        : systemMaterial
        ? Qt.rgba(1, 1, 1, 0.07)
        : Qt.rgba(1, 1, 1, contrastEnabled ? 0.13 : 0.11)
    readonly property color keyline: Qt.rgba(0.91, 0.94, 1.0, contrastEnabled ? 0.34 : 0.16)
    readonly property color keylineMuted: Qt.rgba(0.72, 0.77, 0.86, 0.08)
    readonly property color skeleton: Qt.rgba(1, 1, 1, 0.07)
    // Highlights. Start tints its hover and selection with the accent ramp
    // rather than neutral white, so following the system does the same — this
    // is most of what makes list rows and buttons read as shell surfaces.
    readonly property color hover: systemMaterial
        ? Qt.rgba(accentLight.r, accentLight.g, accentLight.b, 0.16)
        : Qt.rgba(1, 1, 1, 0.10)
    readonly property color activeFill: systemMaterial
        ? Qt.rgba(accentBase.r, accentBase.g, accentBase.b, 0.42)
        : Qt.rgba(1, 1, 1, 0.18)
    // Grain strength shared by every material surface (cards and the acrylic
    // transient layers), so they age the same way.
    // Fluent's sc_noiseOpacity, verbatim. Both the 0.03 used before and the
    // 0.012 guessed for system mode were wrong in opposite directions.
    readonly property real grainOpacity: contrastEnabled ? 0 : 0.02
    readonly property color textPrimary: "#e8eaf2"
    readonly property color textSecondary: contrastEnabled ? "#c9cfda" : "#9aa3b5"
    // Matches the Windows accent color (falls back to blue).
    readonly property color accent: Sys.accent
    readonly property color success: "#34d399"
    readonly property color warning: "#fbbf24"
    readonly property color danger: "#f87171"
    readonly property color info: "#60a5fa"

    readonly property int radiusPanel: 12
    readonly property int radiusCard: 8
    readonly property int gap: Ui.density === "comfortable" ? 12 : 8

    readonly property int fontSizeTitle: 14
    readonly property int fontSizeBody: 12
    readonly property int fontSizeCaption: 11
}
