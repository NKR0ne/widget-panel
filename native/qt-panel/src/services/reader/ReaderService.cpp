#include "ReaderService.h"

#include "core/HttpClient.h"
#include "core/TextFix.h"

#include <QDebug>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QUrl>

namespace qtpanel {

namespace {

QString decodeEntities(QString text)
{
    text.replace(QLatin1String("&nbsp;"), QLatin1String(" "), Qt::CaseInsensitive);
    text.replace(QLatin1String("&amp;"), QLatin1String("&"), Qt::CaseInsensitive);
    text.replace(QLatin1String("&quot;"), QLatin1String("\""), Qt::CaseInsensitive);
    text.replace(QLatin1String("&#39;"), QLatin1String("'"));
    text.replace(QLatin1String("&apos;"), QLatin1String("'"), Qt::CaseInsensitive);
    text.replace(QLatin1String("&lt;"), QLatin1String("<"), Qt::CaseInsensitive);
    text.replace(QLatin1String("&gt;"), QLatin1String(">"), Qt::CaseInsensitive);
    static const QRegularExpression numeric(QStringLiteral("&#(x?)([0-9a-fA-F]+);"));
    QRegularExpressionMatchIterator it = numeric.globalMatch(text);
    QString out;
    qsizetype last = 0;
    while (it.hasNext()) {
        const QRegularExpressionMatch m = it.next();
        out += text.mid(last, m.capturedStart() - last);
        bool ok = false;
        const uint code = m.captured(2).toUInt(&ok, m.captured(1).isEmpty() ? 10 : 16);
        if (ok && code > 0)
            out += QString::fromUcs4(reinterpret_cast<const char32_t*>(&code), 1);
        last = m.capturedEnd();
    }
    out += text.mid(last);
    return out;
}

QString stripTags(QString html)
{
    static const QRegularExpression scripts(
        QStringLiteral("<(script|style|noscript)\\b[\\s\\S]*?</\\1>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression tags(QStringLiteral("<[^>]+>"));
    static const QRegularExpression spaces(QStringLiteral("\\s+"));
    html.remove(scripts);
    html.replace(tags, QStringLiteral(" "));
    html.replace(spaces, QStringLiteral(" "));
    return decodeEntities(html).trimmed();
}

QString metaContent(const QString& html, const QString& attr, const QString& name)
{
    // <meta property="og:title" content="..."> in either attribute order.
    const QRegularExpression forward(
        QStringLiteral("<meta[^>]+%1\\s*=\\s*[\"']%2[\"'][^>]*content\\s*=\\s*[\"']([^\"']*)[\"']")
            .arg(attr, QRegularExpression::escape(name)),
        QRegularExpression::CaseInsensitiveOption);
    const QRegularExpression backward(
        QStringLiteral("<meta[^>]+content\\s*=\\s*[\"']([^\"']*)[\"'][^>]*%1\\s*=\\s*[\"']%2[\"']")
            .arg(attr, QRegularExpression::escape(name)),
        QRegularExpression::CaseInsensitiveOption);
    QString value = forward.match(html).captured(1);
    if (value.isEmpty())
        value = backward.match(html).captured(1);
    return decodeEntities(value).trimmed();
}

} // namespace

ReaderService::ReaderService(HttpClient* http, QObject* parent)
    : QObject(parent)
    , m_http(http)
{
}

void ReaderService::open(const QString& url, const QString& seedTitle,
                         const QString& seedSource, const QString& seedImage)
{
    const quint64 serial = ++m_requestSerial;
    m_article = {
        {QStringLiteral("url"), url},
        {QStringLiteral("title"), seedTitle},
        {QStringLiteral("source"), seedSource.isEmpty() ? QUrl(url).host() : seedSource},
        {QStringLiteral("image"), seedImage},
        {QStringLiteral("byline"), QString()},
        {QStringLiteral("paragraphs"), QVariantList{}},
    };
    emit articleChanged();
    emit opened();

    m_busy = true;
    emit busyChanged();

    m_http->getText(QUrl(url), this, [this, serial, url](const QString& html, const QString& error) {
        if (serial != m_requestSerial)
            return; // a newer article superseded this fetch
        m_busy = false;
        emit busyChanged();
        if (!error.isEmpty()) {
            qWarning() << "[reader] fetch failed:" << url << error;
            emit failed(error);
            return;
        }
        QVariantMap extracted = extract(html, url);
        // Keep seeds when extraction came back thinner.
        if (extracted.value(QStringLiteral("title")).toString().isEmpty())
            extracted.insert(QStringLiteral("title"), m_article.value(QStringLiteral("title")));
        if (extracted.value(QStringLiteral("image")).toString().isEmpty())
            extracted.insert(QStringLiteral("image"), m_article.value(QStringLiteral("image")));
        extracted.insert(QStringLiteral("url"), url);
        extracted.insert(QStringLiteral("source"), m_article.value(QStringLiteral("source")));
        m_article = extracted;
        emit articleChanged();
        qInfo() << "[reader]" << url << "->"
                << extracted.value(QStringLiteral("paragraphs")).toList().size() << "paragraphs";
    }, QStringLiteral("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
}

void ReaderService::openArchive(const QString& url)
{
    if (url.trimmed().isEmpty())
        return;
    const quint64 serial = ++m_requestSerial;
    m_busy = true;
    emit busyChanged();

    const QUrl apiUrl(QStringLiteral("https://archive.org/wayback/available?url=")
                      + QString::fromUtf8(QUrl::toPercentEncoding(url)));
    m_http->getJson(apiUrl, this, [this, serial, url](const QJsonDocument& doc, const QString& error) {
        if (serial != m_requestSerial)
            return;
        const QString snapshotUrl = doc.object()
            .value(QLatin1String("archived_snapshots")).toObject()
            .value(QLatin1String("closest")).toObject()
            .value(QLatin1String("url")).toString();
        if (!error.isEmpty() || snapshotUrl.isEmpty()) {
            m_busy = false;
            emit busyChanged();
            emit failed(QStringLiteral("Aucune archive disponible"));
            return;
        }
        // `id_` replay returns the original HTML without the Wayback chrome.
        static const QRegularExpression tsRe(QStringLiteral("/web/(\\d+)/"));
        const QString timestamp = tsRe.match(snapshotUrl).captured(1);
        const QString replayUrl = timestamp.isEmpty()
            ? snapshotUrl
            : QStringLiteral("https://web.archive.org/web/%1id_/%2").arg(timestamp, url);

        m_http->getText(QUrl(replayUrl), this,
                        [this, serial, url](const QString& html, const QString& fetchError) {
            if (serial != m_requestSerial)
                return;
            m_busy = false;
            emit busyChanged();
            if (!fetchError.isEmpty()) {
                emit failed(fetchError);
                return;
            }
            QVariantMap extracted = extract(html, url);
            extracted.insert(QStringLiteral("url"), url);
            extracted.insert(QStringLiteral("source"),
                             m_article.value(QStringLiteral("source")));
            extracted.insert(QStringLiteral("archived"), true);
            if (extracted.value(QStringLiteral("title")).toString().isEmpty())
                extracted.insert(QStringLiteral("title"), m_article.value(QStringLiteral("title")));
            m_article = extracted;
            emit articleChanged();
            qInfo() << "[reader] archive" << url << "->"
                    << extracted.value(QStringLiteral("paragraphs")).toList().size()
                    << "paragraphs";
        }, QStringLiteral("text/html,application/xhtml+xml,*/*;q=0.8"));
    });
}

void ReaderService::close()
{
    ++m_requestSerial;
    if (m_busy) {
        m_busy = false;
        emit busyChanged();
    }
    if (!m_article.isEmpty()) {
        m_article.clear();
        emit articleChanged();
    }
}

QVariantMap ReaderService::extract(const QString& html, const QString& url)
{
    QString title = metaContent(html, QStringLiteral("property"), QStringLiteral("og:title"));
    if (title.isEmpty()) {
        static const QRegularExpression titleTag(
            QStringLiteral("<title[^>]*>([\\s\\S]*?)</title>"),
            QRegularExpression::CaseInsensitiveOption);
        title = stripTags(titleTag.match(html).captured(1));
    }

    QString image = metaContent(html, QStringLiteral("property"), QStringLiteral("og:image"));
    if (!image.isEmpty())
        image = QUrl(url).resolved(QUrl(image)).toString();

    QString byline = metaContent(html, QStringLiteral("name"), QStringLiteral("author"));
    if (byline.isEmpty())
        byline = metaContent(html, QStringLiteral("property"), QStringLiteral("article:author"));
    if (byline.startsWith(QLatin1String("http")))
        byline.clear();

    // Prefer the <article> region; fall back to the whole page.
    static const QRegularExpression articleRegion(
        QStringLiteral("<article\\b[\\s\\S]*?</article>"),
        QRegularExpression::CaseInsensitiveOption);
    QString region = articleRegion.match(html).captured(0);
    if (region.size() < 500)
        region = html;

    static const QRegularExpression paragraphRe(
        QStringLiteral("<p\\b[^>]*>([\\s\\S]*?)</p>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression junkRe(
        QStringLiteral("cookie|consent|abonn|subscribe|newsletter|javascript|publicité|advertisement|sign in|log in"),
        QRegularExpression::CaseInsensitiveOption);

    QVariantList paragraphs;
    QRegularExpressionMatchIterator it = paragraphRe.globalMatch(region);
    while (it.hasNext() && paragraphs.size() < 60) {
        const QString text = TextFix::repairMojibake(stripTags(it.next().captured(1)));
        if (text.size() < 40)
            continue; // captions, buttons, nav crumbs
        if (text.size() < 90 && junkRe.match(text).hasMatch())
            continue;
        paragraphs.append(text);
    }

    return {
        {QStringLiteral("title"), TextFix::repairMojibake(title)},
        {QStringLiteral("byline"), TextFix::repairMojibake(byline)},
        {QStringLiteral("image"), image},
        {QStringLiteral("paragraphs"), paragraphs},
    };
}

} // namespace qtpanel
