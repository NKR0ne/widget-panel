#pragma once

#include <QByteArray>
#include <QString>

namespace qtpanel {

// Ports of the Electron text-encoding heuristics (main.js decodeHttpText and
// news.service.js repairDecodedText): charset sniffing for HTTP bodies and
// iterative mojibake repair for strings that went through a wrong decode.
class TextFix {
public:
    // Weighted count of mojibake tell-tales (Â/Ã/â sequences, U+FFFD,
    // stray C1 controls and cp1252 specials).
    static int artifactScore(const QString& text);

    // Re-decodes "QuÃ©bec"-style double-encoded strings, up to 4 rounds,
    // keeping each round only when it strictly reduces the artifact score.
    static QString repairMojibake(const QString& text);

    // Decode an HTTP body: header charset → XML declaration → UTF-8, with a
    // windows-1252 fallback when UTF-8 produces more artifacts.
    static QString decodeHttpText(const QByteArray& body, const QString& contentTypeHeader);

    static QString decodeCp1252(const QByteArray& bytes);
};

} // namespace qtpanel
