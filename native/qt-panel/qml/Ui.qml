pragma Singleton
import QtQuick
import QtPanel.Native

// Live UI preferences backed by the wp-* store (separate from the static
// Theme tokens). cardOpacity scales every GlassCard fill.
QtObject {
    property real cardOpacity: 1.0
    property bool detailOpen: false
    property string detailKind: ""
    property string detailTitle: ""
    property var detailPayload: ({})
    property bool statusOpen: false

    property string toastText: ""
    property string toastTone: "info"
    property int toastRevision: 0

    property bool reducedMotion: false
    property bool highContrast: false
    property bool mouseHalo: true
    property bool surfaceLighting: true
    property real lightingStrength: 1.0
    property real shadowDepth: 0.8
    property string density: "compact"
    // Drive the material from Windows personalization (Start's own tint shade
    // and the accent-on-surfaces preference) instead of the app's own palette.
    // The system transparency toggle is honoured either way.
    property bool followSystemMaterial: false
    // Start uses acrylic, so following the system swaps the window backdrop
    // too — not just the tint.
    onFollowSystemMaterialChanged: Panel.setFollowSystemMaterial(followSystemMaterial)

    function openDetail(kind, title, payload) {
        detailKind = kind || ""
        detailTitle = title || "D\u00e9tail"
        detailPayload = payload || ({})
        detailOpen = detailKind !== ""
        if (detailOpen)
            Panel.setModalOpen(true)
    }

    function closeDetail() {
        if (!detailOpen)
            return
        detailOpen = false
        detailKind = ""
        detailTitle = ""
        detailPayload = ({})
        Panel.setModalOpen(false)
    }

    function openStatus() {
        Diagnostics.refreshSnapshot()
        statusOpen = true
        Panel.setModalOpen(true)
    }

    function closeStatus() {
        if (!statusOpen)
            return
        statusOpen = false
        Panel.setModalOpen(false)
    }

    function notify(message, tone) {
        toastText = message || ""
        toastTone = tone || "info"
        toastRevision++
    }

    function save() {
        Store.set("wp-card-opacity", String(cardOpacity))
        Store.set("wp-reduced-motion", reducedMotion ? "true" : "false")
        Store.set("wp-high-contrast", highContrast ? "true" : "false")
        Store.set("wp-mouse-halo", mouseHalo ? "true" : "false")
        Store.set("wp-surface-lighting", surfaceLighting ? "true" : "false")
        Store.set("wp-lighting-strength", String(lightingStrength))
        Store.set("wp-shadow-depth", String(shadowDepth))
        Store.set("wp-density", density)
        Store.set("wp-follow-system-material", followSystemMaterial ? "true" : "false")
    }

    Component.onCompleted: {
        const stored = Number(Store.get("wp-card-opacity", 1))
        if (isFinite(stored) && stored > 0)
            cardOpacity = Math.min(2, Math.max(0.2, stored))
        reducedMotion = Store.get("wp-reduced-motion", "false") === "true"
        highContrast = Store.get("wp-high-contrast", "false") === "true"
        mouseHalo = Store.get("wp-mouse-halo", "true") === "true"
        surfaceLighting = Store.get("wp-surface-lighting", "true") === "true"
        const storedLighting = Number(Store.get("wp-lighting-strength", 1.0))
        if (isFinite(storedLighting))
            lightingStrength = Math.min(1.5, Math.max(0.35, storedLighting))
        const storedShadow = Number(Store.get("wp-shadow-depth", 0.8))
        if (isFinite(storedShadow))
            shadowDepth = Math.min(1.5, Math.max(0, storedShadow))
        const storedDensity = Store.get("wp-density", "compact")
        density = storedDensity === "comfortable" ? "comfortable" : "compact"
        followSystemMaterial = Store.get("wp-follow-system-material", "false") === "true"
    }
}
