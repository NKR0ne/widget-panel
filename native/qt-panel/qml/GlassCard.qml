import QtQuick
import QtQuick.Effects

// Base surface for all widget cards: glass fill, hairline stroke, rounded
// corners, a soft GPU drop shadow, and a tactile hover treatment (lift, gentle
// scale, brighter fill, deeper shadow).
Rectangle {
    id: card

    property string title: ""
    property bool hovered: hover.hovered

    radius: Theme.radiusCard
    color: Qt.rgba(1, 1, 1, (hovered ? 0.08 : 0.05) * Ui.cardOpacity)
    border.color: hovered ? Qt.rgba(1, 1, 1, 0.16) : Theme.cardStroke
    border.width: 1

    Behavior on color { ColorAnimation { duration: Motion.fastMs } }
    Behavior on border.color { ColorAnimation { duration: Motion.fastMs } }

    transform: Translate { id: lift; y: card.hovered ? -3 : 0
        Behavior on y { NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic } }
    }
    scale: hovered ? 1.004 : 1.0
    Behavior on scale { NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic } }

    HoverHandler { id: hover }

    layer.enabled: true
    layer.effect: MultiEffect {
        shadowEnabled: true
        shadowColor: Qt.rgba(0, 0, 0, card.hovered ? 0.55 : 0.4)
        shadowBlur: card.hovered ? 0.55 : 0.35
        shadowVerticalOffset: card.hovered ? 6 : 3
        autoPaddingEnabled: true
        Behavior on shadowBlur { NumberAnimation { duration: Motion.normalMs } }
        Behavior on shadowVerticalOffset { NumberAnimation { duration: Motion.normalMs } }
    }
}
