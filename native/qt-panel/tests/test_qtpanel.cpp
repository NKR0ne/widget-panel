#include <QtTest>

#include "core/TextFix.h"
#include "core/SettingsStore.h"
#include "services/news/NewsService.h"
#include "services/reader/ReaderService.h"
#include "shell/FocusPolicy.h"

#include <QTemporaryDir>

using namespace qtpanel;

// Unit coverage for the trickiest pure-logic ports: encoding repair, the
// blur-to-hide heuristics, the settings store, and RSS/Atom parsing.
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
};

QTEST_MAIN(TestQtPanel)
#include "test_qtpanel.moc"
