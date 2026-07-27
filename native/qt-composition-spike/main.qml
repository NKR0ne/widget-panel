import QtQuick

// Built for measurement, not for looks: regions with known expected values, so
// "does Qt draw over acrylic" is answered by sampling pixels rather than by
// squinting at a screenshot.
//
// Everything is positioned relative to the parent. The scene is laid out in
// DIPs at the island's actual size -- roughly 500x360 on a 900x700 window at
// 175% -- so fixed pixel coordinates that assumed a 900x700 canvas simply fell
// off the bottom and read as "not rendering".
Item {
    id: scene

    // OPAQUE probe. If this is not pure green, Qt is not reaching the surface
    // at all and nothing below this line is worth interpreting.
    Rectangle {
        id: greenProbe
        x: parent.width * 0.06
        y: parent.height * 0.08
        width: parent.width * 0.28
        height: parent.height * 0.20
        color: "#00FF00"
    }

    // TRANSLUCENT probe. Proves alpha survives the composition path: must land
    // between the acrylic behind it and solid white.
    Rectangle {
        x: greenProbe.x
        y: greenProbe.y + greenProbe.height + parent.height * 0.05
        width: greenProbe.width
        height: greenProbe.height
        radius: 8
        color: Qt.rgba(1, 1, 1, 0.25)
    }

    // INPUT probe: grey until the pointer arrives, blue on hover, red while
    // pressed -- so "did input reach Qt" is a pixel value, not a judgement call.
    Rectangle {
        id: inputProbe
        x: parent.width * 0.45
        y: greenProbe.y
        width: parent.width * 0.40
        height: parent.height * 0.28
        radius: 8
        color: hitArea.pressed ? "#FF0000"
             : hitArea.containsMouse ? "#0000FF"
             : "#808080"
        MouseArea {
            id: hitArea
            anchors.fill: parent
            hoverEnabled: true
        }
        Text {
            anchors.centerIn: parent
            text: hitArea.pressed ? "PRESSED" : hitArea.containsMouse ? "HOVER" : "no input"
            color: "white"
            font.pixelSize: 14
        }
    }

    Text {
        x: greenProbe.x
        y: parent.height * 0.68
        text: "Qt Quick over Windows acrylic"
        color: "white"
        font.pixelSize: 16
    }

    // Moving, so a frozen frame is distinguishable from a live render loop --
    // which is the whole point once rendering is on demand rather than on a
    // fixed timer.
    Rectangle {
        id: pulse
        y: parent.height * 0.82
        width: parent.width * 0.06
        height: width
        radius: width / 2
        color: "#FF4081"
        NumberAnimation on x {
            from: scene.width * 0.06
            to: scene.width * 0.85
            duration: 2000
            loops: Animation.Infinite
        }
    }

    // Deliberately left bare on the right-hand side below the input probe, so
    // the sampler has a region of pure material to read.
}
