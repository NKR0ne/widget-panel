cmake_minimum_required(VERSION 3.27)
project(qtpanel VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 6.8 REQUIRED COMPONENTS Quick QuickControls2 QuickEffects Quick3D Network Xml Multimedia ShaderTools WebEngineQuick)
qt_standard_project_setup(REQUIRES 6.8)

add_subdirectory(qml)

option(QTPANEL_BUILD_TESTS "Build the QtTest suite" OFF)
if(QTPANEL_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests EXCLUDE_FROM_ALL)
endif()

qt_add_executable(qt-panel WIN32
    src/main.cpp
    src/core/HttpClient.h src/core/HttpClient.cpp
    src/core/Log.h src/core/Log.cpp
    src/core/QmlNetwork.h src/core/QmlNetwork.cpp
    src/core/SecretVault.h src/core/SecretVault.cpp
    src/core/SettingsStore.h src/core/SettingsStore.cpp
    src/core/SoundFx.h src/core/SoundFx.cpp
    src/core/TextFix.h src/core/TextFix.cpp
    src/services/camera/CameraClient.h src/services/camera/CameraClient.cpp
    src/services/camera/XpCrypto.h src/services/camera/XpCrypto.cpp
    src/services/diagnostics/DiagnosticsService.h src/services/diagnostics/DiagnosticsService.cpp
    src/services/live/LiveFeedService.h src/services/live/LiveFeedService.cpp
    src/services/msgraph/MsGraphService.h src/services/msgraph/MsGraphService.cpp
    src/services/news/NewsService.h src/services/news/NewsService.cpp
    src/services/reader/ReaderService.h src/services/reader/ReaderService.cpp
    src/services/starvis/StarvisService.h src/services/starvis/StarvisService.cpp
    src/services/stocks/StocksModel.h src/services/stocks/StocksModel.cpp
    src/services/weather/WeatherService.h src/services/weather/WeatherService.cpp
    src/services/workstation/WorkstationClient.h src/services/workstation/WorkstationClient.cpp
    src/shell/FocusPolicy.h src/shell/FocusPolicy.cpp
    src/shell/HelperServer.h src/shell/HelperServer.cpp
    src/shell/PanelWindowController.h src/shell/PanelWindowController.cpp
    src/shell/SystemTheme.h src/shell/SystemTheme.cpp
    src/shell/WinShellIntegration.h src/shell/WinShellIntegration.cpp
    src/shell/WorkAreaWatcher.h src/shell/WorkAreaWatcher.cpp
)

target_include_directories(qt-panel PRIVATE src)
target_compile_options(qt-panel PRIVATE /utf-8 /W4)
target_link_libraries(qt-panel PRIVATE
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::QuickEffects
    Qt6::Quick3D
    Qt6::Network
    Qt6::Xml
    Qt6::Multimedia
    Qt6::WebEngineQuick
    qtpanel_uiplugin
    dwmapi
    user32
    bcrypt
    advapi32
)
