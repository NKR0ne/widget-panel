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
        const time = Date.now() / 1000
        Stocks.quoteUpdated("Test", "TEST:ABC", 4.5, time)
        Stocks.quoteUpdated("Test", "TEST:ABC", 4.6, time)
        compare(Notifications.entries.length, 1)
        Stocks.quoteUpdated("Stale", "TEST:OLD", 8, time - 6 * 86400)
        compare(Notifications.entries.length, 1)
    }
}
