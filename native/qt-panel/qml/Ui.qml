pragma Singleton
import QtQuick
import QtPanel.Native

// Live UI preferences backed by the wp-* store (separate from the static
// Theme tokens). cardOpacity scales every GlassCard fill.
QtObject {
    property real cardOpacity: 1.0

    function save() {
        Store.set("wp-card-opacity", String(cardOpacity))
    }

    Component.onCompleted: {
        const stored = Number(Store.get("wp-card-opacity", 1))
        if (isFinite(stored) && stored > 0)
            cardOpacity = Math.min(2, Math.max(0.2, stored))
    }
}
