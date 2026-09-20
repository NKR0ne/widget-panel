pragma Singleton
import QtQuick
QtObject {
    property bool busy: false
    property string lastPrompt: ""
    signal replyReceived(string text, string model, int latencyMs)
    signal chatFailed(string error)
    function newsBriefing(prompt) { lastPrompt = prompt; busy = true }
}
