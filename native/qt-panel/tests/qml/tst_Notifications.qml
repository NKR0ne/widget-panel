import QtQuick
import QtTest
import QtPanel.Native

TestCase {
    name: "Notifications"
    function init() {
        Notifications.entries = []
        Notifications.seen = ({})
        Notifications.pendingNews = []
        Notifications.briefingKeys = []
        Notifications.preferences = ({})
        Starvis.busy = false
        Store.values = ({})
    }
    function test_baselineAndRepeatedFeedUpdates() {
        Notifications.collectNews("Quebec")
        compare(Notifications.entries.length, 0)
        compare(Notifications.pendingNews.length, 20)
        Notifications.collectNews("Quebec")
        compare(Notifications.pendingNews.length, 20)
        compare(Notifications.entries.length, 0)
        Notifications.seen = {Quebec: ["https://example.test/Quebec/0"]}
        Notifications.collectNews("Quebec")
        compare(Notifications.entries.length, 1)
        compare(Notifications.entries[0].count, 19)
    }
    function test_failedBriefingRetainsPendingAndSuccessConsumesOnlyBatch() {
        Notifications.pendingNews = [{key:"a", title:"Article A", category:"Science", description:"Extrait"}]
        Notifications.newsBriefing()
        verify(Notifications.briefingBusy)
        Starvis.busy = false
        Starvis.chatFailed("timeout")
        compare(Notifications.pendingNews.length, 1)
        verify(!Notifications.briefingBusy)
        Notifications.newsBriefing()
        Notifications.pendingNews = Notifications.pendingNews.concat([{key:"b", title:"New arrival"}])
        Starvis.busy = false
        Starvis.replyReceived("Resume des titres et extraits", "test", 10)
        compare(Notifications.pendingNews.length, 1)
        compare(Notifications.pendingNews[0].key, "b")
        compare(JSON.parse(Store.get("wp-news-briefing-pending"))[0].key, "b")
        compare(Notifications.lastNewsBriefing, "Resume des titres et extraits")
    }
    function test_cameraSpeechAndSourcePreference() {
        Sentry.voiceAnnouncementRequested("Quelqu'un a la porte", "alert")
        compare(Notifications.entries.length, 1)
        compare(Notifications.entries[0].source, "camera")
        verify(Notifications.entries[0].urgent)
        Notifications.markAllRead()
        compare(Notifications.unreadCount, 0)
        Notifications.setOption("camera", false)
        Sentry.voiceAnnouncementRequested("Nouvel evenement", "notice")
        compare(Notifications.entries.length, 1)
    }
    function test_quoteDeduplicationAndTimestamp() {
        MarketInsights.movers = [{name:"Test", symbol:"TEST:ABC", percent:4.5, session:"2026-09-18", asOf:"2026-09-18 20:30 EDT"}]
        MarketInsights.refreshed()
        MarketInsights.refreshed()
        compare(Notifications.entries.length, 1)
        verify(Notifications.entries[0].text.indexOf("20:30 EDT") >= 0)
        MarketInsights.movers = [{name:"Test", symbol:"TEST:ABC", percent:4.5, session:"2026-09-19", asOf:"2026-09-19 20:30 EDT"}]
        MarketInsights.refreshed()
        compare(Notifications.entries.length, 2)
    }
    function test_weatherCancellationRemovesNotification() {
        WeatherAlerts.alerts = [{key:"area:rain", issued:Date.now(), expires:Date.now()+3600000, title:"Pluie", area:"Quebec", warning:true}]
        WeatherAlerts.updated()
        compare(Notifications.entries.length, 1)
        WeatherAlerts.updated()
        compare(Notifications.entries.length, 1)
        WeatherAlerts.alerts = []
        WeatherAlerts.updated()
        compare(Notifications.entries.length, 0)
    }
}
