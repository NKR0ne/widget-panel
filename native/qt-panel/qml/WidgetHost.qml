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
    property bool resizable: false
    property real minimumUserHeight: 120
    readonly property bool dragging: dragHandler.active
    property int expandedRevision: 0
    readonly property bool collapsed: {
        expandedRevision
        let state = {}
        try { state = JSON.parse(Store.get("wp-expanded", "{}")) } catch (e) {}
        return state[widgetId] === false
    }

    width: parent ? parent.width : 0
    implicitHeight: loader.item ? loader.item.implicitHeight : 0

    // Manual height (persisted per widget) overrides content height when set.
    property real userHeight: Number(Store.get("wp-" + widgetId + "-height", 0)) || 0
    height: collapsed ? 38 : ((resizable && userHeight > 0) ? userHeight : implicitHeight)
    clip: collapsed || (resizable && userHeight > 0)
    z: dragging ? 1000 : 0

    // setSource (not a source binding) so initialProperties are applied
    // before the widget's Component.onCompleted runs.
    Component.onCompleted: loader.setSource(source, initialProperties)

    function toggleCollapsed() {
        let state = {}
        try { state = JSON.parse(Store.get("wp-expanded", "{}")) } catch (e) {}
        state[widgetId] = collapsed
        Store.set("wp-expanded", JSON.stringify(state))
        SoundFx.tap()
    }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-expanded")
                host.expandedRevision++
        }
    }

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
        height: host.resizable ? host.height : implicitHeight
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

    Item {
        id: titleDragZone
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.leftMargin: 10
        anchors.topMargin: 6
        width: Math.max(72, Math.min(parent.width * 0.55, parent.width - 112))
        height: 20
        // Not while a modal is open. A DragHandler takes a passive grab even
        // when the press landed on a modal above it, and once it passes its 4px
        // threshold it steals the grab -- cancelling the click on whatever
        // button was actually pressed and dragging a card hidden behind the
        // sheet. That is why the settings X did nothing while a column-3 card
        // jumped on press and snapped back on release.
        visible: host.dragEnabled && host.titleDragEnabled && !Panel.modalOpen
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

    IconButton {
        id: collapseButton
        visible: titleDragZone.visible
        opacity: hostHover.hovered || host.collapsed || activeFocus ? 1 : 0
        anchors.left: titleDragZone.right
        anchors.leftMargin: 2
        anchors.top: parent.top
        anchors.topMargin: 5
        buttonSize: 20
        z: 4
        glyph: host.collapsed ? "\uE70D" : "\uE70E"
        tooltip: host.collapsed ? "D\u00e9velopper" : "R\u00e9duire"
        accessibleName: tooltip + " " + host.widgetId
        onClicked: host.toggleCollapsed()
        Behavior on opacity { NumberAnimation { duration: Motion.fastMs } }
    }

    HoverHandler { id: hostHover }

    // Bottom resize handle. Scene coordinates keep the delta stable while the
    // handle itself moves as the card changes height.
    Rectangle {
        visible: host.resizable && !host.collapsed
        opacity: resizeArea.pressed || resizeArea.containsMouse ? 1 : 0.42
        width: 54
        height: 4
        radius: 2
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 5
        color: resizeArea.pressed ? Theme.accent : Qt.rgba(1, 1, 1, 0.25)
        z: 3

        Behavior on opacity { NumberAnimation { duration: Motion.fastMs } }

        MouseArea {
            id: resizeArea
            anchors.fill: parent
            anchors.margins: -3
            hoverEnabled: true
            cursorShape: Qt.SizeVerCursor
            property real startSceneY: 0
            property real startH: 0
            onPressed: function(mouse) {
                startSceneY = resizeArea.mapToItem(null, mouse.x, mouse.y).y
                startH = host.height
                host.userHeight = host.height
            }
            onPositionChanged: function(mouse) {
                if (!pressed) return
                const sceneY = resizeArea.mapToItem(null, mouse.x, mouse.y).y
                host.userHeight = Math.max(host.minimumUserHeight,
                                           startH + sceneY - startSceneY)
            }
            onReleased: Store.set("wp-" + host.widgetId + "-height", Math.round(host.userHeight))
        }
    }
}
