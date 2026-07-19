#version 440

// Animated, cursor-reactive panel background: a depth gradient, a slow diagonal
// accent sheen, an accent glow that pools toward the pointer, and dither grain
// to kill banding on the acrylic. Compiled to .qsb by qt_add_shaders; runs on
// the Vulkan RHI (and HLSL/GLSL fallbacks).

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;
    float aspect;
    float cursorX;
    float cursorY;
    float cursorOn;
    float lightingStrength;
    vec4 accentColor;
};

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = qt_TexCoord0;

    // Aspect-correct coordinates so the radial glow stays circular.
    vec2 ar = vec2(aspect, 1.0);

    // Depth: brightest at the top edge, fading down.
    float depth = mix(0.10, 0.012, smoothstep(0.0, 1.0, uv.y));

    // Slow diagonal sheen sweeping the surface.
    float d = (uv.x * aspect + uv.y);
    float sheen = 0.022 * (0.5 + 0.5 * sin(d * 1.6 - time * 0.35));

    // Accent glow that follows the cursor (falls back to top-left at rest).
    vec2 rest = vec2(0.12, 0.06);
    vec2 focus = mix(rest, vec2(cursorX, cursorY), cursorOn);
    float dist = length((uv - focus) * ar);
    float glow = (0.05 + 0.07 * cursorOn) * exp(-3.0 * dist);

    // Static dither removes banding without producing visible temporal noise.
    float grain = (hash(uv * vec2(900.0, 640.0)) - 0.5) * 0.012;

    vec3 accent = mix(vec3(0.84, 0.88, 0.96), accentColor.rgb, 0.72);
    float energy = (depth + sheen + glow) * lightingStrength;
    vec3 col = accent * energy + vec3(grain);
    float a = clamp(energy + grain, 0.0, 0.55);

    fragColor = vec4(col, a) * qt_Opacity;
}
