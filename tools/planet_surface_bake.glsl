// The planets' former live surface, kept only to bake their maps (tools/bake_planets.cjs).
// Each pixel of an equirectangular map is a point on the sphere; the procedural world and the
// source pack are combined exactly as the page used to do it every frame, and written out.
precision highp float;
precision highp int;
out vec4 fragOut;
uniform int uMode;
uniform vec2 uSize;
vec3 gAlbedo; vec3 gEmit; vec3 gNormal; float gGloss; float gRough;

uniform vec3 uDark;
uniform vec3 uBase;
uniform vec3 uLight;
uniform float uType;
uniform float uSeed;
uniform float uHover;
uniform float uDim;
uniform float uOctaves;
uniform vec3 uSun;
uniform vec3 uKey;
uniform vec4 uMoon;
uniform vec3 uSecond;
uniform vec3 uAir;
uniform vec3 uNodes[10];
uniform vec3 uPole;
uniform float uTime;
// The project's own texture set (equirectangular): colour, normal, height, roughness, light.
uniform float uMaps;
uniform sampler2D uAlbedoMap;  // colour, sRGB (decoded to linear by the GPU)
uniform sampler2D uNormalMap;  // tangent-space normal, data
uniform sampler2D uDataMap;    // R height, G roughness, B emissive mask, data
uniform vec4 uSurface;  // relief, fine, emit, -
uniform vec4 uSurface2; // saturation, polish, displace, albedo share







// Map coordinates, worked out per pixel from the point on the sphere. The mesh's own UVs are
// interpolated across the triangles that meet at the poles, which shows as wedges there.
// Derivatives come from whichever of two longitude cuts is smooth here, so the 180th meridian
// gets no seam line.
vec2 suv;
vec2 sdx;
vec2 sdy;
void mapCoords(vec3 p) {
  float u = atan(p.z, -p.x) / 6.2832;
  suv = vec2(fract(u), 1.0 - acos(clamp(p.y, -1.0, 1.0)) / 3.1416);
  float u2 = fract(u + 0.5);
  bool wrap = fwidth(suv.x) > fwidth(u2);
  sdx = vec2(wrap ? dFdx(u2) : dFdx(suv.x), dFdx(suv.y));
  sdy = vec2(wrap ? dFdy(u2) : dFdy(suv.x), dFdy(suv.y));
}
// The maps do not tile across the 180th meridian: close to it, both sides are blended.
vec4 texAt(sampler2D m, vec2 uv) {
  vec4 c = textureGrad(m, uv, sdx, sdy);
  float d = min(uv.x, 1.0 - uv.x);
  if (d < 0.03) c = mix(textureGrad(m, vec2(1.0 - uv.x, uv.y), sdx, sdy), c, 0.5 + 0.5 * smoothstep(0.0, 0.03, d));
  return c;
}
vec4 tex(sampler2D m) { return texAt(m, suv); }
float heightLod(vec2 uv, float lod) {
  float d = min(uv.x, 1.0 - uv.x);
  float h = textureLod(uDataMap, uv, lod).r;
  if (d < 0.03) h = mix(textureLod(uDataMap, vec2(1.0 - uv.x, uv.y), lod).r, h, 0.5 + 0.5 * smoothstep(0.0, 0.03, d));
  return h;
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= uOctaves) break;
    s += a * noise(p);
    p = p * 2.07 + 5.3;
    a *= 0.5;
  }
  return s;
}

