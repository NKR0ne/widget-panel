find_package(Qt6 6.8 REQUIRED COMPONENTS Test Network Xml Gui)

qt_add_executable(qt-panel-tests
    test_qtpanel.cpp
    ${CMAKE_SOURCE_DIR}/src/core/TextFix.cpp
    ${CMAKE_SOURCE_DIR}/src/core/SettingsStore.cpp
    ${CMAKE_SOURCE_DIR}/src/core/SecretVault.cpp
    ${CMAKE_SOURCE_DIR}/src/core/HttpClient.cpp
    ${CMAKE_SOURCE_DIR}/src/shell/FocusPolicy.cpp
    ${CMAKE_SOURCE_DIR}/src/shell/SystemTheme.cpp
    ${CMAKE_SOURCE_DIR}/src/services/news/NewsService.cpp
    ${CMAKE_SOURCE_DIR}/src/services/reader/ReaderService.cpp
    ${CMAKE_SOURCE_DIR}/src/services/live/LiveFeedService.cpp
    ${CMAKE_SOURCE_DIR}/src/services/pressreader/PressReaderService.cpp
    ${CMAKE_SOURCE_DIR}/src/services/workstation/WorkstationClient.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/backends/BackendInterfaces.h
    ${CMAKE_SOURCE_DIR}/src/services/starvis/backends/BackendOperation.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/backends/OpenAiCompatibleLLMBackend.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/backends/OpenAiCompatibleSTTBackend.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/backends/OpenAiCompatibleTTSBackend.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/backends/StreamingTextSegmenter.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/MotionDetector.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/ModelResolver.cpp
)

target_include_directories(qt-panel-tests PRIVATE ${CMAKE_SOURCE_DIR}/src)
target_compile_options(qt-panel-tests PRIVATE /utf-8)
target_link_libraries(qt-panel-tests PRIVATE
    Qt6::Test
    Qt6::Network
    Qt6::Xml
    Qt6::Gui
    advapi32
)

add_test(NAME qt-panel-tests COMMAND qt-panel-tests)
set_tests_properties(qt-panel-tests PROPERTIES
    ENVIRONMENT_MODIFICATION
        "PATH=path_list_prepend:$<TARGET_FILE_DIR:Qt6::Network>"
)
