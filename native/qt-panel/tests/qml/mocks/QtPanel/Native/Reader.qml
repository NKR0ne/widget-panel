pragma Singleton
import QtQuick
QtObject {
    property var article: ({})
    property bool busy: false
    property int openCount: 0
    property int closeCount: 0
    function open(url, title, source, image, description) {
        openCount++
        article = { url: url, title: title, source: source, image: image,
            paragraphs: [description, "Contenu de lecture conserve pendant la transition."] }
    }
    function close() { closeCount++; article = {}; busy = false }
    function openArchive(url) {}
}
