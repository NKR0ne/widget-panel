// Quick3D CustomMaterial vertex snippet (runtime-compiled, NOT qsb).
// Displaces the sphere along its normals with cheap value noise; uAmp and
// uSpeed carry the avatar state (breathing at rest, boiling while reasoning).

float sv_hash(vec3 p)
{
    p = fract(p * 0.3183099 + vec3(0.1, 0.17, 0.13));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float sv_noise(vec3 p)
{
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = sv_hash(i + vec3(0.0, 0.0, 0.0));
    float n100 = sv_hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = sv_hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = sv_hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = sv_hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = sv_hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = sv_hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = sv_hash(i + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

void MAIN()
{
    // NOTE: "sample" is a reserved word in GLSL — do not name a local that.
    vec3 sp = VERTEX * uFreq + vec3(uTime * uSpeed, uTime * uSpeed * 0.7, 0.0);
    float n = sv_noise(sp) - 0.5;
    VERTEX += NORMAL * n * uAmp;
}