float ridged(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uOctaves) break;
    float r = 1.0 - abs(noise(p) * 2.0 - 1.0);
    s += a * r * r;
    p = p * 2.1 + 3.7;
    a *= 0.5;
  }
  return s;
}
// Cells: distance to the nearest centre, how close the nearest border is, and a number per cell.
vec3 cells(vec3 x) {
  vec3 i = floor(x);
  vec3 f = x - i;
  float d1 = 9.0;
  float d2 = 9.0;
  float id = 0.0;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) {
    vec3 g = vec3(float(a), float(b), float(c));
    vec3 o = vec3(hash(i + g + 1.7), hash(i + g + 9.2), hash(i + g + 5.4));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = hash(i + g + 3.3); } else if (d < d2) { d2 = d; }
  }
  return vec3(d1, d2 - d1, id);
}
vec3 turn(vec3 v, vec3 k, float a) { return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }
// One crater per cell at most: a bowl with a raised rim. -1 at the floor, +0.35 on the rim.
float craterH(vec3 q) {
  vec3 id = floor(q);
  if (hash(id + 4.1) > 0.6) return 0.0;
  vec3 c = 0.32 + 0.36 * vec3(hash(id + 11.3), hash(id + 23.7), hash(id + 37.1));
  float rad = 0.09 + 0.12 * hash(id + 51.9);
  float d = length(q - id - c) / rad;
  if (d >= 1.5) return 0.0;
  float depth = 0.4 + 0.6 * hash(id + 71.3);
  return (d < 1.0 ? -1.0 + 1.35 * d * d : 0.35 * pow(1.0 - (d - 1.0) / 0.5, 2.0)) * depth;
}
// Tech: where the grey crust has broken open (1) and where it is whole (0), with a jagged edge.
float broken(vec3 p) {
  float m = noise(p * 1.25 + uSeed) + 0.35 * (fbm(p * 4.5 + uSeed) - 0.5) + 0.12 * (noise(p * 14.0) - 0.5);
  return smoothstep(0.6, 0.64, m);
}
// Organic: cloud bands that wrap round the planet in wisps.
float wisps(vec3 p) {
  vec3 q = vec3(p.x * 2.2, p.y * 6.0, p.z * 2.2) + uSeed + vec3(uTime * 0.01, 0.0, 0.0);
  float bands = smoothstep(0.3, 0.0, abs(p.y - 0.42 + 0.12 * sin(p.x * 3.0 + uSeed))) + smoothstep(0.24, 0.0, abs(p.y + 0.38 + 0.1 * sin(p.z * 3.0)));
  return smoothstep(0.4, 0.68, fbm(q + fbm(q * 0.5))) * min(bands, 1.0);
}
// Network: billowing violet cloud over part of the globe.
float billows(vec3 p) {
  vec3 q = p * 2.4 + uSeed;
  float where = smoothstep(0.6, 0.72, noise(q * 0.7 + 3.0));
  float puff = 1.0 - abs(noise(q * 1.6 + fbm(q)) * 2.0 - 1.0);
  return where * smoothstep(0.25, 0.8, puff * 0.6 + fbm(q * 2.0) * 0.6);
}
// Celestial: the sky is wound round a vortex at the pole of the look.
vec3 swirl(vec3 p) {
  float d = 1.0 - dot(p, uPole);
  return turn(p, uPole, 3.4 * exp(-d * 2.6) + uTime * 0.02);
}
// …and clouds gather low on the globe.
float clouds(vec3 p) {
  vec3 q = p * 3.0 + uSeed;
  float low = smoothstep(-0.25, -0.6, p.y + 0.18 * sin(p.x * 4.0 + uSeed));
  float puff = 1.0 - abs(noise(q * 1.4 + fbm(q * 0.8)) * 2.0 - 1.0);
  return low * smoothstep(0.3, 0.85, puff * 0.55 + fbm(q * 1.8) * 0.65);
}

// Height of the ground (rock and ice) or of the cloud tops (gas), for a point on the unit sphere.
float height(vec3 p) {
  vec3 q = p * 2.6 + uSeed;
  if (uType > 5.5) return fbm(swirl(p) * 2.2 + uSeed) * 0.5;
  if (uType > 4.5) {
    // Rough crystal ground under the billows.
    return ridged(q * 1.5) * 0.5;
  }
  if (uType > 3.5) {
    // Mountain country: long sharp ridges, one great crater, cloud on top.
    float cr = length(p - uPole) / 0.34;
    float crater = cr < 1.0 ? -0.5 + 0.75 * cr * cr : 0.25 * smoothstep(1.5, 1.0, cr);
    return ridged(q * 1.25 + fbm(q * 0.7) * 0.8) * 1.1 + fbm(q * 4.0) * 0.2 + crater;
  }
  if (uType > 2.5) {
    // Cratered crust; the broken regions lie lower and smoother.
    float br = broken(p);
    float cr = craterH(q * 1.6) * 0.22 + craterH(q * 3.7 + 9.0) * 0.1 + craterH(q * 8.0 + 3.0) * 0.045;
    return mix(fbm(q * 1.8) * 0.3 + cr, fbm(q * 3.0) * 0.12 - 0.12, br);
  }
  if (uType < 0.5) {
    // Rock: rolling ground, worn basins with raised rims, fine grit.
    float h = fbm(q * 1.6);
    float c = noise(q * 2.4 + 3.0);
    float basin = smoothstep(0.6, 0.72, c);
    float rim = smoothstep(0.5, 0.6, c) - smoothstep(0.6, 0.7, c);
    return h * 0.9 - 0.12 * basin + 0.05 * rim + 0.07 * noise(q * 14.0);
  }
  if (uType < 1.5) {
    // Gas: soft latitude bands bent by turbulence, wide and fine together.
    float turb = fbm(q * vec3(1.0, 3.2, 1.0));
    float wide = sin(p.y * 9.0 + turb * 2.6 + uSeed);
    float fine = sin(p.y * 31.0 + turb * 5.0);
    return 0.5 + 0.3 * wide + 0.14 * fine;
  }
  // Ice: smooth ground with a few faint cracks.
  float cracks = 1.0 - abs(noise(q * 2.2) * 2.0 - 1.0);
  return fbm(q) * 0.75 + 0.14 * pow(cracks, 16.0);
}

