#include "TextFix.h"

#include <QHash>
#include <QRegularExpression>

namespace qtpanel {

namespace {

// windows-1252 0x80–0x9F specials → Unicode.
const char16_t kCp1252High[32] = {
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
};

// Reverse of the table above: Unicode char → cp1252 byte (for re-encoding a
// wrongly decoded string back to its original bytes).
int cp1252ByteForChar(QChar c)
{
    const ushort code = c.unicode();
    if (code <= 0xFF)
        return code;
    for (int i = 0; i < 32; ++i) {
        if (kCp1252High[i] == code)
            return 0x80 + i;
    }
    return -1;
}

} // namespace

int TextFix::artifactScore(const QString& text)
{
    int artifacts = 0;
    int replacements = 0;
    int controls = 0;
    for (int i = 0; i < text.size(); ++i) {
        const ushort c = text.at(i).unicode();
        if (c == 0x00C2 || c == 0x00C3 || c == 0x00E2)
            ++artifacts;
        else if (c == 0xFFFD)
            ++replacements;
        else if ((c <= 0x08) || c == 0x0B || c == 0x0C || (c >= 0x0E && c <= 0x1F)
                 || (c >= 0x7F && c <= 0x9F))
            ++controls;
        else if (cp1252ByteForChar(text.at(i)) >= 0x80 && c > 0xFF)
            ++artifacts; // €‚ƒ„…†‡ˆ‰Š‹ŒŽ''""•–—˜™š›œžŸ
    }
    return artifacts * 10 + replacements * 25 + controls * 25;
}

QString TextFix::repairMojibake(const QString& text)
{
    QString current = text;
    int score = artifactScore(current);
    if (score == 0)
        return current;

    for (int round = 0; round < 4; ++round) {
        QByteArray bytes;
        bytes.reserve(current.size());
        bool mappable = true;
        for (const QChar c : current) {
            const int byte = cp1252ByteForChar(c);
            if (byte < 0) {
                mappable = false;
                break;
            }
            bytes.append(static_cast<char>(byte));
        }
        if (!mappable)
            break;
        const QString repaired = QString::fromUtf8(bytes);
        const int nextScore = artifactScore(repaired);
        if (nextScore >= score)
            break;
        current = repaired;
        score = nextScore;
        if (score == 0)
            break;
    }
    return current;
}

QString TextFix::decodeCp1252(const QByteArray& bytes)
{
    QString out;
    out.reserve(bytes.size());
    for (const char rawByte : bytes) {
        const uchar b = static_cast<uchar>(rawByte);
        if (b >= 0x80 && b <= 0x9F)
            out.append(QChar(kCp1252High[b - 0x80]));
        else
            out.append(QChar(static_cast<ushort>(b)));
    }
    return out;
}

QString TextFix::decodeHttpText(const QByteArray& body, const QString& contentTypeHeader)
{
    static const QRegularExpression headerCharset(
        QStringLiteral("charset\\s*=\\s*[\"']?([^;\"']+)"), QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression xmlCharset(
        QStringLiteral("<\\?xml[^>]*encoding\\s*=\\s*[\"']([^\"']+)"), QRegularExpression::CaseInsensitiveOption);

    auto normalize = [](QString value) {
        value = value.trimmed().toLower().replace(QLatin1Char('_'), QLatin1Char('-'));
        if (value == QLatin1String("utf8") || value == QLatin1String("unicode-1-1-utf-8"))
            return QStringLiteral("utf-8");
        if (value == QLatin1String("latin1") || value == QLatin1String("latin-1")
            || value.startsWith(QLatin1String("iso-8859-1")) || value.contains(QLatin1String("1252")))
            return QStringLiteral("windows-1252");
        return value;
    };

    QString fromHeader;
    if (const auto m = headerCharset.match(contentTypeHeader); m.hasMatch())
        fromHeader = normalize(m.captured(1));
    QString fromXml;
    if (const auto m = xmlCharset.match(QString::fromLatin1(body.left(1024))); m.hasMatch())
        fromXml = normalize(m.captured(1));

    const QString encoding = !fromHeader.isEmpty() ? fromHeader
                           : !fromXml.isEmpty() ? fromXml
                           : QStringLiteral("utf-8");

    QString decoded = encoding == QLatin1String("windows-1252")
        ? decodeCp1252(body)
        : QString::fromUtf8(body); // unknown charsets fall back to UTF-8 too

    if (fromHeader.isEmpty() && encoding == QLatin1String("utf-8")) {
        const QString fallback = decodeCp1252(body);
        if (artifactScore(fallback) < artifactScore(decoded))
            return fallback;
    }
    return decoded;
}

} // namespace qtpanel
