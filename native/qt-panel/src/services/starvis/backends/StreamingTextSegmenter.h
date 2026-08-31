#pragma once

#include <QString>
#include <QStringList>

namespace qtpanel {

// Converts token deltas into phrase-sized TTS work units. It favors complete
// sentences, but bounds latency for long unpunctuated model output.
class StreamingTextSegmenter {
public:
    explicit StreamingTextSegmenter(int minimumChars = 32, int maximumChars = 220);

    QStringList push(const QString& delta);
    QString flush();
    void clear();
    QString pending() const { return m_buffer; }

private:
    int nextBoundary() const;

    QString m_buffer;
    int m_minimumChars = 32;
    int m_maximumChars = 220;
};

} // namespace qtpanel
