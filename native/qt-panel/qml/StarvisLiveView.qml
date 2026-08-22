import QtQuick

// Flicker-free still-image feed. Assigning a new source to a single Image
// clears it while the next frame decodes, which reads as a blink once per
// second. Two images are kept instead: the next frame loads in the hidden one
// and they swap only once it is decoded, so a frame is always on screen.
Item {
    id: view

    // Provider URL without the cache-busting query, e.g. "image://starvis/live/direct".
    property string sourceBase: ""
    // Bump to request the next frame (frame counter from the service).
    property int revision: 0
    property bool active: true

    readonly property bool hasFrame: imageA.status === Image.Ready
                                     || imageB.status === Image.Ready

    property bool frontIsA: true

    function loadNext() {
        if (!active || sourceBase === "" || revision <= 0)
            return
        const target = frontIsA ? imageB : imageA
        target.source = sourceBase + "?n=" + revision
    }

    onRevisionChanged: loadNext()
    onActiveChanged: if (active) loadNext()
    Component.onCompleted: loadNext()

    // The swap is instant, NOT a cross-fade. Fading both layers in opposite
    // directions puts them both near half opacity mid-transition, and the dark
    // background shows through the pair — a brightness dip once per frame,
    // which is exactly the blink this component exists to remove. Video does
    // not blend consecutive frames either.
    Image {
        id: imageA
        anchors.fill: parent
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: false
        visible: view.frontIsA
        onStatusChanged: if (status === Image.Ready && !view.frontIsA) view.frontIsA = true
    }

    Image {
        id: imageB
        anchors.fill: parent
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: false
        visible: !view.frontIsA
        onStatusChanged: if (status === Image.Ready && view.frontIsA) view.frontIsA = false
    }
}
