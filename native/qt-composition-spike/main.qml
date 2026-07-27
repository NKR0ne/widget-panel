import QtQuick

// Deliberately built for measurement, not for looks. Three regions with known
// expected values, so "does Qt draw over acrylic" is answered by sampling
// pixels rather than by squinting at a screenshot.
Item {
    id: scene

    // Transparent: whatever shows here is the acrylic material, not us.
    Rectangle {
        anchors.fill: parent
        color: "transparent"
    }

    // OPAQUE probe. If this is not pure green, Qt is not reaching the surface
    // at all and nothing below this line is worth interpreting.
    Rectangle {
        x: 60; y: 60
        width: 200; height: 120
        color: "#00FF00"
    }

    // TRANSLUCENT probe. Proves alpha survives the composition path: this must
    // land between the acrylic behind it and solid white, and must differ from
    // the bare-material sample.
    Rectangle {
        x: 60; y: 220
        width: 200; height: 120
        color: Qt.rgba(1, 1, 1, 0.25)
        radius: 8
    }

    // INPUT probe. Grey until the pointer arrives, blue on hover, red while
    // pressed -- so "did input reach Qt" is a pixel value, not a judgement call.
    Rectangle {
        id: inputProbe
        x: 380; y: 60
        width: 220; height: 160
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
            font.pixelSize: 16
        }
    }

    // Left bare so the sampler has a region of pure material to read.
    Text {
        x: 60; y: 380
        text: "Qt Quick over Windows acrylic"
        color: "white"
        font.pixelSize: 20
    }

    // Moving, so a frozen frame is distinguishable from a live render loop.
    Rectangle {
        id: pulse
        x: 60; y: 430
        width: 40; height: 40
        radius: 20
        color: "#FF4081"
        NumberAnimation on x {
            from: 60; to: 700
            duration: 2000
            loops: Animation.Infinite
        }
    }
}
