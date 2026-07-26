pragma Singleton
import QtQuick
import QtPanel.Native

// Design tokens — single source of truth for color, radius, and spacing.
QtObject {
    readonly property bool contrastEnabled: Ui.highContrast || Sys.highContrast
    // Windows drops acrylic and mica to solid when the user turns off
    // transparency effects; a panel that kept blurring would stand out as the
    // one surface ignoring the preference — and it is a perf/accessibility
    // setting, not a cosmetic one.
    readonly property bool materialEnabled: Sys.transparencyEnabled && !contrastEnabled

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
    readonly property color surfaceTint: systemMaterial
        ? Qt.darker(Sys.accentPalette[5], 1.3) : baseTint
    // Start is a flat surface: no animated sheen, no cursor-tracked glow. The
    // decorative lighting is scaled back rather than switched off so the panel
    // keeps its own depth cues without reading as a different material.
    readonly property real lightingScale: systemMaterial ? 0.3 : 1.0
    // Shell accent ramp: 3 is the base accent, 4 is Start's darker shade.
    readonly property color accentBase: systemMaterial ? Sys.accentPalette[3] : accent
    readonly property color accentLight: systemMaterial ? Sys.accentPalette[2] : accent

    // Mica is a static, desaturated wallpaper sample, so the tint over it can
    // be much lighter than the one needed to tame acrylic's live desktop blur.
    readonly property color bgTint: {
        if (contrastEnabled)
            return Qt.rgba(0.043, 0.055, 0.09, 0.82)
        if (!materialEnabled)
            return panelSolid
        const t = surfaceTint
        // Start is close to opaque: the desktop reads as a faint influence
        // behind it, not as visible content. A light tint over acrylic looks
        // nothing like it.
        if (systemMaterial)
            return Qt.rgba(t.r, t.g, t.b, 0.9)
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
    readonly property color cardFill: systemMaterial
        ? Qt.rgba(1, 1, 1, 0.035)
        : Qt.rgba(1, 1, 1, contrastEnabled ? 0.09 : 0.075)
    readonly property color cardStroke: systemMaterial
        ? Qt.rgba(1, 1, 1, 0.055)
        : Qt.rgba(1, 1, 1, contrastEnabled ? 0.20 : 0.10)
    readonly property color cardHoverFill: systemMaterial
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
    readonly property real grainOpacity: contrastEnabled ? 0 : 0.03
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
