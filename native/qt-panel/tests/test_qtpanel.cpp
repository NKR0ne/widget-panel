#include <QtTest>

#include "core/HttpClient.h"
#include "core/TextFix.h"
#include "core/SettingsStore.h"
#include "services/news/NewsService.h"
#include "services/reader/ReaderService.h"
#include "services/live/LiveFeedService.h"
#include "shell/FocusPolicy.h"
#include "shell/SystemTheme.h"

#include <QTemporaryDir>

using namespace qtpanel;

// Unit coverage for the trickiest pure-logic ports: encoding repair, the
// blur-to-hide heuristics, settings, feed parsing, and reader extraction.
class TestQtPanel : public QObject {
    Q_OBJECT

private slots:
    void mojibakeRepair()
    {
        // "Québec" whose é (UTF-8 C3 A9) was decoded as cp1252 → "QuÃ©bec".
        const QString broken = QStringLiteral("Qu") + QChar(0x00C3) + QChar(0x00A9)
            + QStringLiteral("bec");
        QVERIFY(TextFix::artifactScore(broken) > 0);
        QCOMPARE(TextFix::repairMojibake(broken), QStringLiteral("Québec"));
        // Clean input is left untouched.
        QCOMPARE(TextFix::repairMojibake(QStringLiteral("Québec")), QStringLiteral("Québec"));
    }

    void cp1252Decode()
    {
        // 0x92 in cp1252 is a right single quote U+2019.
        QByteArray bytes;
        bytes.append(static_cast<char>(0x92));
        QCOMPARE(TextFix::decodeCp1252(bytes), QString(QChar(0x2019)));
    }

    void focusPolicyDebounce()
    {
        FocusPolicy fp;
        fp.noteToggle();
        QVERIFY(!fp.blurMayHide());            // within toggle debounce
        QTest::qWait(220);
        QVERIFY(fp.blurMayHide());             // debounce elapsed
    }

    void focusPolicyModalGuard()
    {
        FocusPolicy fp;
        fp.noteModalOpened();
        QVERIFY(!fp.delayedCheckAllowsHide()); // modal open blocks hide
        fp.noteModalClosed();
        QVERIFY(!fp.delayedCheckAllowsHide()); // grace period right after close
    }

    void settingsRoundTrip()
    {
        QTemporaryDir dir;
        const QString path = dir.filePath(QStringLiteral("settings.json"));
        {
            SettingsStore s(path);
            s.set(QStringLiteral("wp-width"), 720);
            s.set(QStringLiteral("wp-opacity"), QStringLiteral("0.5"));
            s.flush();
        }
        SettingsStore reloaded(path);
        QCOMPARE(reloaded.getInt(QStringLiteral("wp-width"), 0), 720);
        // String-stored number coerces via getDouble (Electron-store mixes types).
        QCOMPARE(reloaded.getDouble(QStringLiteral("wp-opacity"), 1.0), 0.5);
        QCOMPARE(reloaded.getInt(QStringLiteral("missing"), 42), 42);
    }

    void rssParse()
    {
        const QString xml = QStringLiteral(
            "<?xml version=\"1.0\"?><rss><channel>"
            "<item><title>Hello World</title><link>https://example.com/a</link>"
            "<description>Body text here that is long enough.</description>"
            "<pubDate>Wed, 02 Oct 2024 13:00:00 GMT</pubDate></item>"
            "</channel></rss>");
        const QVariantList items = NewsService::parseFeedXml(xml, QStringLiteral("https://example.com"));
        QCOMPARE(items.size(), 1);
        QCOMPARE(items.first().toMap().value(QStringLiteral("title")).toString(),
                 QStringLiteral("Hello World"));
        QCOMPARE(items.first().toMap().value(QStringLiteral("link")).toString(),
                 QStringLiteral("https://example.com/a"));
    }

    void atomParse()
    {
        const QString xml = QStringLiteral(
            "<?xml version=\"1.0\"?><feed xmlns=\"http://www.w3.org/2005/Atom\">"
            "<entry><title>Atom Item</title>"
            "<link rel=\"alternate\" href=\"https://example.com/b\"/>"
            "<summary>Summary text long enough to keep.</summary></entry></feed>");
        const QVariantList items = NewsService::parseFeedXml(xml, QStringLiteral("https://example.com"));
        QCOMPARE(items.size(), 1);
        QCOMPARE(items.first().toMap().value(QStringLiteral("link")).toString(),
                 QStringLiteral("https://example.com/b"));
    }

