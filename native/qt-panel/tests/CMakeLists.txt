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
    ${CMAKE_SOURCE_DIR}/src/services/starvis/backends/OpenAiCompatibleVisionBackend.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/backends/OpenAiCompatibleSTTBackend.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/backends/OpenAiCompatibleTTSBackend.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/backends/StreamingTextSegmenter.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/MotionDetector.cpp
    ${CMAKE_SOURCE_DIR}/src/services/starvis/ModelResolver.cpp
)

target_include_directories(qt-panel-tests PRIVATE ${CMAKE_SOURCE_DIR}/src)
set_property(SOURCE test_qtpanel.cpp
    "${CMAKE_SOURCE_DIR}/src/services/starvis/backends/OpenAiCompatibleVisionBackend.cpp"
    APPEND PROPERTY OBJECT_DEPENDS "${CMAKE_SOURCE_DIR}/src/services/starvis/backends/BackendInterfaces.h")
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

# Exercise the actual reading QML with deterministic service and surface doubles.
# Staging avoids starting network/camera/model services in a UI regression test.
find_program(QML_TEST_RUNNER qmltestrunner HINTS "${Qt6_DIR}/../../../bin" REQUIRED)
set(NEWS_QML_TEST_DIR "${CMAKE_CURRENT_BINARY_DIR}/news-qml")
file(GLOB_RECURSE NEWS_QML_MOCKS CONFIGURE_DEPENDS
    RELATIVE "${CMAKE_CURRENT_SOURCE_DIR}/qml/mocks" "qml/mocks/*")
foreach(mock_file IN LISTS NEWS_QML_MOCKS)
    configure_file("qml/mocks/${mock_file}" "${NEWS_QML_TEST_DIR}/${mock_file}" COPYONLY)
endforeach()
foreach(qml_file NewsStage.qml ArticleReaderPane.qml)
    configure_file("${CMAKE_SOURCE_DIR}/qml/${qml_file}"
                   "${NEWS_QML_TEST_DIR}/${qml_file}" COPYONLY)
endforeach()
configure_file(qml/tst_NewsReading.qml "${NEWS_QML_TEST_DIR}/tst_NewsReading.qml" COPYONLY)
add_test(NAME news-reading-qml COMMAND powershell -NoProfile -ExecutionPolicy Bypass
    -File "${CMAKE_CURRENT_SOURCE_DIR}/run-news-qml-tests.ps1"
    -Runner "${QML_TEST_RUNNER}" -InputDir "${NEWS_QML_TEST_DIR}")
set_tests_properties(news-reading-qml PROPERTIES TIMEOUT 35)
add_test(NAME starvis-runtime-scripts COMMAND powershell -NoProfile -ExecutionPolicy Bypass
    -File "${CMAKE_CURRENT_SOURCE_DIR}/test_starvis_runtime.ps1")
set_tests_properties(starvis-runtime-scripts PROPERTIES TIMEOUT 15)
