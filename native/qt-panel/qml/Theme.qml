pragma Singleton
import QtQuick
import QtPanel.Native

// Design tokens — single source of truth for color, radius, and spacing.
QtObject {
    readonly property bool contrastEnabled: Ui.highContrast || Sys.highContrast
    readonly property color bgTint: Qt.rgba(0.043, 0.055, 0.09, contrastEnabled ? 0.82 : 0.45)
    readonly property color panelSolid: "#11151e"
    readonly property color cardFill: Qt.rgba(1, 1, 1, contrastEnabled ? 0.09 : 0.05)
    readonly property color cardStroke: Qt.rgba(1, 1, 1, contrastEnabled ? 0.20 : 0.08)
    readonly property color skeleton: Qt.rgba(1, 1, 1, 0.07)
    readonly property color hover: Qt.rgba(1, 1, 1, 0.10)
    readonly property color activeFill: Qt.rgba(1, 1, 1, 0.14)
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