    void readerExtractsScoredArticle()
    {
        const QString html = QStringLiteral(
            "<html><head>"
            "<meta property=\"og:title\" content=\"Native Reader Works\">"
            "<meta property=\"og:image\" content=\"/hero.jpg\">"
            "<meta name=\"author\" content=\"Reporter Name\">"
            "</head><body>"
            "<nav><p>Subscribe to our newsletter and login.</p></nav>"
            "<section class=\"post-content\">"
            "<h2>A useful heading.</h2>"
            "<p>The first real paragraph contains enough detail to look like a"
            " readable article sentence with context and facts.</p>"
            "<p>The second real paragraph continues the story with more than"
            " enough text to survive the parser filters.</p>"
            "<img data-src=\"/photo.jpg\">"
            "<h3>Related Articles</h3>"
            "<p>This related paragraph should not be included in the reader.</p>"
            "</section>"
            "</body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://example.com/news/story"));
        const QVariantList paragraphs = article.value(QStringLiteral("paragraphs")).toList();
        const QVariantList images = article.value(QStringLiteral("images")).toList();

        QCOMPARE(article.value(QStringLiteral("title")).toString(),
                 QStringLiteral("Native Reader Works"));
        QCOMPARE(article.value(QStringLiteral("byline")).toString(),
                 QStringLiteral("Reporter Name"));
        QCOMPARE(article.value(QStringLiteral("image")).toString(),
                 QStringLiteral("https://example.com/hero.jpg"));
        QVERIFY(paragraphs.size() >= 2);
        QVERIFY(paragraphs.first().toString().contains(QStringLiteral("first real paragraph")));
        for (const QVariant& paragraph : paragraphs)
            QVERIFY(!paragraph.toString().contains(QStringLiteral("related paragraph")));
        QCOMPARE(images.first().toString(), QStringLiteral("https://example.com/hero.jpg"));
        QVERIFY(images.contains(QVariant(QStringLiteral("https://example.com/photo.jpg"))));
        QCOMPARE(article.value(QStringLiteral("fallbackUsed")).toBool(), false);
    }

    void readerFallsBackToReadableLines()
    {
        const QString html = QStringLiteral(
            "<html><body>"
            "<h1>Fallback Story</h1>"
            "<div>By Reporter Name</div>"
            "<div>This first fallback paragraph has enough sentence structure"
            " and length to be treated as useful article text.</div>"
            "<div>This second fallback paragraph adds more context and also"
            " ends like a normal sentence.</div>"
            "<div class=\"paywall\">Subscribe to continue reading.</div>"
            "</body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://example.com/fallback"));
        const QVariantList paragraphs = article.value(QStringLiteral("paragraphs")).toList();

        QCOMPARE(article.value(QStringLiteral("title")).toString(),
                 QStringLiteral("Fallback Story"));
        QVERIFY(article.value(QStringLiteral("fallbackUsed")).toBool());
        QVERIFY(article.value(QStringLiteral("paywall")).toBool());
        QCOMPARE(paragraphs.size(), 2);
        QVERIFY(paragraphs.first().toString().startsWith(QStringLiteral("This first fallback")));
    }

    void systemAppearanceIsExposed()
    {
        SystemTheme theme;
        QVERIFY(theme.accent().isValid());
        QVERIFY(theme.accent().alpha() > 0);
        const bool highContrast = theme.highContrast();
        const bool animationsEnabled = theme.animationsEnabled();
        QCOMPARE(theme.highContrast(), highContrast);
        QCOMPARE(theme.animationsEnabled(), animationsEnabled);
    }

    void readerStripsHostileMarkupAndPreservesStructure()
    {
        const QString html = QStringLiteral(
            "<html><head><title>Hostile Markup Story</title>"
            "<script>document.write('script noise that must never appear');</script>"
            "</head><body>"
            "<header><p>Header navigation that must never appear in reader output.</p></header>"
            "<article class=\"article-body\">"
            "<h2>Why native extraction needs defensive parsing.</h2>"
            "<p>The opening paragraph contains enough meaningful detail to establish"
            " the article and survive the reader quality filters.</p>"
            "<p>The second paragraph explains the implementation constraints with enough"
            " context to remain useful after chrome is removed.</p>"
            "<blockquote>This quoted observation is deliberately long enough to remain"
            " visible as part of the extracted article body.</blockquote>"
            "<ul><li>This structured list item carries a complete explanatory sentence.</li></ul>"
            "<div class=\"newsletter-promo\"><p>Newsletter promotion must be removed"
            " even though its text is long enough to resemble content.</p></div>"
            "<p>The final article paragraph confirms that noise removal does not truncate"
            " legitimate content surrounding an embedded promotion.</p>"
            "<h3>Read Next</h3>"
            "<p>This recommendation belongs outside the extracted article body.</p>"
            "</article><footer><p>Footer noise must never appear.</p></footer>"
            "</body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://example.com/hostile"));
        const QVariantList paragraphs = article.value(QStringLiteral("paragraphs")).toList();
        const QString body = [&paragraphs] {
            QStringList lines;
            for (const QVariant& paragraph : paragraphs)
                lines.append(paragraph.toString());
            return lines.join(QLatin1Char('\n'));
        }();

        QCOMPARE(article.value(QStringLiteral("title")).toString(),
                 QStringLiteral("Hostile Markup Story"));
        QVERIFY(body.contains(QStringLiteral("defensive parsing")));
        QVERIFY(body.contains(QStringLiteral("quoted observation")));
        QVERIFY(body.contains(QStringLiteral("structured list item")));
        QVERIFY(body.contains(QStringLiteral("final article paragraph")));
        QVERIFY(!body.contains(QStringLiteral("script noise")));
        QVERIFY(!body.contains(QStringLiteral("Newsletter promotion")));
        QVERIFY(!body.contains(QStringLiteral("recommendation belongs")));
        QVERIFY(!body.contains(QStringLiteral("Footer noise")));
    }

    void readerDetectsBotChallenge()
    {
        const QString html = QStringLiteral(
            "<html><head><title>Checking your browser</title></head>"
            "<body><main><h1>Checking your browser</h1>"
            "<p>Cloudflare is performing security verification before allowing access.</p>"
            "</main></body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://protected.example/story"));

        QVERIFY(!article.value(QStringLiteral("challenge")).toString().isEmpty());
        QVERIFY(!article.value(QStringLiteral("paywall")).toBool());
        QCOMPARE(article.value(QStringLiteral("source")).toString(),
                 QStringLiteral("protected.example"));
    }

    void readerResolvesFiltersAndDeduplicatesImages()
    {
        const QString html = QStringLiteral(
            "<html><head><meta property=\"og:title\" content=\"Image Story\">"
            "<meta property=\"og:image\" content=\"/media/hero.jpg\"></head><body>"
            "<article class=\"story-content\">"
            "<p>The first image story paragraph is long enough to pass all reader"
            " extraction thresholds and provide useful context.</p>"
            "<p>The second image story paragraph is similarly complete and ensures"
            " this article region is selected by the scoring logic.</p>"
            "<p>The third image story paragraph provides additional body text so the"
            " image assertions exercise the primary extraction path.</p>"
            "<img src=\"/media/hero.jpg\"><img data-src=\"../photos/detail.jpg\">"
            "<img src=\"//cdn.example.net/chart.png\"><img src=\"/assets/site-logo.svg\">"
            "<img src=\"/tracking/pixel.gif\"><img data-original=\"/media/extra.jpg\">"
            "</article></body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://example.com/news/story"));
        const QVariantList images = article.value(QStringLiteral("images")).toList();

        QCOMPARE(images.size(), 4);
        QCOMPARE(images.at(0).toString(), QStringLiteral("https://example.com/media/hero.jpg"));
        QCOMPARE(images.at(1).toString(), QStringLiteral("https://example.com/photos/detail.jpg"));
        QCOMPARE(images.at(2).toString(), QStringLiteral("https://cdn.example.net/chart.png"));
        QCOMPARE(images.at(3).toString(), QStringLiteral("https://example.com/media/extra.jpg"));
    }

    void readerSelectsLazyAndResponsiveImages()
    {
        const QString html = QStringLiteral(
            "<html><head><meta property=\"og:title\" content=\"Responsive Story\">"
            "<meta property=\"og:image\" content=\"/media/hero.jpg\"></head><body>"
            "<article class=\"story-content\">"
            "<p>The first responsive image paragraph is long enough to pass all reader"
            " extraction thresholds and provide useful article context.</p>"
            "<p>The second responsive image paragraph is similarly complete and ensures"
            " this article region is selected by the scoring logic.</p>"
            "<p>The third responsive image paragraph supplies enough body text for the"
            " image assertions to exercise the primary extraction path.</p>"
            "<img src=\"/images/placeholder.jpg\" data-lazy-src=\"/photos/lazy.jpg\">"
            "<img src=\"/photos/small.jpg\" srcset=\"/photos/small.jpg 320w, /photos/large.jpg 1280w\">"
            "<img data-srcset=\"//cdn.example.net/chart.jpg 1x, //cdn.example.net/chart@2x.jpg 2x\">"
            "<picture><source srcset=\"/photos/wide-small.webp 640w, /photos/wide.webp 1600w\">"
            "<img src=\"/photos/wide-fallback.jpg\"></picture>"
            "</article></body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://example.com/news/story"));
        const QVariantList images = article.value(QStringLiteral("images")).toList();

        QCOMPARE(images.size(), 5);
        QCOMPARE(images.at(0).toString(), QStringLiteral("https://example.com/media/hero.jpg"));
        QCOMPARE(images.at(1).toString(), QStringLiteral("https://example.com/photos/lazy.jpg"));
        QCOMPARE(images.at(2).toString(), QStringLiteral("https://example.com/photos/large.jpg"));
        QCOMPARE(images.at(3).toString(), QStringLiteral("https://cdn.example.net/chart@2x.jpg"));
        QCOMPARE(images.at(4).toString(), QStringLiteral("https://example.com/photos/wide.webp"));
    }

    void liveFeedCatalogMatchesRendererSources()
    {
        HttpClient http;
        LiveFeedService live(&http);

        QCOMPARE(live.feedIds(), QStringList({
            QStringLiteral("live-bloomberg"),
            QStringLiteral("live-radio-canada"),
            QStringLiteral("live-france24"),
            QStringLiteral("live-cbc-news"),
            QStringLiteral("live-lcn"),
            QStringLiteral("euronews"),
        }));
        QVERIFY(live.isYouTube(QStringLiteral("live-bloomberg")));
        QCOMPARE(live.videoId(QStringLiteral("live-bloomberg")),
                 QStringLiteral("iEpJwprxDdk"));
        QCOMPARE(live.videoId(QStringLiteral("live-france24")),
                 QStringLiteral("HvZt-nh9sGg"));
        QCOMPARE(live.sourceLabel(QStringLiteral("live-lcn")), QStringLiteral("HLS"));
        QVERIFY(live.webUrl(QStringLiteral("euronews")).endsWith(
            QStringLiteral("playlist.m3u8")));
    }

    void liveAudioOwnerRejectsUnknownFeeds()
    {
        HttpClient http;
        LiveFeedService live(&http);
        QSignalSpy changed(&live, &LiveFeedService::audioFeedIdChanged);

        live.requestAudio(QStringLiteral("not-a-feed"));
        QCOMPARE(live.audioFeedId(), QString());
        QCOMPARE(changed.count(), 0);

        live.requestAudio(QStringLiteral("euronews"));
        QCOMPARE(live.audioFeedId(), QStringLiteral("euronews"));
        QCOMPARE(changed.count(), 1);
        live.requestAudio(QString());
        QCOMPARE(live.audioFeedId(), QString());
        QCOMPARE(changed.count(), 2);
    }

    void liveDetailAcceptsOnlyNativeHlsFeeds()
    {
        HttpClient http;
        LiveFeedService live(&http);
        QSignalSpy detailChanged(&live, &LiveFeedService::detailChanged);

        QVERIFY(!live.openDetail(QStringLiteral("not-a-feed")));
        QVERIFY(!live.openDetail(QStringLiteral("live-bloomberg")));
        QVERIFY(!live.detailOpen());
        QCOMPARE(detailChanged.count(), 0);

        QVERIFY(live.openDetail(QStringLiteral("euronews")));
        QVERIFY(live.detailOpen());
        QCOMPARE(live.detailFeedId(), QStringLiteral("euronews"));
        QVERIFY(live.detailUrl().endsWith(QStringLiteral("playlist.m3u8")));
        QCOMPARE(detailChanged.count(), 1);

        live.requestAudio(QStringLiteral("euronews"));
        QCOMPARE(live.audioFeedId(), QStringLiteral("euronews"));
        live.closeDetail();
        QVERIFY(!live.detailOpen());
        QCOMPARE(live.detailFeedId(), QString());
        QCOMPARE(live.detailUrl(), QString());
        QCOMPARE(live.audioFeedId(), QString());
        QCOMPARE(detailChanged.count(), 2);
    }
};

QTEST_MAIN(TestQtPanel)
#include "test_qtpanel.moc"
