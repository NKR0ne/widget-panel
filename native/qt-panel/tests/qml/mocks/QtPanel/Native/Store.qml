pragma Singleton
import QtQuick
QtObject {
    property var values: ({ "wp-news-view-mode": "reader" })
    signal changed(string key)
    function get(key, fallback) { return values[key] === undefined ? fallback : values[key] }
    function set(key, value) { values[key] = value; changed(key) }
}
