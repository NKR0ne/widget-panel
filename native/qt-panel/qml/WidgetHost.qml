import QtQuick
import QtPanel.Native

// Wraps a widget card with its entrance animation (fade + lift + settle,
// staggered) and a drag handle for moving the card between columns.
Item {
    id: host

    property url source
    property var initialProperties: ({})
    property int stagger: 0

    // Card management
    property var columns: null      // the PanelColumns root (for drop hit-test)
    property string widgetId: ""
    property bool dragEnabled: false
    property bool titleDragEnabled: true
    property bool resizable: false  // media widgets opt in to manual height
    readonly property bool dragging: dragHandler.active

    width: parent ? parent.width : 0
    implicitHeight: loader.item ? loader.item.implicitHeight : 0

    // Manual height (persisted per widget) overrides content height when set.
    property real userHeight: Number(Store.get("wp-" + widgetId + "-height", 0)) || 0
    height: (resizable && userHeight > 0) ? userHeight : implicitHeight
    clip: resizable && userHeight > 0
    z: dragging ? 1000 : 0

    // setSource (not a source binding) so initialProperties are applied
    // before the widget's Component.onCompleted runs.
    Component.onCompleted: loader.setSource(source, initialProperties)

    // While dragging, follow the pointer and tell the layout to unclip columns.
    transform: Translate {
        id: dragShift
        x: dragHandler.active ? dragHandler.activeTranslation.x : 0
        y: dragHandler.active ? dragHandler.activeTranslation.y : 0
        Behavior on x { enabled: !dragHandler.active; NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic } }
        Behavior on y { enabled: !dragHandler.active; NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic } }
    }

    onDraggingChanged: if (host.columns) host.columns.dragging = dragging

    Loader {
        id: loader
        anchors.left: parent.left
        anchors.right: parent.right
        opacity: dragHandler.active ? 0.85 : 0
        scale: 0.97

        onLoaded: entrance.restart()

        transform: Translate { id: lift; y: 12 }

        SequentialAnimation {
            id: entrance
            PauseAnimation { duration: host.stagger }
            ParallelAnimation {
                NumberAnimation {
                    target: loader; property: "opacity"; to: 1
                    duration: Motion.normalMs
                    easing.type: Easing.BezierSpline
                    easing.bezierCurve: Motion.emphasized
                }
                NumberAnimation {
                    target: loader; property: "scale"; to: 1
                    duration: Motion.normalMs + 60
                    easing.type: Easing.BezierSpline
                    easing.bezierCurve: Motion.emphasized
                }
                NumberAnimation {
                    target: lift; property: "y"; to: 0
                    duration: Motion.normalMs + 60
                    easing.type: Easing.BezierSpline
                    easing.bezierCurve: Motion.emphasized
                }
            }
        }
    }

    // Drag grip — top-right, fades in on hover (base mode only).
    Rectangle {
        id: grip
        width: 22; height: 18
        radius: 5
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 4
        z: 2
        visible: false
        opacity: 0
        color: host.dragging ? Theme.accent : Qt.rgba(0, 0, 0, 0.4)
        border.color: Theme.cardStroke
        Behavior on opacity { NumberAnimation { duration: Motion.fastMs } }
        Behavior on color { ColorAnimation { duration: Motion.fastMs } }

        // grip dots
        Row {
            anchors.centerIn: parent
            spacing: 3
            Repeater {
                model: 2
                Column {
                    spacing: 2
                    Repeater {
                        model: 3
                        Rectangle { width: 2; height: 2; radius: 1; color: Theme.textSecondary }
                    }
                }
            }
        }

        HoverHandler { id: gripHover }

        DragHandler {
            id: unusedGripDragHandler
            enabled: false
            target: null               // we drive the transform manually
            dragThreshold: 4
            onActiveChanged: {
                if (!active && host.columns)
                    host.columns.dropWidget(host.widgetId,
                                            dragHandler.centroid.scenePosition.x,
                                            dragHandler.centroid.scenePosition.y)
            }
        }
    }

    Item {
        id: titleDragZone
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.leftMargin: 10
        anchors.topMargin: 6
        width: Math.min(parent.width * 0.34, 96)
        height: 20
        visible: host.dragEnabled && host.titleDragEnabled
        z: 2

        DragHandler {
            id: dragHandler
            enabled: titleDragZone.visible
            target: null
            dragThreshold: 4
            onActiveChanged: {
                if (!active && host.columns)
                    host.columns.dropWidget(host.widgetId,
                                            dragHandler.centroid.scenePosition.x,
                                            dragHandler.centroid.scenePosition.y)
            }
        }
    }

    HoverHandler { id: hostHover }

    // Bottom resize handle (media widgets). Drag to set a fixed card height.
    Rectangle {
        visible: host.resizable && (hostHover.hovered || resizeArea.pressed)
        width: 54
        height: 4
        radius: 2
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 5
        color: resizeArea.pressed ? Theme.accent : Qt.rgba(1, 1, 1, 0.25)
        z: 3

        MouseArea {
            id: resizeArea
            anchors.fill: parent
            anchors.margins: -3
            cursorShape: Qt.SizeVerCursor
            property real startY: 0
            property real startH: 0
            onPressed: function(mouse) {
                startY = mouse.y
                startH = host.height
            }
            onPositionChanged: function(mouse) {
                if (!pressed) return
                host.userHeight = Math.max(120, startH + (mouse.y - startY))
            }
            onReleased: Store.set("wp-" + host.widgetId + "-height", Math.round(host.userHeight))
        }
    }
}
