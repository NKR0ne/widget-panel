#pragma once
#include <QObject>
#include <QThread>
#include <QTimer>
#include <QUrl>
#include <QVariantMap>

namespace qtpanel {
class SettingsStore;
class WindowsMediaWorker;
class WindowsMediaService : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantMap playback READ playback NOTIFY playbackChanged)
    Q_PROPERTY(QVariantList library READ library NOTIFY libraryChanged)
    Q_PROPERTY(QVariantList albums READ albums NOTIFY libraryChanged)
    Q_PROPERTY(QVariantList playlists READ playlists NOTIFY libraryChanged)
    Q_PROPERTY(QVariantList queue READ queue NOTIFY playbackChanged)
    Q_PROPERTY(QStringList folders READ folders NOTIFY foldersChanged)
    Q_PROPERTY(bool scanning READ scanning NOTIFY libraryChanged)
    Q_PROPERTY(QString libraryStatus READ libraryStatus NOTIFY libraryChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY playbackChanged)
    Q_PROPERTY(QString error READ error NOTIFY playbackChanged)
public:
    explicit WindowsMediaService(SettingsStore* settings, QObject* parent = nullptr);
    ~WindowsMediaService() override;
    QVariantMap playback() const { return m_playback; }
    QVariantList library() const { return m_library; }
    QVariantList albums() const { return m_albums; }
    QVariantList playlists() const { return m_playlists; }
    QVariantList queue() const { return m_queue; }
    QStringList folders() const { return m_folders; }
    bool scanning() const { return m_scanning; }
    QString libraryStatus() const { return m_libraryStatus; }
    bool busy() const { return m_busy; }
    QString error() const { return m_error; }
    Q_INVOKABLE void refresh();
    Q_INVOKABLE void command(const QString& action, double value = 0);
    Q_INVOKABLE void playFile(const QUrl& file);
    Q_INVOKABLE void playItems(const QVariantList& items, int index = 0);
    Q_INVOKABLE void playAlbum(const QString& id);
    Q_INVOKABLE void playPlaylist(const QString& id);
    Q_INVOKABLE void importPlaylist(const QUrl& file);
    void setDucked(bool ducked);
    Q_INVOKABLE void scanLibrary();
    Q_INVOKABLE void addFolder(const QUrl& folder);
    Q_INVOKABLE void removeFolder(const QString& folder);
signals:
    void playbackChanged();
    void libraryChanged();
    void foldersChanged();
private:
    SettingsStore* m_settings;
    QThread m_thread, m_scanThread;
    WindowsMediaWorker* m_worker;
    QObject* m_scanner;
    QTimer m_poll;
    QVariantMap m_playback;
    QVariantList m_library, m_albums, m_playlists, m_queue;
    QStringList m_folders;
    QString m_error, m_libraryStatus;
    bool m_busy = false, m_pending = false, m_scanning = false, m_rescan = false;
    void saveFolders();
    void dispatch(const QString& action, double value, const QVariantList& items = {});
};
}
