cmake_minimum_required(VERSION 3.16)
project(taskbar-btn LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Win32 subsystem (no console window)
add_executable(taskbar-btn WIN32
    main.cpp
)

target_link_libraries(taskbar-btn PRIVATE
    dwmapi
    shell32
    gdi32
    user32
    comctl32
)

# Output straight into native/bin/ so main.js can find it with a fixed path
set_target_properties(taskbar-btn PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../bin"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_SOURCE_DIR}/../bin"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG   "${CMAKE_SOURCE_DIR}/../bin"
)

# MSVC: static CRT so the exe runs without VC redistributable
if(MSVC)
    set_property(TARGET taskbar-btn PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    target_compile_options(taskbar-btn PRIVATE /W3 /WX-)
endif()
