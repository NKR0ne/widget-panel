pragma Singleton
import QtQuick
QtObject {
    property bool open: false
    property int sessionRemainingMinutes: 0
    property string state: ""
    signal changed()
    function openCatalog() { open = true; changed() }
}
