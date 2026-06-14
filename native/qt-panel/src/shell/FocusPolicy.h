#pragma once

#include <QtGlobal>

namespace qtpanel {

// Port of the Electron blur-to-hide heuristics (main.js blur / clickoutside
// handlers): debounce right after a toggle or browser-open, and never hide
// while a modal is open or just closed.
class FocusPolicy {
public:
    static constexpr int kRecheckDelayMs = 150;

    void noteToggle();
    void noteBrowserOpened();
    void noteModalOpened();
    void noteModalClosed();
    void resetModal();

    bool modalOpen() const { return m_modalOpen; }

    // First gate, evaluated immediately on focus loss.
    bool blurMayHide() const;
    // Second gate, evaluated after kRecheckDelayMs.
    bool delayedCheckAllowsHide() const;

private:
    static constexpr int kToggleDebounceMs = 200;
    static constexpr int kBrowserDebounceMs = 500;
    static constexpr int kModalCloseGraceMs = 400;

    qint64 m_lastToggle = 0;
    qint64 m_lastBrowserOpen = 0;
    qint64 m_lastModalClose = 0;
    bool m_modalOpen = false;
};

} // namespace qtpanel
