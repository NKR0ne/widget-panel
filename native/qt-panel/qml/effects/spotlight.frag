#version 440

// A faint cursor-tracked specular pool layered over the cards — like a soft
// light gliding across glass. Additive and very subtle so text stays readable.
// Compiled to .qsb; runs on the Vulkan RHI.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float aspect;
    float cursorX;
    float cursorY;
    float cursorOn;
    float lightingStrength;
    vec4 accentColor;
};

void main() {
    vec2 uv = qt_TexCoord0;
    vec2 ar = vec2(aspect, 1.0);
    float dist = length((uv - vec2(cursorX, cursorY)) * ar);
    // Tight bright core + soft falloff.
    float pool = (0.055 * exp(-6.0 * dist) + 0.025 * exp(-2.0 * dist))
               * lightingStrength;
    vec3 col = mix(vec3(0.86, 0.89, 0.96), accentColor.rgb, 0.58);
    fragColor = vec4(col * pool, pool) * qt_Opacity * cursorOn;
}
