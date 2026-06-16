find_package(Qt6 6.8 REQUIRED COMPONENTS Test Network Xml)

qt_add_executable(qt-panel-tests
    test_qtpanel.cpp
    ${CMAKE_SOURCE_DIR}/src/core/TextFix.cpp
    ${CMAKE_SOURCE_DIR}/src/core/SettingsStore.cpp
    ${CMAKE_SOURCE_DIR}/src/core/HttpClient.cpp
    ${CMAKE_SOURCE_DIR}/src/shell/FocusPolicy.cpp
    ${CMAKE_SOURCE_DIR}/src/services/news/NewsService.cpp
    ${CMAKE_SOURCE_DIR}/src/services/reader/ReaderService.cpp
)

target_include_directories(qt-panel-tests PRIVATE ${CMAKE_SOURCE_DIR}/src)
target_compile_options(qt-panel-tests PRIVATE /utf-8)
target_link_libraries(qt-panel-tests PRIVATE
    Qt6::Test
    Qt6::Network
    Qt6::Xml
)

add_test(NAME qt-panel-tests COMMAND qt-panel-tests)
