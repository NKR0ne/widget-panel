#include "StreamingTextSegmenter.h"

#include <QtGlobal>

namespace qtpanel {

StreamingTextSegmenter::StreamingTextSegmenter(int minimumChars, int maximumChars)
    : m_minimumChars(qMax(1, minimumChars))
    , m_maximumChars(qMax(m_minimumChars, maximumChars))
{
}

int StreamingTextSegmenter::nextBoundary() const
{
    if (m_buffer.size() < m_minimumChars)
        return -1;

    for (int i = m_minimumChars - 1; i < m_buffer.size(); ++i) {
        const QChar ch = m_buffer.at(i);
        const bool sentenceEnd = ch == QLatin1Char('.') || ch == QLatin1Char('!')
            || ch == QLatin1Char('?') || ch == QLatin1Char('\n');
        if (sentenceEnd && (i + 1 == m_buffer.size() || m_buffer.at(i + 1).isSpace()))
            return i + 1;
    }

    if (m_buffer.size() < m_maximumChars)
        return -1;
    const int whitespace = m_buffer.lastIndexOf(QLatin1Char(' '), m_maximumChars);
    return whitespace >= m_minimumChars ? whitespace : m_maximumChars;
}

QStringList StreamingTextSegmenter::push(const QString& delta)
{
    if (!delta.isEmpty())
        m_buffer += delta;

    QStringList ready;
    int boundary = nextBoundary();
    while (boundary > 0) {
        const QString chunk = m_buffer.left(boundary).trimmed();
        m_buffer.remove(0, boundary);
        while (!m_buffer.isEmpty() && m_buffer.front().isSpace())
            m_buffer.remove(0, 1);
        if (!chunk.isEmpty())
            ready.append(chunk);
        boundary = nextBoundary();
    }
    return ready;
}

QString StreamingTextSegmenter::flush()
{
    const QString remaining = m_buffer.trimmed();
    m_buffer.clear();
    return remaining;
}

void StreamingTextSegmenter::clear()
{
    m_buffer.clear();
}

} // namespace qtpanel