// BOOOST: a world of energy. Plates of dark polished rock, split by rivers of blue-white light that
// run hot in their middle, with a few bright vents. Its own surface, independent of the source pack.
vec3 booostWarp(vec3 p) { return p * 2.3 + uSeed + (vec3(fbm(p * 1.4 + 3.1), fbm(p * 1.4 + 7.7), fbm(p * 1.4 + 1.3)) - 0.5) * 0.9; }
// Height: plates stand up, rivers cut down between them.
float booostHeight(vec3 p) {
  vec3 q = booostWarp(p);
  vec3 big = cells(q);
  vec3 small = cells(q * 2.6 + 4.0);
  float plates = smoothstep(0.0, 0.16, big.y);
  float cracks = mix(1.0, smoothstep(0.0, 0.08, small.y), step(0.45, small.z) * 0.6);
  return plates * cracks + fbm(p * 18.0) * 0.06;
}
void booost(vec3 p, vec3 T, vec3 B, out vec3 albedo, out vec3 emit, out vec3 nObj, out float gloss, out float shine) {
  vec3 q = booostWarp(p);
  vec3 big = cells(q);
  vec3 small = cells(q * 2.6 + 4.0);
  float flow = fbm(q * 1.7 + 5.0);
  // Rivers: wide where the flow is strong; the small cracks carry light only in some plates.
  float width = mix(0.025, 0.085, smoothstep(0.3, 0.7, flow));
  float river = 1.0 - smoothstep(0.0, width, big.y);
  float crack = (1.0 - smoothstep(0.0, width * 0.45, small.y)) * step(0.45, small.z) * smoothstep(0.35, 0.6, flow);
  float heat = max(river, crack * 0.7) * (0.65 + 0.55 * fbm(q * 4.0 + 2.0));
  // Vents: a bright point in the middle of a few plates.
  float vent = exp(-big.x * big.x * 90.0) * step(0.9, big.z);
  // Rock: graphite and steel blue, each plate a little different, cooler and darker by the rivers.
  float tone = 0.35 + 0.65 * big.z;
  vec3 rock = mix(vec3(0.018, 0.022, 0.034), vec3(0.09, 0.11, 0.15), tone * (0.7 + 0.6 * fbm(p * 9.0)));
  rock = mix(rock, vec3(0.16, 0.19, 0.24), smoothstep(0.62, 0.95, fbm(p * 5.0 + 9.0)) * 0.5);
  float scorch = 1.0 - smoothstep(width, width * 3.5, big.y);
  albedo = rock * (1.0 - 0.6 * scorch);
  // Light: deep blue at the edges of a river, ice blue inside, white where it runs hottest.
  vec3 deep = vec3(0.02, 0.18, 0.9);
  vec3 ice = vec3(0.35, 0.8, 1.0);
  emit = mix(deep, ice, smoothstep(0.3, 0.85, heat)) * heat * 1.5;
  emit += vec3(0.9, 0.97, 1.0) * pow(smoothstep(0.55, 1.0, heat), 3.0) * 1.2;
  emit += deep * scorch * 0.12;
  emit += mix(ice, vec3(1.0), 0.5) * vent * 1.6;
  // Relief from the height, by small steps across the surface.
  float d = 0.0025;
  float h0 = booostHeight(p);
  float hT = booostHeight(normalize(p + T * d));
  float hB = booostHeight(normalize(p + B * d));
  nObj = normalize(p - ((hT - h0) * T + (hB - h0) * B) / d * 0.022);
  // The plates are polished: sharp highlights on the rock, none on the light.
  gloss = 0.5 * (1.0 - smoothstep(0.0, 0.5, heat));
  shine = 70.0;
}

