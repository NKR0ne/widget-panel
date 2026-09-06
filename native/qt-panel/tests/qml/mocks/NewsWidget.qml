import QtQuick
Item {
    property string categoryLabel: ""
    property real textScale: 1
    property real sizeScale: 1
    property bool delegateArticleOpening: false
    property bool forceCarouselPresentation: false
    property bool cascadeEligible: false
    signal articleRequested(var item)
    function rotateCarousel(direction) {}
}
