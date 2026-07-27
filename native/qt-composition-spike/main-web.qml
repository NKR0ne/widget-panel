import QtQuick
import QtWebEngine

// Probes whether QtWebEngine survives inside a QQuickRenderControl offscreen
// window composited through a CompositionDrawingSurface. WebEngine composites
// through its own path, so it is the one part of the app that might not follow
// the scene graph onto the composition surface.
//
// The page is a data: URL, deliberately -- no network, and the expected pixel
// value is known exactly, so "did it render" is measurable rather than visual.
Item {
    id: scene

    // Reference probe. If this is green and the web view is not magenta, the
    // failure is WebEngine specifically rather than the render path.
    Rectangle {
        id: greenProbe
        x: parent.width * 0.06
        y: parent.height * 0.08
        width: parent.width * 0.24
        height: parent.height * 0.16
        color: "#00FF00"
    }

    WebEngineView {
        id: web
        x: parent.width * 0.06
        y: greenProbe.y + greenProbe.height + parent.height * 0.06
        width: parent.width * 0.5
        height: parent.height * 0.45
        url: "data:text/html,<body style='margin:0;background:%23FF00FF'></body>"

        onLoadingChanged: function(info) {
            if (info.status === WebEngineView.LoadSucceededStatus)
                console.log("[qtspike-web] page loaded")
            else if (info.status === WebEngineView.LoadFailedStatus)
                console.log("[qtspike-web] page FAILED: " + info.errorString)
        }
    }

    Text {
        x: greenProbe.x
        y: parent.height * 0.88
        text: "WebEngine over Windows acrylic"
        color: "white"
        font.pixelSize: 14
    }
}
