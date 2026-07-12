#include "ReaderService.h"

#include "core/HttpClient.h"
#include "core/TextFix.h"

#include <QDebug>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QRegularExpression>
#include <QSet>
#include <QUrl>
#include <QUrlQuery>

#include <algorithm>

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

QString absolutizeUrl(const QString& rawUrl, const QString& baseUrl)
{
    QString value = decodeEntities(rawUrl).trimmed();
    if (value.isEmpty())
        return {};
    const QUrl base(baseUrl);
    if (value.startsWith(QLatin1String("//")))
        value = base.scheme() + QLatin1Char(':') + value;
    return base.resolved(QUrl(value)).toString();
}

QString compactText(const QString& text)
{
    static const QRegularExpression spaces(QStringLiteral("\\s+"));
    QString out = decodeEntities(text);
    out.replace(spaces, QStringLiteral(" "));
    return TextFix::repairMojibake(out.trimmed());
}

QString readerChromeStripped(QString html)
{
    static const QRegularExpression comments(
        QStringLiteral("<!--[\\s\\S]*?-->"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression scripts(
        QStringLiteral("<(script|style|noscript|svg)\\b[\\s\\S]*?</\\1>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression chrome(
        QStringLiteral("<(nav|header|footer|aside|form|button|iframe|canvas|figure)\\b[\\s\\S]*?</\\1>"),
        QRegularExpression::CaseInsensitiveOption);
    html.remove(comments);
    html.remove(scripts);
    html.remove(chrome);
    return html;
}

QString cutAfterReaderStopMarker(const QString& html)
{
    static const QRegularExpression markerRe(
        QStringLiteral("<(h[1-6]|p|div|section|span)\\b[^>]*>([\\s\\S]*?)</\\1>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression stopRe(
        QStringLiteral("^(read also|read next|related articles|related stories)\\s*:?\\s*$"),
        QRegularExpression::CaseInsensitiveOption);

    QRegularExpressionMatchIterator it = markerRe.globalMatch(html);
    while (it.hasNext()) {
        const QRegularExpressionMatch match = it.next();
        const QString text = compactText(stripTags(match.captured(2)));
        if (stopRe.match(text).hasMatch())
            return html.left(match.capturedStart());
    }
    return html;
}

QString stripReaderNoise(QString html)
{
    static const QString noiseAttr = QStringLiteral(
        "(ad-|ads?|advert|author-bio|breadcrumb|comment|comments|featured|footer|login|"
        "most-popular|newsletter|outbrain|partner|popular|promo|recommend|related|share|"
        "sharing|sidebar|signup|social|sponsor|syndication|tag-list|widget)");
    const QRegularExpression attrBlock(
        QStringLiteral("<((div|section|aside|nav|footer|ul|ol))\\b[^>]*(class|id|role)\\s*=\\s*[\"'][^\"']*%1[^\"']*[\"'][^>]*>[\\s\\S]*?</\\1>")
            .arg(noiseAttr),
        QRegularExpression::CaseInsensitiveOption);
    for (int i = 0; i < 4; ++i)
        html.remove(attrBlock);
    return cutAfterReaderStopMarker(html);
}

struct ReaderCandidate {
    QString html;
    int priority = 0;
    int paragraphCount = 0;
    int textLength = 0;
};

void addReaderCandidate(QList<ReaderCandidate>& candidates, const QString& html, int priority)
{
    if (html.trimmed().isEmpty())
        return;
    static const QRegularExpression paragraphRe(
        QStringLiteral("<p[\\s>]"),
        QRegularExpression::CaseInsensitiveOption);
    const int paragraphCount = static_cast<int>(html.count(paragraphRe));
    const int textLength = stripTags(html).size();
    if (paragraphCount > 0 || textLength > 450)
        candidates.append({html, priority, paragraphCount, textLength});
}

QString chooseReadableHtml(const QString& html)
{
    const QString withoutNoise = stripReaderNoise(readerChromeStripped(html));
    QList<ReaderCandidate> candidates;

    static const QString contentAttr = QStringLiteral(
        "(?:article[-_ ]?(?:body|content|text)?|body[-_ ]?content|content[-_ ]?(?:body|main|post)?|"
        "entry[-_ ]?content|main[-_ ]?content|post[-_ ]?(?:body|content|text)|"
        "story[-_ ]?(?:body|content))");
    const QRegularExpression contentRe(
        QStringLiteral("<(article|main|section|div)\\b[^>]*(class|id)\\s*=\\s*[\"'][^\"']*%1[^\"']*[\"'][^>]*>([\\s\\S]*?)</\\1>")
            .arg(contentAttr),
        QRegularExpression::CaseInsensitiveOption);
    QRegularExpressionMatchIterator contentIt = contentRe.globalMatch(withoutNoise);
    while (contentIt.hasNext() && candidates.size() < 12)
        addReaderCandidate(candidates, contentIt.next().captured(3), 3);

    static const QRegularExpression articleRegion(
        QStringLiteral("<article\\b[^>]*>([\\s\\S]*?)</article>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression mainRegion(
        QStringLiteral("<main\\b[^>]*>([\\s\\S]*?)</main>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression bodyRegion(
        QStringLiteral("<body\\b[^>]*>([\\s\\S]*?)</body>"),
        QRegularExpression::CaseInsensitiveOption);

    addReaderCandidate(candidates, articleRegion.match(withoutNoise).captured(1), 4);
    addReaderCandidate(candidates, mainRegion.match(withoutNoise).captured(1), 2);
    addReaderCandidate(candidates, bodyRegion.match(withoutNoise).captured(1), 1);
    addReaderCandidate(candidates, withoutNoise, 0);

    std::sort(candidates.begin(), candidates.end(),
              [](const ReaderCandidate& a, const ReaderCandidate& b) {
        const bool aUsable = a.paragraphCount >= 3 || a.textLength > 1200;
        const bool bUsable = b.paragraphCount >= 3 || b.textLength > 1200;
        if (aUsable != bUsable)
            return aUsable > bUsable;
        if (a.priority != b.priority)
            return a.priority > b.priority;
        if (a.paragraphCount != b.paragraphCount)
            return a.paragraphCount > b.paragraphCount;
        return a.textLength > b.textLength;
    });

    return candidates.isEmpty() ? withoutNoise : candidates.first().html;
}

bool endsAsSentence(const QString& text)
{
    static const QRegularExpression sentenceRe(
        QStringLiteral("[.!?][\"'\\)\\]]?$"));
    return sentenceRe.match(text).hasMatch();
}

QString lineKey(QString text)
{
    static const QRegularExpression nonWord(QStringLiteral("[^a-z0-9]+"),
                                            QRegularExpression::CaseInsensitiveOption);
    text = text.toLower();
    text.replace(nonWord, QStringLiteral(" "));
    return text.trimmed();
}

QVariantList extractParagraphBlocks(const QString& articleHtml)
{
    static const QRegularExpression blockRe(
        QStringLiteral("<(p|h2|h3|h4|h5|h6|li|blockquote)\\b[^>]*>([\\s\\S]*?)</\\1>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression inlineModuleRe(
        QStringLiteral("^(advertisement|from our partners|partner content|promoted content|recommended content|sponsored content|sponsored by)\\b"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression hardStopRe(
        QStringLiteral("^(about the author|add your comment|featured on|follow\\b|main sections|more from|most popular|popular features|post a comment|read also|read next|related articles|related stories|share this article|subscribe to|techspot account|top downloads)\\b"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression skipTextRe(
        QStringLiteral("cookie|subscribe|newsletter|advertisement|sign up|log in|login|all rights reserved|share this|read more|serving tech enthusiasts|techspot means tech analysis|create your free account|already have an account|partner content|promoted content|sponsored content"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression bylineOnlyRe(
        QStringLiteral("^by\\s+[\\w\\s.,&-]+$"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression relatedStoriesRe(
        QStringLiteral("^(//\\s*)?related stories\\b"),
        QRegularExpression::CaseInsensitiveOption);

    QVariantList blocks;
    QSet<QString> seen;
    int skipRelatedItems = 0;
    int skipInlineModule = 0;
    int totalChars = 0;

    QRegularExpressionMatchIterator it = blockRe.globalMatch(articleHtml);
    while (it.hasNext()) {
        const QRegularExpressionMatch match = it.next();
        const QString tag = match.captured(1).toLower();
        const QString text = compactText(stripTags(match.captured(2)));
        if (text.isEmpty())
            continue;

        if (inlineModuleRe.match(text).hasMatch()) {
            skipInlineModule = 10;
            continue;
        }
        if (skipInlineModule > 0) {
            if (tag == QLatin1String("p") && text.size() > 140 && endsAsSentence(text)
                && !text.startsWith(QLatin1String("by "), Qt::CaseInsensitive)) {
                skipInlineModule = 0;
            } else {
                --skipInlineModule;
                continue;
            }
        }
        if (relatedStoriesRe.match(text).hasMatch()) {
            skipRelatedItems = 8;
            continue;
        }
        if (hardStopRe.match(text).hasMatch()) {
            if (!blocks.isEmpty())
                break;
            continue;
        }
        if (skipRelatedItems > 0 && tag == QLatin1String("li")) {
            --skipRelatedItems;
            continue;
        }
        if (tag != QLatin1String("li"))
            skipRelatedItems = 0;
        if (text.size() < 35)
            continue;
        if (bylineOnlyRe.match(text).hasMatch())
            continue;
        if (skipTextRe.match(text).hasMatch())
            continue;
        if ((tag == QLatin1String("li") || tag.startsWith(QLatin1Char('h'))) && !endsAsSentence(text))
            continue;

        const QString key = lineKey(text);
        if (seen.contains(key))
            continue;
        seen.insert(key);
        blocks.append(text);
        totalChars += text.size() + 1;
        if (totalChars > 18000 || blocks.size() >= 60)
            break;
    }

    return blocks;
}

QStringList htmlToReadableLines(QString html)
{
    static const QString lineBreak = QStringLiteral("__WP_READER_LINE_BREAK__");
    static const QRegularExpression comments(QStringLiteral("<!--[\\s\\S]*?-->"));
    static const QRegularExpression scripts(
        QStringLiteral("<(script|style|noscript|svg)\\b[\\s\\S]*?</\\1>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression brTag(
        QStringLiteral("<br\\b[^>]*>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression blockOpen(
        QStringLiteral("<(p|div|h[1-6]|li|article|section|main|blockquote)\\b[^>]*>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression blockClose(
        QStringLiteral("</(p|div|h[1-6]|li|article|section|main|blockquote)>"),
        QRegularExpression::CaseInsensitiveOption);

    html.remove(comments);
    html.remove(scripts);
    html.replace(brTag, QLatin1Char(' ') + lineBreak + QLatin1Char(' '));
    html.replace(blockOpen, QLatin1Char(' ') + lineBreak + QLatin1Char(' '));
    html.replace(blockClose, QLatin1Char(' ') + lineBreak + QLatin1Char(' '));

    const QString stripped = stripTags(html);
    QStringList lines = stripped.split(lineBreak, Qt::SkipEmptyParts);
    for (QString& line : lines)
        line = compactText(line);
    lines.removeIf([](const QString& line) { return line.isEmpty(); });
    return lines;
}

QVariantList extractTextParagraphs(const QString& html, const QString& title)
{
    static const QRegularExpression hardStopRe(
        QStringLiteral("^(about the author|add your comment|featured on|follow\\b|main sections|more from|most popular|popular features|post a comment|read also|read next|related articles|related stories|share this article|subscribe to|techspot account|top downloads)\\b"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression inlineModuleRe(
        QStringLiteral("^(advertisement|from our partners|partner content|promoted content|recommended content|sponsored content|sponsored by)\\b"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression lineSkipRe(
        QStringLiteral("^(about|advertise|all|analytics|articles|by\\s+[\\w\\s.,&-]+|comments?|contact|cookies?|copyright|download|events?|follow|home|login|menu|newsletter|podcasts?|privacy|register|resources?|search|share|subscribe|terms|topics|view all)$"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression skipTextRe(
        QStringLiteral("cookie|subscribe|newsletter|advertisement|sign up|log in|login|all rights reserved|share this|read more|serving tech enthusiasts|techspot means tech analysis|create your free account|already have an account|partner content|promoted content|sponsored content"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression leadingMetaRe(
        QStringLiteral("^(by|author|date|image|source)\\b"),
        QRegularExpression::CaseInsensitiveOption);

    const QStringList lines = htmlToReadableLines(cutAfterReaderStopMarker(stripReaderNoise(html)));
    const QString titleKey = lineKey(title);
    int startIndex = -1;
    if (!titleKey.isEmpty()) {
        for (qsizetype i = 0; i < lines.size(); ++i) {
            const QString key = lineKey(lines.at(i));
            if (!key.isEmpty() && (key.contains(titleKey) || titleKey.contains(key))) {
                startIndex = static_cast<int>(i);
                break;
            }
        }
    }

    QVariantList blocks;
    QSet<QString> seen;
    int skipInlineModule = 0;
    int totalChars = 0;
    bool seenArticleLikeText = false;
    for (qsizetype i = qMax(0, startIndex + 1); i < lines.size(); ++i) {
        const QString text = lines.at(i);
        if (hardStopRe.match(text).hasMatch()) {
            if (!blocks.isEmpty())
                break;
            continue;
        }
        if (inlineModuleRe.match(text).hasMatch()) {
            skipInlineModule = 10;
            continue;
        }
        if (skipInlineModule > 0) {
            if (text.size() > 140 && endsAsSentence(text)
                && !text.startsWith(QLatin1String("by "), Qt::CaseInsensitive)) {
                skipInlineModule = 0;
            } else {
                --skipInlineModule;
                continue;
            }
        }
        if (text.size() < 55)
            continue;
        if (!endsAsSentence(text))
            continue;
        if (lineSkipRe.match(text).hasMatch() || skipTextRe.match(text).hasMatch())
            continue;
        if (!seenArticleLikeText && leadingMetaRe.match(text).hasMatch())
            continue;
        seenArticleLikeText = true;

        const QString key = lineKey(text);
        if (seen.contains(key))
            continue;
        seen.insert(key);
        blocks.append(text);
        totalChars += text.size() + 1;
        if (totalChars > 18000 || blocks.size() >= 60)
            break;
    }

    return blocks;
}

QVariantList extractImages(const QString& html, const QString& baseUrl, const QString& hero)
{
    static const QRegularExpression imageTagRe(
        QStringLiteral("<(img|source)\\b[^>]*>"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression skipImageRe(
        QStringLiteral("logo|icon|avatar|sprite|tracking|pixel|spacer|transparent|placeholder|(?:^|[/_.-])blank(?:[/_.?-]|$)|(?:^|[/_.-])1x1(?:[/_.?-]|$)"),
        QRegularExpression::CaseInsensitiveOption);

    auto attribute = [](const QString& tag, const QString& name) {
        const QRegularExpression attributeRe(
            QStringLiteral("\\s%1\\s*=\\s*[\"']([^\"']+)[\"']")
                .arg(QRegularExpression::escape(name)),
            QRegularExpression::CaseInsensitiveOption);
        return attributeRe.match(tag).captured(1).trimmed();
    };

    auto bestSrcsetUrl = [](const QString& srcset) {
        QString bestUrl;
        double bestScore = -1.0;
        const QStringList candidates = srcset.split(QLatin1Char(','), Qt::SkipEmptyParts);
        static const QRegularExpression candidateRe(
            QStringLiteral("^\\s*(\\S+)(?:\\s+(\\d+(?:\\.\\d+)?)\\s*([wx]))?\\s*$"),
            QRegularExpression::CaseInsensitiveOption);
        for (const QString& candidate : candidates) {
            const QRegularExpressionMatch match = candidateRe.match(candidate);
            if (!match.hasMatch())
                continue;
            bool ok = false;
            const double descriptor = match.captured(2).toDouble(&ok);
            const double score = ok ? descriptor : 0.0;
            if (bestUrl.isEmpty() || score > bestScore) {
                bestUrl = match.captured(1);
                bestScore = score;
            }
        }
        return bestUrl;
    };

    QVariantList images;
    QSet<QString> seen;
    auto addImage = [&](const QString& raw) {
        const QString image = absolutizeUrl(raw, baseUrl);
        if (!image.startsWith(QLatin1String("http"), Qt::CaseInsensitive))
            return false;
        if (skipImageRe.match(image).hasMatch())
            return false;
        if (seen.contains(image))
            return false;
        seen.insert(image);
        images.append(image);
        return true;
    };

    if (!hero.isEmpty())
        addImage(hero);
    QRegularExpressionMatchIterator it = imageTagRe.globalMatch(html);
    while (it.hasNext() && images.size() < 5) {
        const QString tag = it.next().captured(0);
        const QStringList candidates = {
            attribute(tag, QStringLiteral("data-lazy-src")),
            attribute(tag, QStringLiteral("data-original")),
            attribute(tag, QStringLiteral("data-original-src")),
            attribute(tag, QStringLiteral("data-src")),
            attribute(tag, QStringLiteral("data-image")),
            bestSrcsetUrl(attribute(tag, QStringLiteral("data-srcset"))),
            bestSrcsetUrl(attribute(tag, QStringLiteral("srcset"))),
            attribute(tag, QStringLiteral("src")),
        };
        for (const QString& candidate : candidates) {
            if (!candidate.isEmpty() && addImage(candidate))
                break;
        }
    }
    return images;
}

bool detectPaywall(const QString& html)
{
    const QString sample = stripTags(html).left(24000);
    static const QRegularExpression textRe(
        QStringLiteral("subscribe to continue|subscription required|already a subscriber|sign in to continue|register to continue|create an account to continue|to continue reading|this article is reserved|premium content|paywall|metered paywall|become a subscriber|subscriber-only"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression classRe(
        QStringLiteral("class\\s*=\\s*[\"'][^\"']*(paywall|subscriber|subscription|premium-content|regwall)[^\"']*[\"']"),
        QRegularExpression::CaseInsensitiveOption);
    return textRe.match(sample).hasMatch() || classRe.match(html).hasMatch();
}

QString detectBotChallenge(const QString& html)
{
    const QString sample = stripTags(html).left(12000);
    static const QRegularExpression challengeRe(
        QStringLiteral("cf-mitigated:\\s*challenge|checking your browser|cloudflare|captcha|performing security verification|protect against malicious bots|verify you are not a bot|returned error 403:\\s*forbidden"),
        QRegularExpression::CaseInsensitiveOption);
    const QRegularExpressionMatch match = challengeRe.match(sample);
    return match.hasMatch() ? match.captured(0) : QString();
}

int paragraphTextLength(const QVariantList& paragraphs)
{
    int total = 0;
    for (const QVariant& paragraph : paragraphs)
        total += paragraph.toString().size() + 1;
    return total;
}

QVariantList seedSummaryParagraphs(const QString& seedSummary, const QString& seedTitle)
{
    const QString text = compactText(stripTags(seedSummary));
    if (text.size() < 80)
        return {};
    const QString titleKey = lineKey(seedTitle);
    const QString textKey = lineKey(text);
    if (!titleKey.isEmpty() && (textKey == titleKey || titleKey.contains(textKey)))
        return {};
    return QVariantList{text};
}

QVariantMap seedSummaryArticle(const QString& url, const QString& seedTitle,
                               const QString& seedSource, const QString& seedImage,
                               const QString& seedSummary, const QString& reason)
{
    const QVariantList paragraphs = seedSummaryParagraphs(seedSummary, seedTitle);
    return {
        {QStringLiteral("url"), url},
        {QStringLiteral("title"), seedTitle},
        {QStringLiteral("source"), seedSource.isEmpty() ? QUrl(url).host() : seedSource},
        {QStringLiteral("sourceLabel"), QStringLiteral("feed summary")},
        {QStringLiteral("image"), seedImage},
        {QStringLiteral("images"), seedImage.isEmpty() ? QVariantList{} : QVariantList{seedImage}},
        {QStringLiteral("byline"), QString()},
        {QStringLiteral("description"), seedSummary},
        {QStringLiteral("paragraphs"), paragraphs},
        {QStringLiteral("excerpt"), paragraphs.isEmpty() ? QString() : paragraphs.first().toString()},
        {QStringLiteral("fallbackUsed"), true},
        {QStringLiteral("seedFallback"), true},
        {QStringLiteral("fallbackReason"), reason},
    };
}

QString waybackReplayUrl(const QString& timestamp, const QString& originalUrl)
{
    if (timestamp.isEmpty() || originalUrl.isEmpty())
        return {};
    return QStringLiteral("https://web.archive.org/web/%1id_/%2").arg(timestamp, originalUrl);
}

QString waybackReplayUrlFromSnapshot(const QString& snapshotUrl, const QString& originalUrl)
{
    static const QRegularExpression tsRe(QStringLiteral("/web/(\\d+)/"));
    const QString timestamp = tsRe.match(snapshotUrl).captured(1);
    return timestamp.isEmpty() ? snapshotUrl : waybackReplayUrl(timestamp, originalUrl);
}

QStringList waybackLookupVariants(const QString& url)
{
    QStringList variants;
    auto add = [&variants](const QString& value) {
        if (!value.isEmpty() && !variants.contains(value))
            variants.append(value);
    };

    add(url);
    QUrl parsed(url);
    if (!parsed.isValid())
        return variants;

    parsed.setFragment(QString());
    add(parsed.toString());
    parsed.setQuery(QString());
    add(parsed.toString());

    const QString baseHost = parsed.host();
    QStringList hosts{baseHost};
    if (baseHost.startsWith(QLatin1String("www.")))
        hosts.append(baseHost.mid(4));
    else if (!baseHost.isEmpty())
        hosts.append(QStringLiteral("www.") + baseHost);

    QStringList schemes{parsed.scheme()};
    schemes.append(parsed.scheme() == QLatin1String("https") ? QStringLiteral("http")
                                                             : QStringLiteral("https"));
    for (const QString& scheme : schemes) {
        for (const QString& host : hosts) {
            QUrl variant = parsed;
            variant.setScheme(scheme);
            variant.setHost(host);
            add(variant.toString());
        }
    }

    static const QRegularExpression ftHostRe(QStringLiteral("(^|\\.)ft\\.com$"),
                                             QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression ftContentRe(QStringLiteral("^/content/([^/?#]+)"),
                                                QRegularExpression::CaseInsensitiveOption);
    if (ftHostRe.match(baseHost).hasMatch()) {
        const QString contentId = ftContentRe.match(parsed.path()).captured(1);
        if (!contentId.isEmpty()) {
            add(QStringLiteral("https://www.ft.com/content/%1").arg(contentId));
            add(QStringLiteral("http://www.ft.com/content/%1").arg(contentId));
        }
    }

    return variants;
}

QUrl waybackAvailabilityApiUrl(const QString& url)
{
    return QUrl(QStringLiteral("https://archive.org/wayback/available?url=")
                + QString::fromUtf8(QUrl::toPercentEncoding(url)));
}

QUrl waybackCdxApiUrl(const QString& endpoint, const QString& url)
{
    QUrl api(endpoint);
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("url"), url);
    query.addQueryItem(QStringLiteral("output"), QStringLiteral("json"));
    query.addQueryItem(QStringLiteral("fl"),
                       QStringLiteral("timestamp,original,statuscode,mimetype,digest"));
    query.addQueryItem(QStringLiteral("filter"), QStringLiteral("statuscode:200"));
    query.addQueryItem(QStringLiteral("filter"), QStringLiteral("mimetype:text/html"));
    query.addQueryItem(QStringLiteral("collapse"), QStringLiteral("digest"));
    query.addQueryItem(QStringLiteral("limit"), QStringLiteral("-8"));
    api.setQuery(query);
    return api;
}

QString comparableUrl(const QString& value)
{
    QUrl url(value);
    if (url.isValid() && !url.scheme().isEmpty()) {
        url.setFragment(QString());
        url.setQuery(QString());
        QString out = url.toString();
        while (out.endsWith(QLatin1Char('/')))
            out.chop(1);
        return out;
    }
    QString out = value.trimmed();
    out.remove(QRegularExpression(QStringLiteral("[?#].*$")));
    while (out.endsWith(QLatin1Char('/')))
        out.chop(1);
    return out;
}

QString cleanXmlText(QString value)
{
    value.replace(QRegularExpression(QStringLiteral("^<!\\[CDATA\\[")), QString());
    value.replace(QRegularExpression(QStringLiteral("\\]\\]>$")), QString());
    value.replace(QRegularExpression(QStringLiteral("<[^>]+>")), QStringLiteral(" "));
    return compactText(value);
}

QString extractXmlTag(const QString& xml, const QString& tag)
{
    const QRegularExpression re(
        QStringLiteral("<%1\\b[^>]*>([\\s\\S]*?)</%1>")
            .arg(QRegularExpression::escape(tag)),
        QRegularExpression::CaseInsensitiveOption);
    return cleanXmlText(re.match(xml).captured(1));
}

QString extractXmlAttr(const QString& xml, const QString& tag, const QString& attr)
{
    const QRegularExpression re(
        QStringLiteral("<%1\\b[^>]*\\b%2\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>")
            .arg(QRegularExpression::escape(tag), QRegularExpression::escape(attr)),
        QRegularExpression::CaseInsensitiveOption);
    return cleanXmlText(re.match(xml).captured(1));
}

QStringList publisherFeedUrls(const QString& url)
{
    const QString host = QUrl(url).host().toLower();
    if (host.endsWith(QLatin1String("bloomberg.com")))
        return {QStringLiteral("https://feeds.bloomberg.com/markets/news.rss")};
    if (host.endsWith(QLatin1String("eetimes.com")))
        return {QStringLiteral("https://www.eetimes.com/feed/")};
    return {};
}

QString publisherSource(const QString& url)
{
    const QString host = QUrl(url).host().toLower();
    if (host.endsWith(QLatin1String("bloomberg.com")))
        return QStringLiteral("bloomberg.com");
    if (host.endsWith(QLatin1String("eetimes.com")))
        return QStringLiteral("eetimes.com");
    return host;
}

QVariantMap parsePublisherFeedArticle(const QString& xml, const QString& originalUrl,
                                      const QString& source)
{
    static const QRegularExpression itemRe(QStringLiteral("<item\\b[^>]*>([\\s\\S]*?)</item>"),
                                           QRegularExpression::CaseInsensitiveOption);
    const QString target = comparableUrl(originalUrl);
    QRegularExpressionMatchIterator it = itemRe.globalMatch(xml);
    while (it.hasNext()) {
        const QString item = it.next().captured(1);
        const QString link = extractXmlTag(item, QStringLiteral("link"));
        const QString guid = extractXmlTag(item, QStringLiteral("guid"));
        const QString matchedLink = link.isEmpty() ? guid : link;
        if (comparableUrl(matchedLink) != target)
            continue;

        const QString description = extractXmlTag(item, QStringLiteral("description"));
        if (description.size() < 80)
            return {};
        QString image = extractXmlAttr(item, QStringLiteral("media:content"), QStringLiteral("url"));
        if (image.isEmpty())
            image = extractXmlAttr(item, QStringLiteral("media:thumbnail"), QStringLiteral("url"));
        image = absolutizeUrl(image, matchedLink.isEmpty() ? originalUrl : matchedLink);
        const QString title = extractXmlTag(item, QStringLiteral("title"));
        const QString author = extractXmlTag(item, QStringLiteral("dc:creator"));
        const QString date = extractXmlTag(item, QStringLiteral("pubDate"));
        return {
            {QStringLiteral("url"), originalUrl},
            {QStringLiteral("finalUrl"), matchedLink.isEmpty() ? originalUrl : matchedLink},
            {QStringLiteral("source"), source},
            {QStringLiteral("sourceLabel"), QStringLiteral("publisher feed")},
            {QStringLiteral("title"), title},
            {QStringLiteral("byline"), author},
            {QStringLiteral("description"), author.isEmpty()
                 ? QStringLiteral("Publisher feed preview")
                 : QStringLiteral("Publisher feed preview by %1").arg(author)},
            {QStringLiteral("date"), date},
            {QStringLiteral("image"), image},
            {QStringLiteral("images"), image.isEmpty() ? QVariantList{} : QVariantList{image}},
            {QStringLiteral("paragraphs"), QVariantList{description}},
            {QStringLiteral("excerpt"), description},
            {QStringLiteral("fallbackUsed"), true},
            {QStringLiteral("publisherFeedFallback"), true},
        };
    }
    return {};
}

QVariantMap archiveAttempt(const QString& source, const QString& status,
                           const QString& url, const QString& error = {})
{
    QVariantMap attempt{
        {QStringLiteral("source"), source},
        {QStringLiteral("status"), status},
        {QStringLiteral("url"), url},
    };
    if (!error.isEmpty())
        attempt.insert(QStringLiteral("error"), error);
    return attempt;
}

QStringList jinaReaderUrls(const QString& url)
{
    const QString clean = url.trimmed();
    if (clean.isEmpty())
        return {};
    QString noProtocol = clean;
    noProtocol.remove(QRegularExpression(QStringLiteral("^https?://"),
                                         QRegularExpression::CaseInsensitiveOption));
    QStringList urls{
        QStringLiteral("https://r.jina.ai/http://%1").arg(noProtocol),
        QStringLiteral("https://r.jina.ai/http://%1").arg(clean),
    };
    urls.removeDuplicates();
    return urls;
}

QString markdownBody(QString markdown)
{
    static const QRegularExpression marker(QStringLiteral("^Markdown Content:\\s*$"),
                                           QRegularExpression::CaseInsensitiveOption
                                           | QRegularExpression::MultilineOption);
    const QRegularExpressionMatch match = marker.match(markdown);
    if (!match.hasMatch())
        return markdown;
    return markdown.mid(match.capturedEnd()).trimmed();
}

QString cleanMarkdownText(QString value)
{
    static const QRegularExpression imageRe(QStringLiteral("!\\[[^\\]]*\\]\\([^)]+\\)"));
    static const QRegularExpression linkRe(QStringLiteral("\\[([^\\]]+)\\]\\([^)]+\\)"));
    static const QRegularExpression tags(QStringLiteral("<[^>]+>"));
    static const QRegularExpression heading(QStringLiteral("^#{1,6}\\s*"));
    static const QRegularExpression bullet(QStringLiteral("^[-*]\\s+"));
    static const QRegularExpression pipeEdges(QStringLiteral("^\\|+|\\|+$"));
    static const QRegularExpression bold(QStringLiteral("\\*\\*"));
    static const QRegularExpression simpleMarkup(QStringLiteral("[_`]"));
    value = decodeEntities(value);
    value.replace(imageRe, QStringLiteral(" "));
    value.replace(linkRe, QStringLiteral("\\1"));
    value.replace(tags, QStringLiteral(" "));
    value.replace(heading, QString());
    value.replace(bullet, QString());
    value.replace(pipeEdges, QStringLiteral(" "));
    value.replace(bold, QString());
    value.replace(simpleMarkup, QString());
    return compactText(value);
}

QString markdownHeader(const QString& markdown, const QString& name)
{
    const QRegularExpression re(
        QStringLiteral("^%1:\\s*(.+)$").arg(QRegularExpression::escape(name)),
        QRegularExpression::CaseInsensitiveOption | QRegularExpression::MultilineOption);
    return cleanMarkdownText(re.match(markdown).captured(1));
}

QString markdownTitle(const QString& markdown, const QString& fallback)
{
    const QString headerTitle = markdownHeader(markdown, QStringLiteral("Title"));
    if (!headerTitle.isEmpty())
        return headerTitle;
    static const QRegularExpression h1(QStringLiteral("^#\\s+(.+)$"),
                                       QRegularExpression::MultilineOption);
    const QString h1Title = cleanMarkdownText(h1.match(markdownBody(markdown)).captured(1));
    return h1Title.isEmpty() ? fallback : h1Title;
}

QVariantList extractMarkdownImages(const QString& markdown, const QString& baseUrl,
                                   const QString& hero)
{
    static const QRegularExpression imageRe(QStringLiteral("!\\[[^\\]]*\\]\\(([^)]+)\\)"));
    static const QRegularExpression skipImageRe(
        QStringLiteral("logo|icon|avatar|sprite|tracking|pixel|spacer"),
        QRegularExpression::CaseInsensitiveOption);
    QVariantList images;
    QSet<QString> seen;
    auto addImage = [&](const QString& raw) {
        const QString image = absolutizeUrl(raw, baseUrl);
        if (!image.startsWith(QLatin1String("http"), Qt::CaseInsensitive))
            return;
        if (skipImageRe.match(image).hasMatch())
            return;
        if (seen.contains(image))
            return;
        seen.insert(image);
        images.append(image);
    };
    if (!hero.isEmpty())
        addImage(hero);
    QRegularExpressionMatchIterator it = imageRe.globalMatch(markdown);
    while (it.hasNext() && images.size() < 5)
        addImage(decodeEntities(it.next().captured(1)).trimmed());
    return images;
}

QVariantList extractMarkdownParagraphs(const QString& markdown, const QString& title)
{
    static const QRegularExpression hardStopRe(
        QStringLiteral("^(about the author|add your comment|all contents are copyright|connect with us|featured techpaper|for advertisers|more from|popular features|read also|read next|related articles|related stories|related topics|share this|subscribe today)\\b"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression skipRe(
        QStringLiteral("^(advertisement|analytics|applications|business|community|contact|download|featured|home|image|login|menu|newsletter|privacy|register|resources|search|sign in|submit|subscribe|terms|topics|view all)$"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression metaRe(
        QStringLiteral("^(by|author|date|published|updated|source|url source)\\b"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression articleMarkerRe(
        QStringLiteral("^(by\\s+.{2,80}|published\\b|updated\\b|posted\\b)"),
        QRegularExpression::CaseInsensitiveOption);

    const QStringList rawLines = markdownBody(markdown).split(QRegularExpression(QStringLiteral("\\r?\\n")),
                                                              Qt::SkipEmptyParts);
    const QString titleKey = lineKey(title);
    int startIndex = -1;
    for (qsizetype i = 0; i < rawLines.size(); ++i) {
        const QString raw = rawLines.at(i).trimmed();
        const QString key = lineKey(cleanMarkdownText(raw));
        if (raw.startsWith(QLatin1String("# ")) || (!titleKey.isEmpty()
            && !key.isEmpty() && (key.contains(titleKey) || titleKey.contains(key)))) {
            startIndex = static_cast<int>(i);
            break;
        }
    }

    int readFrom = qMax(0, startIndex + 1);
    for (qsizetype i = readFrom; i < rawLines.size(); ++i) {
        if (articleMarkerRe.match(cleanMarkdownText(rawLines.at(i))).hasMatch()) {
            readFrom = static_cast<int>(i + 1);
            break;
        }
    }

    QVariantList blocks;
    QSet<QString> seen;
    int totalChars = 0;
    bool seenArticleText = false;
    for (qsizetype i = readFrom; i < rawLines.size(); ++i) {
        const QString raw = rawLines.at(i).trimmed();
        if (raw.contains(QLatin1String("![")))
            continue;
        if (raw.count(QStringLiteral("](")) > 3)
            continue;
        const bool isHeading = raw.startsWith(QLatin1String("##"))
            || (raw.startsWith(QLatin1String("**")) && raw.endsWith(QLatin1String("**")));
        const QString text = cleanMarkdownText(raw);
        if (text.isEmpty())
            continue;
        if (hardStopRe.match(text).hasMatch()) {
            if (!blocks.isEmpty())
                break;
            continue;
        }
        if (skipRe.match(text).hasMatch() || metaRe.match(text).hasMatch())
            continue;
        if (isHeading) {
            if (seenArticleText && text.size() >= 24 && !seen.contains(lineKey(text))) {
                blocks.append(text);
                seen.insert(lineKey(text));
            }
            continue;
        }
        if (text.size() < 55 || !endsAsSentence(text))
            continue;
        seenArticleText = true;
        const QString key = lineKey(text);
        if (seen.contains(key))
            continue;
        seen.insert(key);
        blocks.append(text);
        totalChars += text.size() + 1;
        if (totalChars > 18000 || blocks.size() >= 60)
            break;
    }
    return blocks;
}

QVariantMap parseJinaMarkdown(const QString& markdown, const QString& finalUrl,
                              const QString& requestedUrl, const QString& hero)
{
    QString source = QUrl(requestedUrl).host();
    source.remove(QRegularExpression(QStringLiteral("^www\\.")));
    const QString title = markdownTitle(markdown, source);
    const QVariantList paragraphs = extractMarkdownParagraphs(markdown, title);
    QVariantList images = extractMarkdownImages(markdownBody(markdown), finalUrl, hero);
    QStringList excerptParts;
    for (qsizetype i = 0; i < qMin<qsizetype>(2, paragraphs.size()); ++i)
        excerptParts.append(paragraphs.at(i).toString());
    return {
        {QStringLiteral("url"), requestedUrl},
        {QStringLiteral("finalUrl"), finalUrl},
        {QStringLiteral("source"), source},
        {QStringLiteral("sourceLabel"), QStringLiteral("jina")},
        {QStringLiteral("title"), title},
        {QStringLiteral("date"), markdownHeader(markdown, QStringLiteral("Published Time"))},
        {QStringLiteral("description"), paragraphs.isEmpty() ? QString()
                                                             : paragraphs.first().toString()},
        {QStringLiteral("image"), images.isEmpty() ? hero : images.first().toString()},
        {QStringLiteral("images"), images},
        {QStringLiteral("paragraphs"), paragraphs},
        {QStringLiteral("excerpt"), excerptParts.join(QLatin1Char(' '))},
        {QStringLiteral("fallbackUsed"), true},
    };
}

} // namespace

ReaderService::ReaderService(HttpClient* http, QObject* parent)
    : QObject(parent)
    , m_http(http)
{
}

void ReaderService::open(const QString& url, const QString& seedTitle,
                         const QString& seedSource, const QString& seedImage,
                         const QString& seedSummary)
{
    const quint64 serial = ++m_requestSerial;
    m_article = {
        {QStringLiteral("url"), url},
        {QStringLiteral("title"), seedTitle},
        {QStringLiteral("source"), seedSource.isEmpty() ? QUrl(url).host() : seedSource},
        {QStringLiteral("image"), seedImage},
        {QStringLiteral("images"), seedImage.isEmpty() ? QVariantList{} : QVariantList{seedImage}},
        {QStringLiteral("description"), seedSummary},
        {QStringLiteral("byline"), QString()},
        {QStringLiteral("paragraphs"), QVariantList{}},
        {QStringLiteral("attempts"), QVariantList{}},
    };
    emit articleChanged();
    emit opened();

    m_busy = true;
    emit busyChanged();

    m_http->getText(QUrl(url), this, [this, serial, url, seedTitle, seedSource,
                                      seedImage, seedSummary](const QString& html,
                                                              const QString& error) {
        if (serial != m_requestSerial)
            return; // a newer article superseded this fetch
        m_busy = false;
        emit busyChanged();
        if (!error.isEmpty()) {
            qWarning() << "[reader] fetch failed:" << url << error;
            QVariantMap fallback = seedSummaryArticle(url, seedTitle, seedSource, seedImage,
                                                      seedSummary, QStringLiteral("direct fetch failed"));
            if (!fallback.value(QStringLiteral("paragraphs")).toList().isEmpty()) {
                fallback.insert(QStringLiteral("attempts"), QVariantList{
                    QVariantMap{
                        {QStringLiteral("source"), QStringLiteral("direct")},
                        {QStringLiteral("status"), QStringLiteral("failed")},
                        {QStringLiteral("error"), error},
                    },
                    QVariantMap{
                        {QStringLiteral("source"), QStringLiteral("feed summary")},
                        {QStringLiteral("status"), QStringLiteral("used")},
                        {QStringLiteral("paragraphs"),
                         fallback.value(QStringLiteral("paragraphs")).toList().size()},
                    },
                });
                m_article = fallback;
                emit articleChanged();
                return;
            }
            emit failed(error);
            return;
        }
        QVariantMap extracted = extractArticleHtml(html, url);
        // Keep seeds when extraction came back thinner.
        if (extracted.value(QStringLiteral("title")).toString().isEmpty())
            extracted.insert(QStringLiteral("title"), m_article.value(QStringLiteral("title")));
        if (extracted.value(QStringLiteral("image")).toString().isEmpty())
            extracted.insert(QStringLiteral("image"), m_article.value(QStringLiteral("image")));
        if (extracted.value(QStringLiteral("source")).toString().isEmpty())
            extracted.insert(QStringLiteral("source"), m_article.value(QStringLiteral("source")));
        const QVariantList seedParagraphs = seedSummaryParagraphs(seedSummary, seedTitle);
        const QVariantList directParagraphs =
            extracted.value(QStringLiteral("paragraphs")).toList();
        const int directChars = paragraphTextLength(directParagraphs);
        const int seedChars = paragraphTextLength(seedParagraphs);
        const bool directFallbackUsed = extracted.value(QStringLiteral("fallbackUsed")).toBool();
        const bool directPaywall = extracted.value(QStringLiteral("paywall")).toBool();
        const QString directChallenge = extracted.value(QStringLiteral("challenge")).toString();
        bool usedSeedSummary = false;
        if (seedChars > directChars && directChars < 450) {
            extracted.insert(QStringLiteral("paragraphs"), seedParagraphs);
            extracted.insert(QStringLiteral("excerpt"), seedParagraphs.first().toString());
            extracted.insert(QStringLiteral("description"), seedSummary);
            extracted.insert(QStringLiteral("fallbackUsed"), true);
            extracted.insert(QStringLiteral("seedFallback"), true);
            extracted.insert(QStringLiteral("fallbackReason"), QStringLiteral("direct extraction too thin"));
            usedSeedSummary = true;
        }
        extracted.insert(QStringLiteral("url"), url);
        extracted.insert(QStringLiteral("sourceLabel"), QStringLiteral("direct"));
        if (usedSeedSummary)
            extracted.insert(QStringLiteral("sourceLabel"), QStringLiteral("feed summary"));
        QVariantList attempts{
            QVariantMap{
                {QStringLiteral("source"), QStringLiteral("direct")},
                {QStringLiteral("status"), QStringLiteral("parsed")},
                {QStringLiteral("bytes"), html.size()},
                {QStringLiteral("paragraphs"), directParagraphs.size()},
                {QStringLiteral("fallback"), directFallbackUsed},
                {QStringLiteral("paywall"), directPaywall},
                {QStringLiteral("challenge"), directChallenge},
            },
            QVariantMap{
                {QStringLiteral("source"), QStringLiteral("feed summary")},
                {QStringLiteral("status"), usedSeedSummary ? QStringLiteral("used")
                                                           : QStringLiteral("available")},
                {QStringLiteral("paragraphs"), seedParagraphs.size()},
            },
        };
        extracted.insert(QStringLiteral("attempts"), attempts);
        if (!usedSeedSummary && directChars < 320) {
            m_busy = true;
            emit busyChanged();
            if (!publisherFeedUrls(url).isEmpty()) {
                tryPublisherFeedFallback(serial, url, seedTitle, seedSource, seedImage,
                                         extracted, attempts, 0);
            } else {
                tryJinaReader(serial, url, seedTitle, seedSource, seedImage, extracted,
                              attempts, 0);
            }
            return;
        }
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

    resolveArchiveAvailability(serial, url, waybackLookupVariants(url), 0, {});
}

void ReaderService::close()
{
    ++m_requestSerial;
    if (m_busy) {
        m_busy = false;
        emit busyChanged();
    }
}

void ReaderService::resolveArchiveAvailability(quint64 serial, const QString& originalUrl,
                                               const QStringList& variants, int index,
                                               QVariantList attempts)
{
    if (serial != m_requestSerial)
        return;
    if (index >= variants.size()) {
        resolveArchiveCdx(serial, originalUrl, variants, 0, 0, attempts);
        return;
    }

    const QString candidate = variants.at(index);
    m_http->getJson(waybackAvailabilityApiUrl(candidate), this,
                    [this, serial, originalUrl, variants, index, candidate,
                     attempts](const QJsonDocument& doc, const QString& error) mutable {
        if (serial != m_requestSerial)
            return;
        const QString snapshotUrl = doc.object()
            .value(QLatin1String("archived_snapshots")).toObject()
            .value(QLatin1String("closest")).toObject()
            .value(QLatin1String("url")).toString();
        if (!error.isEmpty()) {
            attempts.append(archiveAttempt(QStringLiteral("archive.org availability"),
                                           QStringLiteral("failed"), candidate, error));
            resolveArchiveAvailability(serial, originalUrl, variants, index + 1, attempts);
            return;
        }
        if (snapshotUrl.isEmpty()) {
            attempts.append(archiveAttempt(QStringLiteral("archive.org availability"),
                                           QStringLiteral("empty"), candidate));
            resolveArchiveAvailability(serial, originalUrl, variants, index + 1, attempts);
            return;
        }
        attempts.append(archiveAttempt(QStringLiteral("archive.org availability"),
                                       QStringLiteral("found"), candidate));
        openArchiveReplay(serial, originalUrl, waybackReplayUrlFromSnapshot(snapshotUrl, candidate),
                          attempts);
    });
}

void ReaderService::resolveArchiveCdx(quint64 serial, const QString& originalUrl,
                                      const QStringList& variants, int variantIndex,
                                      int endpointIndex, QVariantList attempts)
{
    if (serial != m_requestSerial)
        return;
    static const QStringList endpoints{
        QStringLiteral("https://web.archive.org/cdx"),
        QStringLiteral("https://web.archive.org/cdx/search/cdx"),
    };
    if (variantIndex >= variants.size()) {
        m_busy = false;
        emit busyChanged();
        m_article.insert(QStringLiteral("attempts"), attempts);
        emit articleChanged();
        emit failed(QStringLiteral("Aucune archive disponible"));
        return;
    }
    if (endpointIndex >= endpoints.size()) {
        resolveArchiveCdx(serial, originalUrl, variants, variantIndex + 1, 0, attempts);
        return;
    }

    const QString candidate = variants.at(variantIndex);
    const QString endpoint = endpoints.at(endpointIndex);
    m_http->getJson(waybackCdxApiUrl(endpoint, candidate), this,
                    [this, serial, originalUrl, variants, variantIndex, endpointIndex,
                     candidate, endpoint, attempts](const QJsonDocument& doc,
                                                    const QString& error) mutable {
        if (serial != m_requestSerial)
            return;
        if (!error.isEmpty()) {
            attempts.append(archiveAttempt(QStringLiteral("archive.org cdx"),
                                           QStringLiteral("failed"), candidate, error));
            resolveArchiveCdx(serial, originalUrl, variants, variantIndex, endpointIndex + 1,
                              attempts);
            return;
        }

        const QJsonArray rows = doc.array();
        if (rows.size() < 2) {
            attempts.append(archiveAttempt(QStringLiteral("archive.org cdx"),
                                           QStringLiteral("empty"), candidate));
            resolveArchiveCdx(serial, originalUrl, variants, variantIndex, endpointIndex + 1,
                              attempts);
            return;
        }

        for (int i = rows.size() - 1; i >= 1; --i) {
            const QJsonArray row = rows.at(i).toArray();
            const QString timestamp = row.size() > 0 ? row.at(0).toString() : QString();
            const QString original = row.size() > 1 ? row.at(1).toString(candidate) : candidate;
            if (!timestamp.isEmpty()) {
                attempts.append(archiveAttempt(
                    QStringLiteral("archive.org cdx"),
                    QStringLiteral("found"),
                    QStringLiteral("%1 via %2").arg(candidate, endpoint)));
                openArchiveReplay(serial, originalUrl, waybackReplayUrl(timestamp, original),
                                  attempts);
                return;
            }
        }

        attempts.append(archiveAttempt(QStringLiteral("archive.org cdx"),
                                       QStringLiteral("empty"), candidate));
        resolveArchiveCdx(serial, originalUrl, variants, variantIndex, endpointIndex + 1,
                          attempts);
    });
}

void ReaderService::openArchiveReplay(quint64 serial, const QString& originalUrl,
                                      const QString& replayUrl, QVariantList attempts)
{
    if (serial != m_requestSerial)
        return;
    if (replayUrl.isEmpty()) {
        resolveArchiveCdx(serial, originalUrl, waybackLookupVariants(originalUrl), 0, 0,
                          attempts);
        return;
    }

    m_http->getText(QUrl(replayUrl), this,
                    [this, serial, originalUrl, replayUrl, attempts](const QString& html,
                                                                     const QString& fetchError) mutable {
        if (serial != m_requestSerial)
            return;
        m_busy = false;
        emit busyChanged();
        if (!fetchError.isEmpty()) {
            attempts.append(archiveAttempt(QStringLiteral("archive.org replay"),
                                           QStringLiteral("failed"), replayUrl, fetchError));
            m_article.insert(QStringLiteral("attempts"), attempts);
            emit articleChanged();
            emit failed(fetchError);
            return;
        }
        QVariantMap extracted = extractArticleHtml(html, originalUrl);
        extracted.insert(QStringLiteral("url"), originalUrl);
        extracted.insert(QStringLiteral("source"), m_article.value(QStringLiteral("source")));
        extracted.insert(QStringLiteral("sourceLabel"), QStringLiteral("archive.org snapshot"));
        extracted.insert(QStringLiteral("archived"), true);
        attempts.append(QVariantMap{
            {QStringLiteral("source"), QStringLiteral("archive.org replay")},
            {QStringLiteral("status"), QStringLiteral("parsed")},
            {QStringLiteral("url"), replayUrl},
            {QStringLiteral("bytes"), html.size()},
            {QStringLiteral("paragraphs"),
             extracted.value(QStringLiteral("paragraphs")).toList().size()},
            {QStringLiteral("fallback"), extracted.value(QStringLiteral("fallbackUsed")).toBool()},
            {QStringLiteral("paywall"), extracted.value(QStringLiteral("paywall")).toBool()},
            {QStringLiteral("challenge"), extracted.value(QStringLiteral("challenge")).toString()},
        });
        extracted.insert(QStringLiteral("attempts"), attempts);
        if (extracted.value(QStringLiteral("title")).toString().isEmpty())
            extracted.insert(QStringLiteral("title"), m_article.value(QStringLiteral("title")));
        m_article = extracted;
        emit articleChanged();
        qInfo() << "[reader] archive" << originalUrl << "->"
                << extracted.value(QStringLiteral("paragraphs")).toList().size()
                << "paragraphs";
    }, QStringLiteral("text/html,application/xhtml+xml,*/*;q=0.8"));
}

void ReaderService::tryJinaReader(quint64 serial, const QString& originalUrl,
                                  const QString& seedTitle, const QString& seedSource,
                                  const QString& seedImage, QVariantMap fallbackArticle,
                                  QVariantList attempts, int index)
{
    if (serial != m_requestSerial)
        return;
    const QStringList urls = jinaReaderUrls(originalUrl);
    if (index >= urls.size()) {
        m_busy = false;
        emit busyChanged();
        fallbackArticle.insert(QStringLiteral("attempts"), attempts);
        m_article = fallbackArticle;
        emit articleChanged();
        qInfo() << "[reader]" << originalUrl << "->"
                << fallbackArticle.value(QStringLiteral("paragraphs")).toList().size()
                << "paragraphs (direct fallback)";
        return;
    }

    const QString jinaUrl = urls.at(index);
    m_http->getText(QUrl(jinaUrl), this,
                    [this, serial, originalUrl, seedTitle, seedSource, seedImage,
                     fallbackArticle, attempts, index, jinaUrl](const QString& markdown,
                                                                const QString& error) mutable {
        if (serial != m_requestSerial)
            return;
        if (!error.isEmpty()) {
            attempts.append(QVariantMap{
                {QStringLiteral("source"), QStringLiteral("reader proxy")},
                {QStringLiteral("status"), QStringLiteral("failed")},
                {QStringLiteral("url"), jinaUrl},
                {QStringLiteral("error"), error},
            });
            tryJinaReader(serial, originalUrl, seedTitle, seedSource, seedImage,
                          fallbackArticle, attempts, index + 1);
            return;
        }

        QVariantMap article = parseJinaMarkdown(markdown, jinaUrl, originalUrl,
                                                fallbackArticle.value(QStringLiteral("image")).toString());
        const QVariantList jinaParagraphs = article.value(QStringLiteral("paragraphs")).toList();
        const int jinaChars = paragraphTextLength(jinaParagraphs);
        attempts.append(QVariantMap{
            {QStringLiteral("source"), QStringLiteral("reader proxy")},
            {QStringLiteral("status"), QStringLiteral("parsed")},
            {QStringLiteral("url"), jinaUrl},
            {QStringLiteral("bytes"), markdown.size()},
            {QStringLiteral("paragraphs"), jinaParagraphs.size()},
            {QStringLiteral("chars"), jinaChars},
        });

        if (jinaParagraphs.isEmpty() || jinaChars < 240) {
            tryJinaReader(serial, originalUrl, seedTitle, seedSource, seedImage,
                          fallbackArticle, attempts, index + 1);
            return;
        }

        m_busy = false;
        emit busyChanged();
        if (article.value(QStringLiteral("title")).toString().isEmpty())
            article.insert(QStringLiteral("title"), seedTitle);
        if (article.value(QStringLiteral("source")).toString().isEmpty())
            article.insert(QStringLiteral("source"),
                           seedSource.isEmpty() ? QUrl(originalUrl).host() : seedSource);
        if (article.value(QStringLiteral("image")).toString().isEmpty())
            article.insert(QStringLiteral("image"), seedImage);
        if (article.value(QStringLiteral("images")).toList().isEmpty() && !seedImage.isEmpty())
            article.insert(QStringLiteral("images"), QVariantList{seedImage});
        article.insert(QStringLiteral("url"), originalUrl);
        article.insert(QStringLiteral("sourceLabel"), QStringLiteral("jina"));
        article.insert(QStringLiteral("attempts"), attempts);
        m_article = article;
        emit articleChanged();
        qInfo() << "[reader] jina" << originalUrl << "->" << jinaParagraphs.size()
                << "paragraphs";
    }, QStringLiteral("text/markdown,text/plain,*/*;q=0.8"));
}

void ReaderService::tryPublisherFeedFallback(quint64 serial, const QString& originalUrl,
                                             const QString& seedTitle,
                                             const QString& seedSource,
                                             const QString& seedImage,
                                             QVariantMap fallbackArticle,
                                             QVariantList attempts, int feedIndex)
{
    if (serial != m_requestSerial)
        return;
    const QStringList feeds = publisherFeedUrls(originalUrl);
    if (feedIndex >= feeds.size()) {
        tryJinaReader(serial, originalUrl, seedTitle, seedSource, seedImage,
                      fallbackArticle, attempts, 0);
        return;
    }

    const QString feedUrl = feeds.at(feedIndex);
    const QString source = publisherSource(originalUrl);
    m_http->getText(QUrl(feedUrl), this,
                    [this, serial, originalUrl, seedTitle, seedSource, seedImage,
                     fallbackArticle, attempts, feedIndex, feedUrl, source](
                        const QString& xml, const QString& error) mutable {
        if (serial != m_requestSerial)
            return;
        if (!error.isEmpty()) {
            attempts.append(QVariantMap{
                {QStringLiteral("source"), QStringLiteral("publisher feed")},
                {QStringLiteral("status"), QStringLiteral("failed")},
                {QStringLiteral("url"), feedUrl},
                {QStringLiteral("error"), error},
            });
            tryPublisherFeedFallback(serial, originalUrl, seedTitle, seedSource, seedImage,
                                     fallbackArticle, attempts, feedIndex + 1);
            return;
        }

        QVariantMap article = parsePublisherFeedArticle(xml, originalUrl, source);
        attempts.append(QVariantMap{
            {QStringLiteral("source"), QStringLiteral("publisher feed")},
            {QStringLiteral("status"), article.isEmpty() ? QStringLiteral("miss")
                                                         : QStringLiteral("used")},
            {QStringLiteral("url"), feedUrl},
            {QStringLiteral("bytes"), xml.size()},
            {QStringLiteral("paragraphs"),
             article.value(QStringLiteral("paragraphs")).toList().size()},
        });
        if (article.isEmpty()) {
            tryPublisherFeedFallback(serial, originalUrl, seedTitle, seedSource, seedImage,
                                     fallbackArticle, attempts, feedIndex + 1);
            return;
        }

        m_busy = false;
        emit busyChanged();
        if (article.value(QStringLiteral("title")).toString().isEmpty())
            article.insert(QStringLiteral("title"), seedTitle);
        if (article.value(QStringLiteral("source")).toString().isEmpty())
            article.insert(QStringLiteral("source"),
                           seedSource.isEmpty() ? source : seedSource);
        if (article.value(QStringLiteral("image")).toString().isEmpty())
            article.insert(QStringLiteral("image"), seedImage);
        if (article.value(QStringLiteral("images")).toList().isEmpty() && !seedImage.isEmpty())
            article.insert(QStringLiteral("images"), QVariantList{seedImage});
        article.insert(QStringLiteral("attempts"), attempts);
        m_article = article;
        emit articleChanged();
        qInfo() << "[reader] publisher feed" << originalUrl << "->"
                << article.value(QStringLiteral("paragraphs")).toList().size()
                << "paragraphs";
    }, QStringLiteral("application/rss+xml,application/xml,text/xml,*/*;q=0.8"));
}

QVariantMap ReaderService::extractArticleHtml(const QString& html, const QString& url)
{
    QString title = metaContent(html, QStringLiteral("property"), QStringLiteral("og:title"));
    if (title.isEmpty())
        title = metaContent(html, QStringLiteral("name"), QStringLiteral("twitter:title"));
    if (title.isEmpty()) {
        static const QRegularExpression h1Tag(
            QStringLiteral("<h1[^>]*>([\\s\\S]*?)</h1>"),
            QRegularExpression::CaseInsensitiveOption);
        title = stripTags(h1Tag.match(html).captured(1));
    }
    if (title.isEmpty()) {
        static const QRegularExpression titleTag(
            QStringLiteral("<title[^>]*>([\\s\\S]*?)</title>"),
            QRegularExpression::CaseInsensitiveOption);
        title = stripTags(titleTag.match(html).captured(1));
    }

    QString description = metaContent(html, QStringLiteral("property"), QStringLiteral("og:description"));
    if (description.isEmpty())
        description = metaContent(html, QStringLiteral("name"), QStringLiteral("description"));
    QString date = metaContent(html, QStringLiteral("property"), QStringLiteral("article:published_time"));
    if (date.isEmpty())
        date = metaContent(html, QStringLiteral("name"), QStringLiteral("date"));

    QString image = metaContent(html, QStringLiteral("property"), QStringLiteral("og:image"));
    if (image.isEmpty())
        image = metaContent(html, QStringLiteral("name"), QStringLiteral("twitter:image"));
    image = absolutizeUrl(image, url);

    QString byline = metaContent(html, QStringLiteral("name"), QStringLiteral("author"));
    if (byline.isEmpty())
        byline = metaContent(html, QStringLiteral("property"), QStringLiteral("article:author"));
    if (byline.startsWith(QLatin1String("http")))
        byline.clear();

    const QString readable = chooseReadableHtml(html);

    QVariantList paragraphs = extractParagraphBlocks(readable);
    bool fallbackUsed = false;
    if (paragraphTextLength(paragraphs) < 450) {
        const QVariantList fallbackParagraphs = extractTextParagraphs(html, title);
        if (paragraphTextLength(fallbackParagraphs) > paragraphTextLength(paragraphs)) {
            paragraphs = fallbackParagraphs;
            fallbackUsed = true;
        }
    }

    QVariantList images = extractImages(readable, url, image);
    if (image.isEmpty() && !images.isEmpty())
        image = images.first().toString();

    const QString source = QUrl(url).host().remove(QRegularExpression(QStringLiteral("^www\\.")));
    const bool paywall = detectPaywall(html);
    const QString challenge = detectBotChallenge(html);
    QStringList excerptParts;
    for (qsizetype i = 0; i < qMin<qsizetype>(2, paragraphs.size()); ++i)
        excerptParts.append(paragraphs.at(i).toString());

    return {
        {QStringLiteral("title"), TextFix::repairMojibake(title)},
        {QStringLiteral("byline"), TextFix::repairMojibake(byline)},
        {QStringLiteral("source"), source},
        {QStringLiteral("description"), TextFix::repairMojibake(description)},
        {QStringLiteral("date"), date},
        {QStringLiteral("image"), image},
        {QStringLiteral("images"), images},
        {QStringLiteral("paragraphs"), paragraphs},
        {QStringLiteral("excerpt"), excerptParts.join(QLatin1Char(' '))},
        {QStringLiteral("fallbackUsed"), fallbackUsed},
        {QStringLiteral("paywall"), paywall},
        {QStringLiteral("challenge"), challenge},
    };
}

} // namespace qtpanel
