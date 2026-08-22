// Quick3D CustomMaterial fragment snippet (runtime-compiled, NOT qsb).
// Fresnel-weighted emissive rim over a dark core; uColor/uGlow carry state.

void MAIN()
{
    vec3 v = normalize(VIEW_VECTOR);
    vec3 n = normalize(NORMAL);
    float fres = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.2);
    BASE_COLOR = vec4(uColor.rgb * 0.16, 1.0);
    EMISSIVE_COLOR = uColor.rgb * (uGlow * 0.55 + fres * 1.7 * uGlow);
    ROUGHNESS = 0.38;
    METALNESS = 0.0;
}