void surface(vec3 vP) {
  vec3 p = normalize(vP);
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), p) + 1e-4);
  vec3 B = cross(p, T);
  vec3 nObj = p;
  float h = 0.0;
  vec3 albedo = vec3(0.0);
  // Light the surface gives off by itself: cracks, points, aurora.
  vec3 emit = vec3(0.0);
  float gloss = 0.0;
  float shine = 36.0;
  float d = 0.012;
  h = height(p);
  float hT = height(normalize(p + T * d));
  float hB = height(normalize(p + B * d));
  float bump = uType < 0.5 ? 0.9 : (uType < 1.5 ? 0.12 : (uType < 2.5 ? 0.35 : (uType < 3.5 ? 1.6 : (uType < 4.5 ? 1.5 : (uType < 5.5 ? 1.2 : 1.0)))));
  nObj = normalize(p - bump * ((hT - h) * T + (hB - h) * B) / d * 0.08);
  if (uType > 5.5) {
    // Celestial: night-blue streams of blue, cyan and violet wound into a vortex, lavender cloud
    // low on the globe, stars, an aurora and a soft light in the eye of the vortex.
    float cl = 0.0;
    vec3 sw = swirl(p);
    vec3 sq = vec3(sw.x * 1.3, sw.y * 4.2, sw.z * 1.3) + uSeed;
    float flow = fbm(sq + fbm(sq * 0.6) * 0.8);
    float bright = smoothstep(0.42, 0.7, flow);
    float thread = pow(1.0 - abs(noise(sq * 1.7 + 5.0) * 2.0 - 1.0), 5.0);
    albedo = mix(vec3(0.003, 0.006, 0.03), uBase * 0.4, smoothstep(0.3, 0.75, flow));
    vec3 stream = mix(vec3(0.08, 0.3, 1.0), vec3(0.25, 0.85, 1.0), smoothstep(0.55, 0.85, flow));
    stream = mix(stream, uSecond, smoothstep(0.45, 0.7, noise(sw * 1.8 + uSeed + 3.0)));
    emit += stream * (bright * 0.22 + thread * bright * 0.35) * (1.0 - cl);
    albedo = mix(albedo, mix(vec3(0.72, 0.72, 1.0), uSecond, 0.35), cl * 0.92);
    // The aurora: an oval round the vortex, like an aurora round a magnetic pole.
    vec3 axisA = normalize(cross(uPole, vec3(0.31, 0.9, 0.3)));
    float along = atan(dot(p, cross(axisA, uPole)), dot(p, axisA));
    float off = dot(p, uPole) - 0.55 + 0.05 * sin(along * 3.0 + uSeed) + 0.04 * (noise(p * 3.0 + uTime * 0.05) - 0.5);
    float band = exp(-pow(off / 0.05, 2.0));
    float part = smoothstep(0.35, 0.55, noise(vec3(along * 0.9, uSeed, uTime * 0.03)));
    float folds = 0.6 + 0.4 * sin(along * 22.0 + noise(p * 5.0) * 5.0 + uTime * 0.25);
    emit += mix(vec3(0.2, 0.75, 1.0), uSecond, 0.5 + 0.5 * sin(along * 2.0)) * band * part * folds * 0.6;
    vec3 sc = p * 15.0 + uSeed;
    vec3 si = floor(sc);
    float sh = hash(si + 2.2);
    if (sh > 0.95) {
      float sd = length(sc - si - 0.5);
      emit += mix(vec3(1.0), uSecond, 0.4) * smoothstep(0.18, 0.0, sd) * 1.3 * (1.0 - cl) * (0.6 + 0.4 * sin(uTime * (0.4 + sh) + sh * 30.0));
    }
    // The vortex: two spiral arms of lighter blue and lavender wound into a dark eye that glows softly.
    float dv = 1.0 - dot(p, uPole);
    vec3 v1 = normalize(cross(uPole, vec3(0.0, 0.0, 1.0)));
    vec3 v2 = cross(uPole, v1);
    float rv = sqrt(max(2.0 * dv, 0.0));
    float av = atan(dot(p, v2), dot(p, v1));
    float arms = 0.5 + 0.5 * sin(2.0 * av + 6.5 * log(rv + 0.03) - uTime * 0.04 + (noise(p * 6.0 + uSeed) - 0.5) * 2.0);
    float zone = smoothstep(0.95, 0.25, rv) * smoothstep(0.03, 0.12, rv);
    albedo = mix(albedo, mix(vec3(0.2, 0.3, 0.8), uSecond, 0.5), pow(arms, 3.0) * zone * 0.8);
    albedo *= 1.0 - 0.6 * smoothstep(0.14, 0.04, rv);
    emit += mix(vec3(0.3, 0.7, 1.0), uSecond, 0.5) * pow(arms, 5.0) * zone * 0.1;
    emit += mix(uSecond, vec3(0.6, 0.8, 1.0), 0.4) * (exp(-dv * 90.0) * 0.45 + exp(-dv * 14.0) * 0.06);
  } else if (uType > 4.5) {
    // Network: dark violet crystal with a web of magenta light and bright nodes, under lavender billows.
    float bl = 0.0;
    vec3 ce = cells(p * 3.4 + uSeed);
    // Each crystal is a flat face, tilted its own way: facets catch the light one by one.
    vec3 tilt = vec3(hash(vec3(ce.z * 91.0, 1.0, 2.0)), hash(vec3(ce.z * 57.0, 3.0, 1.0)), 0.0) - 0.5;
    nObj = normalize(nObj + (T * tilt.x + B * tilt.y) * 0.5);
    albedo = mix(uDark * 0.5, uBase * 0.7, 0.2 + 0.8 * ce.z);
    gloss = 0.4 * ce.z * (1.0 - bl);
    float open = 1.0 - smoothstep(0.05, 0.5, bl);
    // The fine web: the seams between crystals.
    float web = 1.0 - smoothstep(0.0, 0.016, ce.y);
    emit += uSecond * web * open * 0.55;
    float points = 0.0;
    float lines = 0.0;
    float warm = 0.0;
    for (int i = 0; i < 10; i++) {
      vec3 a = uNodes[i];
      float da = 1.0 - dot(p, a);
      float pt = exp(-da * 1400.0) * 1.4 + exp(-da * 160.0) * 0.25;
      points += pt;
      if (i == 2 || i == 6) warm += pt;
      for (int k = 1; k <= 2; k++) {
        if (k == 2 && (i - (i / 2) * 2) != 0) continue;
        vec3 b = uNodes[(i + k) - ((i + k) / 10) * 10];
        vec3 nn = normalize(cross(a, b));
        float inside = step(0.0, dot(cross(a, p), nn)) * step(0.0, dot(cross(p, b), nn));
        lines += (1.0 - smoothstep(0.0, 0.007, abs(dot(p, nn)))) * inside;
      }
    }
    emit += (mix(uSecond, vec3(1.0, 0.85, 1.0), 0.65) * points + vec3(1.0, 0.45, 0.2) * warm * 0.25
      + mix(uSecond, vec3(1.0, 0.8, 1.0), 0.35) * min(lines, 1.0) * 0.55) * (0.25 + 0.75 * open);
    // Billows: lavender on top, violet in their folds.
    vec3 cloud = mix(uBase * 0.3, vec3(0.42, 0.28, 0.8), smoothstep(0.3, 1.0, bl));
    albedo = mix(albedo, cloud, smoothstep(0.05, 0.4, bl));
  } else if (uType > 3.5) {
    // Organic: dark green valleys, olive slopes, gold and ochre on the sunlit ridges, white cloud.
    float g = h;
    albedo = mix(uDark * 0.7, uBase, smoothstep(0.2, 0.6, g));
    vec3 ochre = mix(uSecond, vec3(0.42, 0.3, 0.1), 0.35 + 0.4 * noise(p * 6.0 + uSeed));
    albedo = mix(albedo, ochre, smoothstep(0.6, 0.95, g) * (0.45 + 0.5 * smoothstep(0.4, 0.6, noise(p * 1.8 + uSeed + 9.0))));
    albedo = mix(albedo, uSecond * 1.3, smoothstep(0.95, 1.25, g) * 0.6);
    albedo *= 0.7 + 0.6 * fbm(p * 11.0 + uSeed);
  } else if (uType > 2.5) {
    // Tech: silver-grey cratered crust; where it has broken, dark blue depths crossed by veins of
    // ice-blue light, with glints where veins meet.
    float br = broken(p);
    albedo = mix(uDark * 1.5, uBase, smoothstep(-0.05, 0.3, h));
    albedo = mix(albedo, uLight, smoothstep(0.28, 0.45, h) * 0.5);
    albedo *= 0.8 + 0.4 * fbm(p * 13.0 + uSeed);
    // Thin dark cracks run across the whole crust; only the broken regions hold light.
    float crackLine = pow(1.0 - abs(noise(p * 5.0 + uSeed + fbm(p * 3.0) * 0.8) * 2.0 - 1.0), 7.0);
    crackLine *= smoothstep(0.3, 0.5, noise(p * 2.2 + uSeed + 7.0));
    albedo *= 1.0 - 0.85 * smoothstep(0.35, 0.8, crackLine) * smoothstep(0.02, 0.006, length(fwidth(p)));
    gloss = 0.35 * (1.0 - br);
    vec3 ce = cells(p * 4.2 + uSeed + (fbm(p * 6.0) - 0.5) * 0.5);
    vec3 depths = mix(vec3(0.006, 0.014, 0.06), vec3(0.03, 0.08, 0.26), ce.z * 0.8 + 0.2 * noise(p * 5.0));
    albedo = mix(albedo, depths, br);
    // Only some seams carry light, so the veins stay local.
    float vein = (1.0 - smoothstep(0.0, 0.012, ce.y)) * step(0.55, hash(vec3(ce.z * 31.0, 2.0, 7.0)));
    float glow = exp(-ce.y * 16.0) * 0.12;
    float glint = exp(-ce.x * ce.x * 260.0) * step(0.72, ce.z);
    // The edge of the break glows faintly too.
    float rim = br * (1.0 - br) * 4.0;
    emit += br * (mix(uSecond, vec3(0.92, 0.97, 1.0), 0.6) * vein * 1.25 + uSecond * glow + vec3(0.9, 0.96, 1.0) * glint * 0.8) + uSecond * rim * 0.15;
  } else if (uType < 0.5) {
    albedo = mix(uDark, uBase, smoothstep(0.32, 0.62, h));
    albedo = mix(albedo, uLight, smoothstep(0.66, 0.85, h) * 0.7);
  } else if (uType < 1.5) {
    float storm = smoothstep(0.84, 0.95, noise(p * 3.0 + uSeed * 1.7));
    albedo = mix(mix(uDark, uBase, 0.45), uBase, smoothstep(0.1, 0.9, h));
    albedo = mix(albedo, uLight, smoothstep(0.7, 1.0, h) * 0.35 + storm * 0.4);
  } else {
    // Clouds stream along the latitudes.
    vec3 cq = p * vec3(3.0, 7.0, 3.0) + vec3(uSeed, 0.0, uSeed);
    float cloud = smoothstep(0.48, 0.78, fbm(cq + fbm(cq * 0.7)));
    float cap = smoothstep(0.74, 0.92, abs(p.y));
    albedo = mix(uDark, uBase, smoothstep(0.25, 0.65, h));
    albedo = mix(albedo, uLight, max(cloud * 0.6, cap));
  }

  if (uMaps > 0.5) {
    // The project's texture set on top of the drawn world:
    //  - relief: coarse slopes from the height (data R), detail from the normal map, hollows from
    //    fine minus coarse height. The normal maps are computed from the heights, so the two work at
    //    different scales instead of doubling the relief. The pack's normals keep green pointing
    //    down (DirectX): flipped here.
    //  - colour: the albedo map is blended into the drawn colour, by a share set per planet;
    //  - polish: roughness (data G) sets how sharp and bright the highlights are;
    //  - light: the emissive mask (data B) places each planet's own light (see below).
    mapCoords(p);
    // Near the poles an equirectangular map fans out into rays: there the maps give their average.
    float poleFade = smoothstep(0.74, 0.93, abs(p.y));
    vec3 nm = tex(uNormalMap).xyz * 2.0 - 1.0;
    nm.y = -nm.y;
    vec4 dat = mix(tex(uDataMap), textureLod(uDataMap, suv, 10.0), poleFade);
    vec2 size = vec2(textureSize(uDataMap, 0));
    vec2 e = 6.0 / size;
    float hL = heightLod(suv - vec2(e.x, 0.0), 2.5);
    float hR = heightLod(suv + vec2(e.x, 0.0), 2.5);
    float hD = heightLod(suv - vec2(0.0, e.y), 2.5);
    float hU = heightLod(suv + vec2(0.0, e.y), 2.5);
    float cosLat = max(sqrt(max(1.0 - p.y * p.y, 0.0)), 0.2);
    vec2 slope = vec2((hR - hL) / (2.0 * e.x * 6.2832 * cosLat), (hU - hD) / (2.0 * e.y * 3.1416)) * (1.0 - poleFade);
    vec3 gm = (slope.x * T + slope.y * B) * uSurface.x * 0.02;
    nObj = normalize(nObj + (T * nm.x + B * nm.y) * uSurface.y * (1.0 - poleFade) - gm);
    float occ = clamp(1.0 + (dat.r - heightLod(suv, 5.0)) * 2.4 * (1.0 - poleFade), 0.6, 1.2);

    vec3 mapCol = mix(tex(uAlbedoMap).rgb, textureLod(uAlbedoMap, suv, 10.0).rgb, poleFade);
    mapCol = mix(vec3(dot(mapCol, vec3(0.2126, 0.7152, 0.0722))), mapCol, uSurface2.x);
    albedo = mix(albedo, mapCol, uSurface2.w) * occ;

    float rough = dat.g;
    gloss *= 1.3 - rough;
    shine = mix(90.0, 10.0, rough);

    float em = dat.b;
    if (uType > 5.5) {
      // Cielith: faint cyan glows in the dark ground.
      emit += mix(vec3(0.25, 0.7, 1.0), uSecond, 0.4) * textureLod(uDataMap, suv, 1.5).b * uSurface.z;
    } else if (uType > 4.5) {
      // Votify: the mask, blurred, chooses where the crystal network is lit; elsewhere it dims.
      float region = smoothstep(0.12, 0.4, textureLod(uDataMap, suv, 3.5).b);
      emit *= mix(0.3, 1.0, region * uSurface.z);
    } else if (uType > 3.5) {
      // Aceituna: gold specks catch a little light.
      emit += uSecond * em * uSurface.z;
    } else if (uType > 2.5) {
      // Boost: the mask marks fractured ground: dark depths, light along the broken edge and
      // thin ice-blue veins inside.
      float zone = smoothstep(0.08, 0.35, textureLod(uDataMap, suv, 1.5).b);
      albedo = mix(albedo, vec3(0.008, 0.016, 0.05), zone * 0.9);
      gloss *= 1.0 - zone;
      float vein = pow(1.0 - abs(noise(p * 24.0 + uSeed) * 2.0 - 1.0), 12.0) * zone;
      emit += mix(uSecond, vec3(0.9, 0.97, 1.0), 0.3) * (zone * (1.0 - zone) * 4.0 * 0.35 + vein * 0.9) * uSurface.z;
    } else {
      emit += uSecond * em * uSurface.z;
    }
  }
  if (uType > 2.5 && uType < 3.5) booost(p, T, B, albedo, emit, nObj, gloss, shine);
  gAlbedo = albedo; gEmit = emit; gGloss = gloss; gRough = (90.0 - shine) / 80.0;
  gNormal = vec3(dot(nObj, T), dot(nObj, B), dot(nObj, p));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;           // y up: row 0 of the image is the bottom here
  float u = uv.x;
  float v = uv.y;                               // 1 at the north pole (suv.y convention)
  float theta = (1.0 - v) * 3.14159265;         // from the north pole
  float phi = u * 6.2831853;
  // Inverse of mapCoords: u = atan(p.z, -p.x) / 2pi, v = 1 - acos(p.y) / pi.
  vec3 P = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
  surface(P);
  vec3 o;
  if (uMode == 0) o = pow(clamp(gAlbedo, 0.0, 1.0), vec3(1.0 / 2.2));
  else if (uMode == 1) { vec3 n = normalize(gNormal); o = vec3(n.x, -n.y, n.z) * 0.5 + 0.5; }
  else if (uMode == 2) o = pow(clamp(gEmit * 0.5, 0.0, 1.0), vec3(1.0 / 2.2));
  else o = vec3(clamp(gRough, 0.0, 1.0), clamp(gGloss, 0.0, 1.0), 0.0);
  fragOut = vec4(o, 1.0);
}
