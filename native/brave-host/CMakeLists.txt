cmake_minimum_required(VERSION 3.16)
project(brave-host LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(OUT_DIR "${CMAKE_SOURCE_DIR}/../bin")

add_executable(brave-host WIN32 brave-host.cpp)
target_link_libraries(brave-host PRIVATE user32 shell32 ws2_32 psapi)
set_target_properties(brave-host PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY         "${OUT_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${OUT_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG   "${OUT_DIR}"
)
if(MSVC)
    set_property(TARGET brave-host PROPERTY
        MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    target_compile_options(brave-host PRIVATE /W3 /WX-)
endif()
