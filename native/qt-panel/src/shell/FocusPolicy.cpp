#include "FocusPolicy.h"

#include <QDateTime>

namespace qtpanel {

static qint64 nowMs()
{
    return QDateTime::currentMSecsSinceEpoch();
}

void FocusPolicy::noteToggle()
{
    m_lastToggle = nowMs();
}

void FocusPolicy::noteBrowserOpened()
{
    m_lastBrowserOpen = nowMs();
}

void FocusPolicy::noteModalOpened()
{
    m_modalOpen = true;
}

void FocusPolicy::noteModalClosed()
{
    m_modalOpen = false;
    m_lastModalClose = nowMs();
}

void FocusPolicy::resetModal()
{
    m_modalOpen = false;
}

bool FocusPolicy::blurMayHide() const
{
    const qint64 now = nowMs();
    if (now - m_lastToggle < kToggleDebounceMs)
        return false;
    if (now - m_lastBrowserOpen < kBrowserDebounceMs)
        return false;
    return true;
}

bool FocusPolicy::delayedCheckAllowsHide() const
{
    if (m_modalOpen)
        return false;
    if (nowMs() - m_lastModalClose < kModalCloseGraceMs)
        return false;
    return true;
}

} // namespace qtpanel
