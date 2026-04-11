cmake_minimum_required(VERSION 3.16)
project(taskbar-btn LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(OUT_DIR "${CMAKE_SOURCE_DIR}/../bin")

# ── taskbar-hook.dll  (injected into Explorer) ────────────────────────────────
add_library(taskbar-hook SHARED hook.cpp)
target_link_libraries(taskbar-hook PRIVATE user32 gdi32 shell32 dwmapi ws2_32)
set_target_properties(taskbar-hook PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY         "${OUT_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${OUT_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG   "${OUT_DIR}"
    PREFIX ""
)
if(MSVC)
    set_property(TARGET taskbar-hook PROPERTY
        MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    target_compile_options(taskbar-hook PRIVATE /W3 /WX-)
endif()

# ── taskbar-btn.exe  (injector + watchdog) ────────────────────────────────────
add_executable(taskbar-btn WIN32 main.cpp)
target_link_libraries(taskbar-btn PRIVATE user32)
set_target_properties(taskbar-btn PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY         "${OUT_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${OUT_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG   "${OUT_DIR}"
)
if(MSVC)
    set_property(TARGET taskbar-btn PROPERTY
        MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    target_compile_options(taskbar-btn PRIVATE /W3 /WX-)
endif()
