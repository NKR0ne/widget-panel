import QtQuick
import QtTest
import "NotificationRules.js" as Rules

TestCase {
    name: "NotificationRules"
    function test_sustainedLoadAndRecovery() {
        let result = Rules.pressure({}, 97, 1000, 95, 30000)
        verify(!result.fire)
        result = Rules.pressure(result.state, 97, 30000, 95, 30000)
        verify(!result.fire)
        result = Rules.pressure(result.state, 97, 31000, 95, 30000)
        verify(result.fire)
        result = Rules.pressure(result.state, 99, 60000, 95, 30000)
        verify(!result.fire)
        result = Rules.pressure(result.state, 84, 61000, 95, 30000)
        result = Rules.pressure(result.state, 90, 80000, 95, 30000)
        verify(result.state.active)
        result = Rules.pressure(result.state, 80, 90000, 95, 30000)
        result = Rules.pressure(result.state, 80, 120000, 95, 30000)
        verify(!result.state.active)
        result = Rules.pressure(result.state, 97, 121000, 95, 30000)
        result = Rules.pressure(result.state, 97, 151000, 95, 30000)
        verify(result.fire)
    }
    function test_spikeAndLostTelemetryDoNotAlert() {
        let result = Rules.pressure({}, 100, 1000, 95, 30000)
        result = Rules.pressure(result.state, 40, 2000, 95, 30000)
        result = Rules.pressure(result.state, 100, 40000, 95, 30000)
        verify(!result.fire)
        result = Rules.pressure(result.state, NaN, 80000, 95, 30000)
        verify(!result.fire)
        result = Rules.pressure(result.state, 99, 90000, 95, 30000)
        verify(!result.fire)
    }
    function test_briefingPreservesArticlesArrivingDuringRequest() {
        const remaining = Rules.consume([{key:"a"}, {key:"b"}, {key:"new"}], ["a", "b"])
        compare(remaining.length, 1)
        compare(remaining[0].key, "new")
        compare(Rules.consume([{key:"a"}], []).length, 1)
    }
    function test_articleIdentityIgnoresFragment() {
        compare(Rules.articleKey({link:"https://example.org/story#top"}), "https://example.org/story")
        compare(Rules.articleKey({id:"stable-guid"}), "stable-guid")
        compare(Rules.articleKey({title:"Feed unavailable"}), "")
    }
}
