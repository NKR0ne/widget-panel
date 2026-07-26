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
    property real lightX: width * 0.5

    radius: flat ? 0 : Theme.radiusCard
    color: flat ? "transparent"
                : Qt.rgba(1, 1, 1,
                          ((hovered && interactive) ? Theme.cardHoverFill.a : Theme.cardFill.a)
                          * Ui.cardOpacity)
    border.color: flat ? "transparent"
                       : (hovered && interactive && Ui.surfaceLighting)
                         ? Qt.rgba(Theme.accent.r, Theme.accent.g, Theme.accent.b,
                                   0.24 * Ui.lightingStrength)
                         : Theme.cardStroke
    border.width: flat ? 0 : 1

    Behavior on color { ColorAnimation { duration: Motion.fastMs } }
    Behavior on border.color { ColorAnimation { duration: Motion.fastMs } }

    transform: Translate { id: lift; y: card.hovered && card.interactive && !card.flat ? -2 : 0
        Behavior on y { NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic } }
    }

    HoverHandler {
        id: hover
        enabled: card.interactive
        onPointChanged: card.lightX = Math.max(18, Math.min(card.width - 18, point.position.x))
    }

    // Grain, shared with the acrylic transient layers. No blur here on purpose:
    // what sits behind a card is the panel background, not app content, so a
    // per-card live blur would cost per-frame GPU on dozens of always-on cards
    // and obscure nothing. Grain is the part of the material recipe that
    // actually makes a card read as a surface rather than a flat wash.
    // Squared off at the corners, which is invisible at this opacity.
    GrainOverlay {
        anchors.fill: parent
        z: 38
        visible: !card.flat && Ui.surfaceLighting && amount > 0
    }

    Rectangle {
        id: pointerKeyline
        width: Math.min(128, Math.max(48, card.width * 0.36))
        height: 1
        x: Math.max(8, Math.min(card.width - width - 8, card.lightX - width / 2))
        anchors.top: parent.top
        z: 40
        visible: !card.flat && Ui.surfaceLighting
        opacity: card.hovered && card.interactive ? 0.9 * Ui.lightingStrength : 0.22
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "transparent" }
            GradientStop {
                position: 0.5
                color: card.hovered
                       ? Qt.rgba(Theme.accent.r, Theme.accent.g, Theme.accent.b, 0.72)
                       : Theme.keyline
            }
            GradientStop { position: 1; color: "transparent" }
        }
        Behavior on x {
            NumberAnimation { duration: 120; easing.type: Easing.OutCubic }
        }
        Behavior on opacity { NumberAnimation { duration: Motion.normalMs } }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: Theme.radiusCard
        anchors.rightMargin: Theme.radiusCard
        anchors.bottom: parent.bottom
        height: 1
        z: 39
        visible: !card.flat && Ui.surfaceLighting
        color: Qt.rgba(0, 0, 0, 0.16 * Math.min(1, Ui.shadowDepth))
    }

    layer.enabled: !flat && visible
    layer.effect: MultiEffect {
        shadowEnabled: Ui.shadowDepth > 0.01
        shadowColor: Qt.rgba(0, 0, 0,
                             (card.hovered && card.interactive ? 0.50 : 0.36)
                             * Math.min(1.35, Ui.shadowDepth))
        shadowBlur: (card.hovered && card.interactive ? 0.52 : 0.34)
                    * Math.min(1.3, Ui.shadowDepth)
        shadowVerticalOffset: (card.hovered && card.interactive ? 5 : 3)
                              * Math.min(1.3, Ui.shadowDepth)
        autoPaddingEnabled: true
        Behavior on shadowBlur { NumberAnimation { duration: Motion.normalMs } }
        Behavior on shadowVerticalOffset { NumberAnimation { duration: Motion.normalMs } }
    }
}
