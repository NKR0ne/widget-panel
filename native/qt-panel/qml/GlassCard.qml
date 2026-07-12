import QtQuick
import QtQuick.Effects

// Base surface for all widget cards: glass fill, hairline stroke, rounded
// corners, a soft GPU drop shadow, and a tactile hover treatment (lift, gentle
// scale, brighter fill, deeper shadow).
Rectangle {
    id: card

    property string title: ""
    property bool hovered: hover.hovered
    property bool flat: false
    property bool interactive: true

    radius: flat ? 0 : Theme.radiusCard
    color: flat ? "transparent"
                : Qt.rgba(1, 1, 1, ((hovered && interactive) ? 0.08 : 0.05) * Ui.cardOpacity)
    border.color: flat ? "transparent"
                       : (hovered && interactive) ? Qt.rgba(1, 1, 1, 0.16) : Theme.cardStroke
    border.width: flat ? 0 : 1

    Behavior on color { ColorAnimation { duration: Motion.fastMs } }
    Behavior on border.color { ColorAnimation { duration: Motion.fastMs } }

    transform: Translate { id: lift; y: card.hovered && card.interactive && !card.flat ? -3 : 0
        Behavior on y { NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic } }
    }
    scale: hovered && interactive && !flat ? 1.004 : 1.0
    Behavior on scale { NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic } }

    HoverHandler { id: hover }

    layer.enabled: !flat && visible
    layer.effect: MultiEffect {
        shadowEnabled: true
        shadowColor: Qt.rgba(0, 0, 0, card.hovered && card.interactive ? 0.55 : 0.4)
        shadowBlur: card.hovered && card.interactive ? 0.55 : 0.35
        shadowVerticalOffset: card.hovered && card.interactive ? 6 : 3
        autoPaddingEnabled: true
        Behavior on shadowBlur { NumberAnimation { duration: Motion.normalMs } }
        Behavior on shadowVerticalOffset { NumberAnimation { duration: Motion.normalMs } }
    }
}
