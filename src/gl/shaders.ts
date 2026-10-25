// GLSL for the renderer. World: x right, y down (south), z up. The camera looks from the south and
// above, so a point (x,y,z) lands on screen at (x, y - z) and is nearer the more (y + z) it has.
const HASH = `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
`;
const NOISE = `${HASH}float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a*noise(p); p = p*2.03 + vec2(17.1, 9.3); a *= 0.5; } return s; }
`;
const LIGHTS = `
uniform int uNL; uniform vec4 uL[16]; uniform vec3 uLC[16]; uniform float uLZ[16];   // uLZ: each lamp's height
vec3 pointLights(vec3 p, vec3 n){ vec3 acc = vec3(0.0);
  for (int i = 0; i < 16; i++){ if (i >= uNL) break; vec4 L = uL[i]; vec3 lp = vec3(L.xy, uLZ[i]); vec3 d = lp - p; float r = length(d.xy);
    float k = clamp(1.0 - r/L.z, 0.0, 1.0); k = k*k*(3.0 - 2.0*k)*(0.55 + 0.45*k);   // broad soft pool, no rim
    acc += uLC[i]*L.w*k*(0.45 + 0.55*max(dot(n, normalize(d)), 0.0)); }
  return acc; }
`;
// Pixel styles share one stylised language: lighting, depth tints, foam, shadows and light pools step through a
// few flat bands (hard edges, no dither, so flat areas stay calm). uOrg = world pixel index of the frame's top-left
// pixel (x, y) and the frame height; uPx = render pixels per world unit (0 in 'smooth', where the helpers are no-ops).
const STYLE = `
uniform float uPx; uniform vec3 uOrg;
vec2 worldPix(){ return vec2(uOrg.x + floor(gl_FragCoord.x), uOrg.y + uOrg.z - 1.0 - floor(gl_FragCoord.y)); }
float st(float x, float n){ return uPx > 0.0 ? floor(x*n + 0.5)/n : x; }
vec3 stL(vec3 c, float n){ if (uPx <= 0.0) return c; float l = max(max(c.r, c.g), c.b), q = floor(sqrt(l)*n + 0.3)/n; return l > 1e-4 ? c*(q*q/l) : c; }   // light pools: soft rings that never spread the faint tail
`;
// full-screen quad, at the far plane (the ground is drawn behind the meshes; post passes don't depth test)
export const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aP; out vec2 vUV;
void main(){ vUV = aP*0.5 + 0.5; gl_Position = vec4(aP, 1.0, 1.0); }`;

export const GROUND_FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vUV; out vec4 outC;
uniform sampler2D uH, uFoam, uShadow, uTh, uPal;
uniform vec4 uHR, uHT, uCam;
uniform float uT, uWT, uWind, uRain, uNight, uCloud, uFlash;
uniform vec2 uWD; uniform vec3 uSun, uSunC, uAmb, uSky;
${NOISE}${LIGHTS}${STYLE}
const float HS = 40.0;
float H(vec2 w){ return texture(uH, (w - uHT.xy)/uHT.zw).r; }
// the biome weights stored with the heights: reef minus mangrove (one signed channel: never both), kelp, volcanic
vec3 BIO(vec2 w){ return texture(uH, (w - uHT.xy)/uHT.zw).gba; }
vec2 TUV(vec2 w){ return (w - uHR.xy)/uHR.zw; }
// island themes (biome.ts): R = theme row in the palette table, G = how strongly it holds, B = the island's own shade.
// The table holds per theme: 0 wet, 1 sand, 2 sand2, 3 grass, 4 grass2, 5 forest, 6 rock, 7 cliff, 8 cliff2, 9 flowers,
// 10..12 shallow, mid and deep water, 13 (beach, patch, flowers, speckle), 14 (rockAt, snow, outcrops, glow),
// 15 (clarity, altBeach, bands, -)
vec4 TH(vec2 w){ return texture(uTh, (w - uHT.xy)/uHT.zw); }
vec4 PAL(int t, int k){ return texelFetch(uPal, ivec2(k, t), 0); }
float warm(float y){ return clamp((y - 1500.0)/1000.0, 0.0, 1.0); }
float cold(float y){ return clamp((-y - 1300.0)/1000.0, 0.0, 1.0); }
float waveH(vec2 p){
  float t = uWT, a = 0.55 + uWind*1.3;
  float h = sin(dot(p, vec2(0.13, 0.05)) + t*1.4)*0.30 + sin(dot(p, vec2(-0.04, 0.15)) + t*1.9)*0.22;
  h += (fbm(p*0.07 + uWD*t*0.35) - 0.5)*1.4;
  h += (noise(p*0.32 - uWD*t*0.8) - 0.5)*0.45;
  return h*a; }
float caustic(vec2 p){ vec2 q = p*0.16; float c = 0.0;
  for (int i = 0; i < 3; i++){ q += vec2(sin(q.y*1.7 + uT*0.8), cos(q.x*1.5 - uT*0.6))*0.55; c += abs(sin(q.x) + sin(q.y)); }
  return pow(clamp(1.0 - c*0.28, 0.0, 1.0), 2.5); }
vec2 ripples(vec2 p){ vec2 g = p/4.5, c = floor(g), f = fract(g) - 0.5; float r = hash(c);
  float ph = fract(uT*0.9 + r); vec2 o = (vec2(hash(c + 3.1), hash(c + 7.7)) - 0.5)*0.5; vec2 dv = f - o; float d = length(dv);
  float ring = sin((d - ph*0.55)*45.0)*smoothstep(0.12, 0.0, abs(d - ph*0.55))*(1.0 - ph);
  return dv/max(d, 0.001)*ring; }
// sun glitter: a random point per small cell that briefly twinkles
// sun glints, one per lucky 2.6-unit cell. pw is the size of a screen pixel in world units: a glint is never
// smaller than about a pixel, so as the camera slides by fractions of a pixel it fades between pixels instead of popping
float sparkle(vec2 p, float pw){
  vec2 g = p/2.6, c = floor(g), f = fract(g);
  float r = hash(c), r2 = hash(c + 11.3);
  vec2 pt = vec2(hash(c + 3.7), hash(c + 8.1))*0.7 + 0.15;
  float tw = pow(max(0.0, sin(uT*(2.0 + r*3.0) + r2*40.0)), 14.0);
  float rad = max(0.44, pw*0.55), d = length(f - pt)*2.6;
  return step(0.885, r)*smoothstep(rad, 0.0, d)*pow(0.44/rad, 1.2)*tw; }
float glintPix(vec2 pc){                       // pc: world pixel index; twinkle strength if it is its cell's glint pixel
  vec2 c = floor((pc + 0.5)/uPx/2.6); float r = hash(c), r2 = hash(c + 11.3);
  vec2 gp = floor((c + vec2(hash(c + 3.7), hash(c + 8.1))*0.7 + 0.15)*2.6*uPx);
  float tw = pow(max(0.0, sin(uT*(2.0 + r*3.0) + r2*40.0)), 14.0);
  return all(equal(gp, pc)) ? step(1.0 - 0.115*min(1.0, uPx*uPx), r)*tw : 0.0; }   // zoomed out, fewer glints per pixel
float glints(vec2 p, float pw){
  if (uPx <= 0.0) return sparkle(p, pw);
  vec2 pc = worldPix(); float g = glintPix(pc);
  float arm = max(max(glintPix(pc + vec2(1, 0)), glintPix(pc - vec2(1, 0))), max(glintPix(pc + vec2(0, 1)), glintPix(pc - vec2(0, 1))));
  return (g + step(0.995, arm)*0.25)*0.8; }
// The sea floor where the water is clear, one detail per world pixel: rippled sand, rocks, seagrass or kelp that
// sways with the swell, and clumps of coral in warm water. Alpha: how much more it shows through the water than sand
// (coral and weed reach up toward the light).
const vec3 CORAL[5] = vec3[5](vec3(.96,.46,.56), vec3(.98,.62,.32), vec3(.66,.44,.84), vec3(.96,.86,.38), vec3(.32,.82,.74));
vec4 seabed(vec2 p, float depth, float wm, float cd, vec3 bm, float mg){
  vec2 q = floor(p) + 0.5;
  vec3 sand = mix(mix(vec3(.80,.73,.54), vec3(.94,.90,.75), wm), vec3(.6,.6,.56), cd);
  sand = mix(mix(mix(sand, vec3(.95,.92,.80), bm.x), vec3(.40,.38,.30), bm.y), vec3(.20,.19,.21), bm.z);   // coral sand, kelp silt, black sand
  sand = mix(sand, mix(vec3(.26,.22,.15), vec3(.40,.32,.16), step(0.9, hash(q + 31.0))), mg);           // mangrove mud and fallen leaves
  float rip = sin(dot(q, vec2(0.55, 0.83))*1.3 + noise(q*0.06)*5.0);
  vec3 c = sand*(0.93 + 0.12*st(rip*0.5 + 0.5, 2.0)); float up = 0.0;
  float rk = noise(q*0.11 + 7.0)*0.65 + noise(q*0.37)*0.35;
  if (rk > 0.7 - 0.12*bm.z - 0.05*bm.y) c = mix(vec3(.40,.42,.40), vec3(.58,.57,.52), st(noise(q*0.45 + 3.0), 2.0))*(rk > 0.74 ? 1.0 : 0.82)*mix(1.0, 0.5, bm.z);
  float patchv = noise(q*0.045 + 19.0);
  if (patchv > 0.6 - 0.22*bm.y && depth > 0.04){                       // seagrass, kelp where it's cold or on kelp coasts
    float sway = sin(uT*1.3 + q.y*0.35 + q.x*0.1);
    if (hash(floor(vec2(q.x + sway*0.8, q.y*0.5))) > 0.42){
      c = mix(mix(mix(vec3(.30,.54,.30), vec3(.42,.60,.27), wm), vec3(.36,.36,.20), cd), vec3(.30,.30,.12), bm.y)*(0.75 + 0.35*hash(q + 3.0)); up = 0.12 + 0.1*bm.y; }
  } else if (max(wm, bm.x) > 0.1 && patchv < 0.42 && depth > 0.03 && depth < 0.32){  // coral, in warm water and on reefs
    vec2 cc = floor(q/4.0), f = fract(q/4.0) - 0.5 - (vec2(hash(cc + 2.0), hash(cc + 4.0)) - 0.5)*0.3;
    if (hash(cc + 11.0) < max(wm*0.6, bm.x*0.85)*smoothstep(0.42, 0.25, patchv) + 0.05 && length(f) < 0.3 + 0.2*hash(cc + 6.0))
      { c = CORAL[int(hash(cc + 8.0)*4.99)]*(0.82 + 0.3*step(0.55, hash(q))); up = 0.35; }
  }
  if (bm.z > 0.4 && depth > 0.05){                                     // warm vents glowing among the black rocks
    vec2 vcell = floor(q/28.0); float d = length(q - (vcell + 0.25 + 0.5*vec2(hash(vcell + 71.0), hash(vcell + 73.0)))*28.0);
    if (hash(vcell + 77.0) > 0.86 && d < 2.6){ c = mix(vec3(1.0,.42,.16), vec3(1.0,.78,.36), step(d, 1.2))*(0.85 + 0.25*sin(uT*2.2 + hash(vcell)*6.0)); up = 0.55; }
  }
  return vec4(c, up); }
// Seabed shape the heightfield is too coarse for: deep basins and gullies in open water, and now and then
// a blue hole in the shallows. Returns the depth to colour by, from the true depth.
float seaDepth(vec2 p, float depth){
  float open = smoothstep(0.3, 0.5, depth);
  float vd = depth + ((noise(p*0.0016 + 8.0) - 0.4)*0.5 + (noise(p*0.006 + noise(p*0.02)*1.5) - 0.5)*0.25)*open;
  vec2 c = floor(p/240.0);
  if (hash(c + 5.3) > 0.6 && depth > 0.03 && depth < 0.45){                 // only holes that land in shallows show
    vec2 o = (c + 0.25 + 0.5*vec2(hash(c + 1.7), hash(c + 2.9)))*240.0;
    float d = length(p - o)/(9.0 + 12.0*hash(c + 4.1)) + (noise(p*0.15) - 0.5)*0.25;
    vd = mix(1.2, vd, smoothstep(0.75, 1.0, d));
  }
  return vd; }
// slanting shafts of sunlight under the surface
float sunShafts(vec2 p){ vec2 sd = normalize(uSun.xy + 1e-4); float u = dot(p, vec2(-sd.y, sd.x)), v = dot(p, sd);
  return smoothstep(0.65, 0.9, noise(vec2(u*0.06, uT*0.1)))*smoothstep(0.5, 0.8, noise(vec2(u*0.03, v*0.04 - uT*0.05))); }
float terrainShadow(vec2 p, float h0){
  vec2 sd = normalize(uSun.xy + 1e-4); float tanE = uSun.z/max(length(uSun.xy), 1e-3), s = 0.0;
  for (int i = 1; i <= 10; i++){ float d = float(i)*3.0; if (H(p + sd*d)*HS > h0*HS + d*tanE + 0.4) s += 0.11; }
  return min(s, 0.8); }
void main(){
  vec2 p = uCam.xy + vec2(vUV.x, 1.0 - vUV.y)*uCam.zw;
  float pw = max(fwidth(p).x, fwidth(p).y);                 // world units per screen pixel (taken here, in uniform control flow)
  float h = H(p), wm = warm(p.y), cd = cold(p.y);
  vec3 bm = BIO(p);                                           // biome weights: reef (or mangrove, below zero), kelp, volcanic
  float mg = max(-bm.x, 0.0); bm.x = max(bm.x, 0.0);
  vec4 th = TH(p); float tw = th.g; int ti = int(th.r*255.0 + 0.5);
  vec2 tu = TUV(p), tp = 1.0/vec2(textureSize(uShadow, 0));
  float objSh = (texture(uShadow, tu).r*2.0 + texture(uShadow, tu + vec2(tp.x*2.0, 0)).r + texture(uShadow, tu - vec2(tp.x*2.0, 0)).r
               + texture(uShadow, tu + vec2(0, tp.y*2.0)).r + texture(uShadow, tu - vec2(0, tp.y*2.0)).r)/6.0;
  float glintSh = objSh;                                      // glints keep the soft value: a banded edge would make them pop
  objSh = st(objSh, 2.0);                                     // crisp, dither-edged shadows like the voxel art
  float cloud = st(smoothstep(0.42, 0.78, fbm(p*0.0032 + uWD*uT*0.004)), 3.0)*uCloud;
  float sunVis = (1.0 - objSh*0.6)*(1.0 - cloud*0.55);
  vec3 col;
  if (h > 0.0){
    float dx = H(p + vec2(1, 0)) - H(p - vec2(1, 0)), dy = H(p + vec2(0, 1)) - H(p - vec2(0, 1));
    vec3 n = normalize(vec3(-dx*HS*0.5, -dy*HS*0.5, 1.0));
    float det = fbm(p*0.11), det2 = noise(p*0.7), hh = h + (det - 0.5)*0.035;
    vec3 wet   = mix(mix(vec3(.66,.58,.42), vec3(.80,.73,.55), wm), vec3(.52,.50,.46), cd);
    vec3 sand  = mix(mix(vec3(.88,.79,.57), vec3(.97,.92,.77), wm), vec3(.71,.68,.62), cd);
    vec3 grass = mix(mix(vec3(.45,.61,.29), vec3(.50,.71,.29), wm), vec3(.47,.52,.40), cd);
    vec3 forest= mix(mix(vec3(.24,.38,.21), vec3(.16,.40,.21), wm), vec3(.21,.28,.23), cd);
    vec3 rock = vec3(.52,.55,.58), snow = vec3(.93,.95,.97), peak;
    float tex2 = st(det2, 3.0);                                   // grass/forest speckle on the pixel grid
    vec2 q = floor(p) + 0.5;
    // biomes: white coral sand and lush green; grey shingle and moss on kelp coasts; black sand and basalt on the ember isles
    wet = mix(mix(mix(wet, vec3(.80,.76,.60), bm.x), vec3(.40,.41,.40), bm.y), vec3(.13,.12,.13), bm.z);
    sand = mix(sand, vec3(.98,.95,.84), bm.x);
    sand = mix(sand, mix(vec3(.52,.53,.51), vec3(.68,.68,.64), step(0.5, hash(q))), bm.y);
    sand = mix(sand, mix(vec3(.19,.18,.19), vec3(.30,.28,.28), step(0.6, hash(q + 2.0))), bm.z);
    // the ember isles: ash and scorched scrub, with a few hardy olive patches
    vec3 ash = mix(vec3(.34,.31,.27), vec3(.44,.43,.28), st(smoothstep(0.55, 0.7, noise(p*0.05 + 3.0)), 2.0));
    grass = mix(mix(mix(grass, vec3(.38,.70,.30), bm.x), vec3(.32,.46,.30), bm.y), ash, bm.z);
    forest = mix(mix(mix(forest, vec3(.12,.42,.22), bm.x), vec3(.13,.26,.19), bm.y), vec3(.22,.21,.17), bm.z);
    rock = mix(mix(rock, vec3(.42,.45,.47), bm.y), vec3(.24,.23,.25), bm.z);
    // mangroves: dark mud flats and a dense, low, dark green canopy
    wet = mix(wet, vec3(.25,.22,.15), mg);
    sand = mix(sand, mix(vec3(.33,.28,.19), vec3(.42,.36,.24), step(0.55, hash(q + 4.0))), mg);
    grass = mix(grass, vec3(.22,.40,.17), mg); forest = mix(forest, vec3(.08,.25,.11), mg);
    // shores and meadows change character along the coast: stony beaches, dry or mossy patches, flowers
    float region = noise(p*0.016 + 40.0);
    float pebbles = st(smoothstep(0.66, 0.76, region), 2.0);
    vec3 pebC = mix(vec3(.58,.54,.48), vec3(.76,.72,.64), step(0.45, hash(q))), pebWet = vec3(.42,.42,.40);
    vec3 patchC = mix(vec3(.66,.64,.36), vec3(.36,.52,.30), cd); float patchK = smoothstep(0.55, 0.75, noise(p*0.03 + 9.0))*0.6;
    vec3 flowerC = mix(mix(vec3(.96,.92,.80), vec3(.98,.82,.30), step(0.5, hash(q + 5.0))), vec3(.92,.52,.66), step(0.8, hash(q + 9.0)));
    vec3 cliffA = vec3(.50,.47,.43), cliffB = vec3(.62,.58,.52);
    float beach = 0.07 + 0.07*region, rockAt = mix(mix(0.72, 0.6, cd), 0.42, bm.z), flowerD = 0.015*(1.0 - bm.z)*(1.0 - mg);
    float snowK = cd, snowLo = 0.42, outcrop = 0.0, glow = 0.0, strata = 0.0, cliffDim = mix(1.0, 0.5, bm.z);
    if (tw > 0.004){                                              // the island's theme over the region's colours
      vec4 pA = PAL(ti, 13), pB = PAL(ti, 14), pC = PAL(ti, 15);
      vec3 jit = 1.0 + (vec3(hash(vec2(th.b*97.0, 1.0)), hash(vec2(th.b*97.0, 2.0)), hash(vec2(th.b*97.0, 3.0))) - 0.5)*0.1;   // this island's own shade
      vec3 s1 = PAL(ti, 1).rgb, s2 = PAL(ti, 2).rgb;
      wet = mix(wet, PAL(ti, 0).rgb, tw);
      sand = mix(sand, mix(s1, s2, step(1.0 - pA.w, hash(q + 2.0)))*jit, tw);
      grass = mix(grass, PAL(ti, 3).rgb*jit, tw); forest = mix(forest, PAL(ti, 5).rgb*jit, tw); rock = mix(rock, PAL(ti, 6).rgb, tw);
      cliffA = mix(cliffA, PAL(ti, 7).rgb, tw); cliffB = mix(cliffB, PAL(ti, 8).rgb, tw); cliffDim = mix(cliffDim, 1.0, tw);
      // a stretch of the coast beached in the other sand
      pebbles = mix(pebbles, st(smoothstep(0.86 - 0.5*pC.y, 0.9 - 0.5*pC.y, region), 2.0), tw);
      pebC = mix(pebC, mix(s2, s1*0.92, step(0.6, hash(q)))*jit, tw); pebWet = mix(pebWet, PAL(ti, 0).rgb*0.9, tw);
      patchC = mix(patchC, PAL(ti, 4).rgb*jit, tw);
      patchK = mix(patchK, st(smoothstep(0.66 - 0.32*pA.y, 0.74 - 0.32*pA.y, noise(p*0.03 + 9.0)), 2.0)*0.9, tw);
      flowerC = mix(flowerC, mix(PAL(ti, 9).rgb, flowerC, step(0.8, hash(q + 13.0))), tw);
      flowerD = mix(flowerD, pA.z*(0.3 + 1.4*noise(p*0.05 + 31.0)), tw);   // in drifts, not evenly
      beach += pA.x*tw; rockAt = mix(rockAt, pB.x, tw);
      snowK = max(cd, pB.y*tw); snowLo = 0.42 - 0.3*pB.y*tw; outcrop = pB.z*tw; glow = pB.w*tw; strata = clamp(pC.z*2.0 - 1.0, 0.0, 1.0)*tw;
    }
    // the far north: a frosted, pale blue-white band where the sea meets the shore
    wet = mix(wet, vec3(.80,.88,.93), smoothstep(0.35, 0.8, cd)*0.85);
    peak = mix(mix(mix(vec3(.68,.70,.72), vec3(.30,.28,.29), bm.z), cliffB*1.08, tw), snow, snowK);   // bare summits in the island's own stone
    sand = mix(sand, pebC, pebbles);
    wet = mix(wet, pebWet, pebbles);
    grass = mix(grass, patchC, patchK);
    col = mix(wet, sand, st(smoothstep(0.02, 0.045, hh), 2.0));
    float meadow = st(smoothstep(beach, beach + 0.04, hh), 2.0);
    col = mix(col, grass*(0.85 + tex2*0.3), meadow);
    // rocky outcrops breaking through the turf
    col = mix(col, rock*(0.82 + det*0.36), outcrop*meadow*st(smoothstep(0.9 - outcrop*0.22, 0.94 - outcrop*0.22, noise(p*0.045 + 21.0) + det2*0.06), 2.0));
    float flower = step(1.0 - flowerD, hash(q + 17.0))*step(beach + 0.05, hh)*step(hh, 0.34);   // meadow flowers
    col = mix(col, flowerC, flower);
    col = mix(col, forest*(0.8 + tex2*0.35), st(smoothstep(0.33, 0.40, hh), 2.0));
    vec3 rockC = mix(rock, mix(rock, cliffB, step(0.5, fract(hh*14.0 + det*0.5))), strata);   // strata on banded rock (mesa, chalk)
    col = mix(col, rockC*(0.85 + det*0.3), st(smoothstep(rockAt, rockAt + 0.06, hh), 2.0));
    col = mix(col, peak, st(smoothstep(mix(0.88, 0.74, snowK), mix(0.92, 0.78, snowK), hh), 2.0));
    col = mix(col, snow, st(snowK*smoothstep(snowLo, snowLo + 0.16, hh)*smoothstep(0.75, 0.95, n.z)*0.85, 2.0));
    float cliff = st(smoothstep(0.8, 0.66, n.z)*smoothstep(0.05, 0.1, hh), 2.0);    // steep faces show bare, banded rock
    col = mix(col, mix(cliffA, cliffB, st(fract(hh*28.0 + det*0.6), 2.0))*(0.9 + 0.2*hash(q))*cliffDim, cliff);
    float avg = (H(p + vec2(5, 0)) + H(p - vec2(5, 0)) + H(p + vec2(0, 5)) + H(p - vec2(0, 5)))*0.25;
    float ao = 0.62 + 0.38*st(clamp(1.0 - (avg - h)*6.0, 0.62, 1.0)*2.63 - 1.63, 3.0);
    float diff = st(max(dot(n, uSun), 0.0), 4.0), tsh = st(terrainShadow(p, h)/0.8, 3.0)*0.8;   // stepped like the voxel faces
    vec3 light = uAmb*ao*(0.8 + 0.2*n.z) + uSunC*diff*sunVis*(1.0 - tsh);
    light += stL(pointLights(vec3(p, 0.0), n), 5.0);
    col *= light;
    col += flowerC*flower*glow*(0.25 + 1.1*uNight);              // glowing caps on the fungal isles
    // a volcano's crater: a dip at the top of a tall ember-isle peak, its floor glowing lava that pulses slowly
    float lava = 0.0;
    if (bm.z > 0.4 && h > 0.95){                                  // only a wide, deep dip near the top: the crater
      float wide = (H(p + vec2(10, 0)) + H(p - vec2(10, 0)) + H(p + vec2(0, 10)) + H(p - vec2(0, 10)))*0.25;
      lava = st(smoothstep(0.4, 0.7, bm.z)*smoothstep(0.05, 0.12, wide - h), 2.0);
    }
    col = mix(col, mix(vec3(1.0, .42, .12), vec3(1.0, .72, .25), step(0.6, hash(floor(p*0.5 + uT*0.6))))*(0.85 + 0.15*sin(uT*1.7)), lava);
    float wetk = smoothstep(0.035, 0.0, h);                     // wet sand glistens
    col += uSunC*wetk*st(pow(max(dot(reflect(-uSun, n), normalize(vec3(0, .55, .85))), 0.0), 30.0), 2.0)*0.3*sunVis;
  } else {
    float depth = -h, e = 0.7;
    float wx = waveH(p + vec2(e, 0)) - waveH(p - vec2(e, 0)), wy = waveH(p + vec2(0, e)) - waveH(p - vec2(0, e));
    vec3 n = normalize(vec3(-wx*0.5, -wy*0.5, 1.0)), nS = n;
    // fine wind ripples on top of the swell (used for shading, not for the sharp highlight)
    // never finer than ~3 screen pixels, or the crests crawl as the camera moves
    vec2 rq = p*0.42*min(1.0, 0.75/pw) + uWD*uT*0.9; float r0 = noise(rq), rx = noise(rq + vec2(0.3, 0.0)), ry = noise(rq + vec2(0.0, 0.3));
    n = normalize(n + vec3(-(rx - r0), -(ry - r0), 0.0)*(0.9 + uWind*0.9));
    vec2 fp = 1.0/vec2(textureSize(uFoam, 0));
    vec4 fo = texture(uFoam, tu);
    float fdx = texture(uFoam, tu + vec2(fp.x*2.0, 0)).g - texture(uFoam, tu - vec2(fp.x*2.0, 0)).g;
    float fdy = texture(uFoam, tu + vec2(0, fp.y*2.0)).g - texture(uFoam, tu - vec2(0, fp.y*2.0)).g;
    n = normalize(n + vec3(-fdx, -fdy, 0.0)*2.5); nS = normalize(nS + vec3(-fdx, -fdy, 0.0)*2.5);
    float splash = 0.0;
    if (uRain > 0.01){
      n = normalize(n + vec3(ripples(p), 0.0)*uRain*0.7);
      // a drop landing: one bright art pixel that opens to its four neighbours and fades
      // (a fresh spot each time, so the rings never stand in a grid)
      vec2 g = floor(p/7.0), f = floor(p) - g*7.0; float cyc = uT*1.8 + hash(g + 11.0)*7.0, ph = fract(cyc); vec2 id = g + floor(cyc)*vec2(5.17, 2.83);
      float d = length(f + 0.5 - (floor(vec2(hash(id + 5.3), hash(id + 9.1))*5.0) + 1.5));
      splash = step(hash(id + 1.3), 0.14*uRain)*step(abs(d - ph*2.2), 0.45)*(1.0 - ph*1.8)*step(ph, 0.5);   // a plink that opens to a tiny cross and is gone
    }
    vec3 shallowC = mix(mix(vec3(.34,.66,.70), vec3(.24,.80,.78), wm), vec3(.40,.56,.62), cd);
    vec3 midC     = mix(mix(vec3(.17,.43,.55), vec3(.07,.53,.62), wm), vec3(.22,.36,.46), cd);
    vec3 deepC    = mix(mix(vec3(.07,.22,.35), vec3(.03,.27,.42), wm), vec3(.10,.18,.27), cd);
    // biomes: turquoise lagoons over reefs, dark green-teal over kelp, inky blue around the ember isles
    shallowC = mix(mix(mix(shallowC, vec3(.30,.86,.82), bm.x), vec3(.22,.44,.40), bm.y), vec3(.24,.46,.56), bm.z);
    midC = mix(mix(mix(midC, vec3(.09,.60,.68), bm.x), vec3(.11,.34,.37), bm.y), vec3(.09,.28,.40), bm.z);
    deepC = mix(mix(mix(deepC, vec3(.04,.30,.46), bm.x*0.6), vec3(.06,.18,.23), bm.y*0.7), vec3(.05,.15,.26), bm.z*0.7);
    // murky olive-brown mangrove channels; dark steel-blue water in the far north
    shallowC = mix(shallowC, vec3(.42,.46,.25), mg); midC = mix(midC, vec3(.24,.34,.22), mg); deepC = mix(deepC, vec3(.11,.22,.17), mg*0.85);
    float ice = smoothstep(0.3, 0.8, cd);
    midC = mix(midC, vec3(.16,.28,.39), ice*0.6); deepC = mix(deepC, vec3(.06,.12,.20), ice*0.8);
    float clarK = 1.0;
    if (tw > 0.004){                                              // the island's own water: lagoon, fjord, glacier milk, bog tea
      float ww = tw*tw*clamp(0.6 + 0.8*noise(p*0.012 + 5.0), 0.0, 1.0);   // strongest by the shore, frayed further out (no hard disc)
      shallowC = mix(shallowC, PAL(ti, 10).rgb, tw); midC = mix(midC, PAL(ti, 11).rgb, ww); deepC = mix(deepC, PAL(ti, 12).rgb, ww*0.5);
      clarK = mix(1.0, PAL(ti, 15).x*2.0, tw);
    }
    // depth reads as a few flat bands of colour, like a hand-painted chart; trenches and holes go darker still
    float vd = seaDepth(p, depth);
    vec3 wc = mix(midC, shallowC, st(smoothstep(0.2, 0.0, vd), 3.0));
    wc = mix(deepC, wc, st(smoothstep(0.55, 0.12, vd), 3.0));
    wc *= mix(1.0, 0.6, st(smoothstep(0.6, 1.15, vd), 3.0));
    float clr = max(wm, bm.x);
    float clarity = st(exp(-vd*mix(mix(7.5, 5.5, wm), 4.6, bm.x)), 4.0)*mix(0.72, 0.9, clr)*mix(1.0, 0.72, bm.y)*mix(1.0, 0.45, mg)*clarK;   // tropical water and reefs are clearer, mangrove water murky
    if (clarity > 0.0){
      vec4 bed = seabed(p, depth, wm, cd, bm, mg);
      wc = mix(wc, bed.rgb*(0.72 + 0.6*st(caustic(p + n.xy*4.0), 2.0)*(1.0 - uNight)*(1.0 - cloud*0.5))*vec3(0.78, 0.96, 0.96), min(0.92, clarity + bed.a));
    }
    wc *= 0.9 + 0.2*st(fbm(p*0.018 + vec2(uT*0.01, 0.0)), 3.0);        // broad blotches of lighter and darker water
    vec3 V = normalize(vec3(0.0, 0.55, 0.85));
    vec3 Rv = reflect(-V, n);
    float fres = 0.06 + 0.94*pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 skyR = uSky*(0.8 + 0.4*smoothstep(-0.1, 0.5, -Rv.y));
    vec3 Lp = stL(pointLights(vec3(p, 0.0), n), 6.0);           // lamp pools step out in rings
    vec3 light = uAmb + uSunC*(0.55 + 0.32*st(max(dot(nS, uSun), 0.0), 3.0) + 0.13*max(dot(n, uSun), 0.0))*sunVis + Lp*0.3;
    float tsh = depth < 0.22 ? st(terrainShadow(p, 0.0)/0.8, 3.0)*0.64 : 0.0;
    col = wc*light*(1.0 - tsh*0.7) + skyR*fres*0.7*(1.0 - cloud*0.35);
    col += uSunC*st(sunShafts(p), 2.0)*0.045*smoothstep(0.08, 0.3, vd)*smoothstep(1.1, 0.4, vd)*sunVis*(1.0 - uNight);
    col *= mix(vec3(1.0), vec3(1.0, 0.86, 0.62), clamp(Lp.r*0.7, 0.0, 1.0));   // lamplight outshines the cold night base
    col += Lp*(0.3 + 0.1*fres);                                         // and glows amber on the surface
    float sd = max(dot(reflect(-uSun, nS), V), 0.0);
    col += uSunC*st(pow(sd, 36.0), 2.0)*0.7*sunVis*(1.0 - tsh);
    float golden = smoothstep(0.62, 0.36, uSun.z)*(1.0 - uNight);             // low sun: warm sheen across the water
    col += uSunC*golden*st(pow(sd, 30.0), 3.0)*1.3*sunVis;
    col += uSunC*glints(p, pw)*(0.35 + 0.65*smoothstep(0.55, 0.95, sd))*2.2*(1.0 - glintSh*0.6)*(1.0 - cloud*0.55)*(1.0 - tsh)*smoothstep(0.04, 0.2, depth)*(1.0 - cloud*0.6);
    col += Lp*st(pow(max(dot(reflect(-normalize(vec3(0.0, -0.3, 1.0)), nS), V), 0.0), 12.0), 4.0)*0.35;   // warm glints in the lamp pool
    float edge = smoothstep(0.03, 0.0, depth);
    float roll = sin(depth*150.0 - uT*2.3 + fbm(p*0.05)*8.0);
    float breakers = smoothstep(0.55, 0.95, roll)*smoothstep(0.11, 0.015, depth);
    float caps = smoothstep(0.74, 0.84, fbm(p*0.09 + uWD*uT*0.6))*smoothstep(0.35, 0.9, uWind)*smoothstep(0.05, 0.2, depth);
    float foam = clamp(edge + breakers*0.75 + caps*0.9 + fo.r*1.2, 0.0, 1.0);
    foam *= 0.55 + 0.45*noise(p*0.9 + uT*0.3);
    foam = uPx > 0.0 ? st(smoothstep(0.12, 0.7, foam), 2.0) : foam;   // crisp pixel foam: solid, half (dithered) or none
    vec3 foamC = vec3(0.95, 0.98, 0.98)*(uAmb*1.1 + uSunC*sunVis*0.85 + Lp);
    col = mix(col, foamC, foam);
    col = mix(col, foamC, splash*0.45);                               // rain rings
    // shelves of sea ice along the far northern shores, with a crack here and there
    float shelfE = depth + (noise(p*0.07) - 0.5)*0.05;
    float shelf = st(ice*smoothstep(0.045, 0.02, shelfE)*step(0.38, noise(p*0.011 + 5.0)), 2.0);
    if (shelf > 0.0){
      vec3 iceC = mix(vec3(.80,.89,.95), vec3(.93,.97,1.0), step(0.5, hash(floor(p*0.5))))*(1.0 - 0.25*step(0.92, noise(p*0.4 + 2.0)));
      iceC = mix(iceC, vec3(.55,.74,.86), st(smoothstep(0.035, 0.045, shelfE), 2.0));   // the blue lip at the edge
      col = mix(col, iceC*(uAmb*1.05 + uSunC*sunVis*0.85 + Lp), shelf);
    }
  }
  col *= 1.0 - cloud*0.12;
  col += vec3(0.85, 0.9, 1.0)*uFlash*0.5;
  outC = vec4(col, 0.0);                                         // alpha 0: ground (meshes write 1, for outlines)
}`;

export const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec4 aCol;
layout(location=3) in vec4 aI0; layout(location=4) in vec4 aI1; layout(location=5) in vec4 aIT;
uniform vec4 uCam, uHR; uniform vec2 uShXY; uniform int uMode;
out vec3 vW; out vec3 vN; out vec4 vC; out float vG; out float vK;
void main(){
  vG = aI1.w; vK = aIT.a;
  vec3 q = aPos*aI0.w, nn = aNor;
  float cp = cos(aI1.y), sp = sin(aI1.y), cr = cos(aI1.z), sr = sin(aI1.z);
  q = vec3(q.x, q.y*cr - q.z*sr, q.y*sr + q.z*cr); nn = vec3(nn.x, nn.y*cr - nn.z*sr, nn.y*sr + nn.z*cr);   // roll
  q = vec3(q.x*cp - q.z*sp, q.y, q.x*sp + q.z*cp); nn = vec3(nn.x*cp - nn.z*sp, nn.y, nn.x*sp + nn.z*cp);   // pitch
  float c = cos(aI0.z), s = sin(aI0.z);
  vec3 w = vec3(aI0.x + q.x*c - q.y*s, aI0.y + q.x*s + q.y*c, q.z + aI1.x);
  vN = vec3(nn.x*c - nn.y*s, nn.x*s + nn.y*c, nn.z); vW = w; vC = vec4(aCol.rgb*aIT.rgb, aCol.a);
  if (uMode == 1){ vec2 g = w.xy - uShXY*max(w.z, 0.0); gl_Position = vec4(((g - uHR.xy)/uHR.zw)*2.0 - 1.0, 0.0, 1.0); }
  else gl_Position = vec4((w.x - uCam.x)/uCam.z*2.0 - 1.0, 1.0 - (w.y - w.z - uCam.y)/uCam.w*2.0, 1.0 - ((w.y - uCam.y) + w.z + 90.0)/(uCam.w + 280.0)*2.0, 1.0);
}`;
export const MESH_FS = `#version 300 es
precision highp float; precision highp int;
in vec3 vW; in vec3 vN; in vec4 vC; in float vG; in float vK; out vec4 o;
uniform int uMode; uniform vec3 uSun, uSunC, uAmb, uWater; uniform float uNight;
uniform sampler2D uH; uniform vec4 uHT;
${LIGHTS}${STYLE}
// vC.a marks glowable voxels (lamps, photophores, jellies); vG is the instance's glow (1 for lamps, 0..1 for sea life);
// vK is how fast the instance fades into the water below the waterline (1 for hulls, less for big pale sea life)
void main(){
  if (uMode == 1){ o = vec4(1.0); return; }
  vec3 n = normalize(vN);
  vec3 light = uAmb*(0.72 + 0.28*n.z) + uSunC*st(max(dot(n, uSun), 0.0), 3.0) + stL(pointLights(vW, n), 5.0);
  vec3 col = vC.rgb*light;
  float glow = clamp(vC.a*vG, 0.0, 1.0), sub = 0.0;
  col = mix(col, vC.rgb*(1.6 + uNight*2.2), glow);
  if (vW.z < 0.9){                                  // below the waterline: fade into the water colour, darker with depth
    float h = texture(uH, (vW.xy - uHT.xy)/uHT.zw).r;
    if (h < 0.0){
      sub = st(clamp((0.9 - vW.z)*0.32*vK, 0.0, 0.88), 4.0);
      vec3 wcol = uWater*mix(vec3(1.0), vec3(0.41, 0.51, 0.64), st(smoothstep(0.12, 0.55, -h), 3.0));   // the ground's mid/deep bands
      col = mix(col, wcol*(uAmb + uSunC*0.7)*(1.0 - 0.3*clamp((-2.0 - vW.z)/6.0, 0.0, 1.0)), sub);
      col += vC.rgb*glow*(1.4 + uNight*2.0)*exp(vW.z*0.12)*sub;       // glowing things shine up through the water
    }
  }
  o = vec4(col, 1.0 - sub);                          // alpha: how solid this pixel is, for the pixel outline
}`;

// A lighthouse beam: a wedge of light in the air at the lantern's height, one instance per beam, drawn after the
// meshes with the depth test on (no depth write), so it passes over the trees below the lamp and behind the tower
// itself. Its depth is the meshes' formula at that height.
export const BEAM_VS = `#version 300 es
uniform vec4 uCam; uniform vec4 uB[6]; uniform float uBZ[6];
out vec2 vP; flat out int vI;
void main(){
  int i = gl_InstanceID; vec4 B = uB[i]; float z = uBZ[i]; vec2 p = B.xy;
  if (gl_VertexID > 0){ float a = B.z + (gl_VertexID == 1 ? -0.26 : 0.26); p += vec2(cos(a), sin(a))*B.w*1.04; }
  vP = p; vI = i;
  gl_Position = vec4((p.x - uCam.x)/uCam.z*2.0 - 1.0, 1.0 - (p.y - z - uCam.y)/uCam.w*2.0, 1.0 - ((p.y - uCam.y) + z + 90.0)/(uCam.w + 280.0)*2.0, 1.0);
}`;
export const BEAM_FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vP; flat in int vI; out vec4 o;
uniform vec4 uB[6]; uniform float uNight, uBK;
${STYLE}
void main(){
  vec4 B = uB[vI]; vec2 dv = vP - B.xy; float d = length(dv);
  float a = atan(dv.y, dv.x) - B.z; a = mod(a + 3.14159, 6.28318) - 3.14159;
  float b = smoothstep(0.22, 0.0, abs(a))*smoothstep(B.w, B.w*0.15, d)*smoothstep(3.0, 14.0, d);
  o = vec4(vec3(1.0, .84, .58)*st(b, 3.0)*(0.06 + uNight*0.5)*uBK, 0.0);
}`;

// soft discs/rings stamped into a world-aligned buffer: R = foam, G = ripple height
export const FOAM_VS = `#version 300 es
layout(location=0) in vec4 aP;   // x, y, size (long axis), alpha
layout(location=1) in vec4 aQ;   // kind (0 disc, 1 ring), heading, aspect (short/long), foam share
uniform vec4 uHR; uniform float uPx;
out float vA; flat out vec4 vQ;
void main(){ vA = aP.w; vQ = aQ; gl_Position = vec4(((aP.xy - uHR.xy)/uHR.zw)*2.0 - 1.0, 0.0, 1.0); gl_PointSize = aP.z*uPx; }`;
export const FOAM_FS = `#version 300 es
precision mediump float; precision highp int;
in float vA; flat in vec4 vQ; out vec4 o;
void main(){
  vec2 q = (gl_PointCoord*2.0 - 1.0)*vec2(1.0, -1.0);          // point sprites run top-down; the buffer is world-up
  float c = cos(vQ.y), s = sin(vQ.y); q = vec2(q.x*c + q.y*s, -q.x*s + q.y*c);
  float d = length(q/vec2(1.0, max(vQ.z, 0.05))); if (d > 1.0) discard;
  float a = vQ.x > 0.5 ? smoothstep(0.16, 0.0, abs(d - 0.84)) : smoothstep(1.0, 0.1, d);
  o = vec4(a*vA*vQ.w, a*vA*(vQ.x > 0.5 ? 0.9 : 0.4), 0.0, 1.0); }`;

// coloured particles drawn in the scene (sparks, debris, spray)
export const PART_VS = `#version 300 es
layout(location=0) in vec4 aP; layout(location=1) in vec4 aC; layout(location=2) in float aS;   // x, y, z, size ; rgba ; style
uniform vec4 uCam; uniform float uPpu; out vec4 vC; flat out float vS;
// points smaller than ~2.5 pixels pop on and off as they cross pixel centres; keep them at least that big and
// dim them to keep the same total light
// depth as the meshes have it, a unit above the particle, so a hull or tree in front of it covers it
void main(){ vC = aC; vS = aS; float z = aP.z + 1.0;
  gl_Position = vec4((aP.x - uCam.x)/uCam.z*2.0 - 1.0, 1.0 - (aP.y - aP.z - uCam.y)/uCam.w*2.0, 1.0 - ((aP.y - uCam.y) + z + 90.0)/(uCam.w + 280.0)*2.0, 1.0);
  float s = aP.w*uPpu, sz = max(s, 2.5); vC.a *= min(1.0, (s*s)/(sz*sz)*1.6); gl_PointSize = sz; }`;
export const PART_FS = `#version 300 es
precision highp float; precision highp int;
in vec4 vC; flat in float vS; out vec4 o;
uniform vec3 uSun, uSunC, uAmb;
${STYLE}
void main(){
  vec2 q = gl_PointCoord*2.0 - 1.0; float d = length(q); if (d > 1.0) discard;
  if (vS > 0.5 && vS < 1.5){                                    // smoke puff: a little lit ball, stepped like the voxels
    vec3 n = normalize(vec3(q.x, q.y, sqrt(max(0.0, 1.0 - d*d)) + 0.3));
    float lit = st(max(dot(n, normalize(uSun)), 0.0), 3.0);
    vec3 c = vC.rgb*(uAmb*1.1 + uSunC*lit*0.85);
    float a = vC.a*(uPx > 0.0 ? 1.0 : smoothstep(1.0, 0.75, d));
    o = vec4(c, st(a, 3.0)); return; }
  float a = vC.a*smoothstep(1.0, 0.4, d);
  if (vS > 1.5) a = vC.a*(uPx > 0.0 ? st(smoothstep(1.0, 0.0, d), 2.0) : smoothstep(1.0, 0.0, d));   // glow: bright pixel core
  o = vec4(vC.rgb, a); }`;

// ---- post ----
// A frame uses the bottom-left uUVS share of its buffers (the view can be smaller than the buffers), so post passes
// read at vUV*uUVS; the blur stays inside that share.
// The bright parts of the scene, straight to quarter size: the threshold is taken at the four half-size points a
// quarter pixel covers (each a bilinear average of the scene), then averaged.
export const BRIGHT_FS = `#version 300 es
precision highp float; precision highp int; in vec2 vUV; out vec4 o; uniform sampler2D uT; uniform float uTh; uniform vec2 uUVS;
vec3 bright(vec2 uv){ vec3 c = texture(uT, uv*uUVS).rgb; float l = max(max(c.r, c.g), c.b); return c*smoothstep(uTh, uTh + 0.5, l); }
void main(){ vec2 d = 0.25*vec2(dFdx(vUV.x), dFdy(vUV.y));
  o = vec4((bright(vUV - d) + bright(vUV + d) + bright(vUV + vec2(d.x, -d.y)) + bright(vUV + vec2(-d.x, d.y)))*0.25, 1.0); }`;
export const BLUR_FS = `#version 300 es
precision highp float; precision highp int; in vec2 vUV; out vec4 o; uniform sampler2D uT; uniform vec2 uDir, uUVS;
vec3 tap(vec2 uv, vec2 lim){ return texture(uT, min(uv, lim)).rgb; }
void main(){ vec2 uv = vUV*uUVS, lim = uUVS - 0.5/vec2(textureSize(uT, 0)); vec3 c = tap(uv, lim)*0.227;
  c += (tap(uv + uDir*1.385, lim) + tap(uv - uDir*1.385, lim))*0.316;
  c += (tap(uv + uDir*3.231, lim) + tap(uv - uDir*3.231, lim))*0.070;
  o = vec4(c, 1.0); }`;
export const COMPOSITE_FS = `#version 300 es
precision highp float; precision highp int; in vec2 vUV; out vec4 o;
uniform sampler2D uScene, uBloom, uBlur;
uniform float uT, uExp, uSat, uVig, uTilt, uGrain, uRain, uDrops, uFlash, uBloomK, uSlant, uGrade, uDusk;
uniform vec3 uTint; uniform vec2 uRes, uUVS; uniform float uQ, uInk; uniform vec4 uCam, uFogC, uHazeC;
${STYLE}${NOISE}// rain: thin streaks falling at a slant with the wind, in three layers (near ones longer, faster and brighter). Each
// drop lives a moment: it falls a short way, fades and comes back somewhere new, so the rain never reads as one sheet
// sliding past. Placed in world space (the sea scrolls under it as you sail) and snapped to the art grid.
float rainDrops(vec2 p, float amt){
  float s = 0.0;
  vec2 dir = normalize(vec2(uSlant*0.45, 1.0));
  for (int L = 0; L < 3; L++){
    float near = 1.0 - float(L)*0.5;
    float cell = mix(11.0, 20.0, near), len = mix(4.0, 11.0, near), sp = mix(110.0, 230.0, near), life = mix(0.45, 0.3, near);
    vec2 q = floor(p - dir*sp*uT) + 0.5, c = floor(q/cell), f = q - c*cell;   // the falling frame, cut into cells
    float r = hash(c + 31.0*float(L)), cyc = uT/life + r, k = floor(cyc), ph = fract(cyc);
    vec2 id = c + k*vec2(7.13, 3.71);                                   // a new drop each life, somewhere new in its cell
    if (hash(id + 1.7) > amt*mix(0.5, 0.3, near)) continue;
    vec2 head = vec2(len*dir.x + 1.0, len + 1.0) + floor(vec2(hash(id + 3.1), hash(id + 7.7))*(cell - len - 2.0));
    vec2 d = f - head; float t = -dot(d, dir), side = abs(d.x*dir.y - d.y*dir.x);
    if (t < 0.0 || t > len || side > 0.55) continue;
    float env = smoothstep(0.0, 0.2, ph)*smoothstep(1.0, 0.65, ph);    // fades in and out over its life
    s = max(s, mix(0.16, 0.38, near)*(1.0 - 0.75*t/len)*env);           // bright at the head, a fading tail
  }
  return s; }
vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }
// procedural film LUT on display-referred colour: soft S-curve, teal-navy lifted blacks, warm highlights,
// gentle saturation roll-off at the extremes, warmer at dusk
vec3 grade(vec3 c, float k){
  vec3 g = mix(c, c*c*(3.0 - 2.0*c), 0.22);
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  float sh = (1.0 - l)*(1.0 - l), hi = smoothstep(0.45, 1.0, l);
  g += vec3(0.010, 0.030, 0.045)*sh;
  g *= mix(vec3(1.0), vec3(1.05, 1.01, 0.93), hi*0.55);
  g *= mix(vec3(1.0), vec3(1.08, 1.0, 0.89), uDusk*0.7);
  float ch = max(max(g.r, g.g), g.b) - min(min(g.r, g.g), g.b);
  float roll = 0.22*smoothstep(0.45, 0.9, ch) + 0.18*smoothstep(0.75, 1.0, l);
  l = dot(g, vec3(0.2126, 0.7152, 0.0722)); g = mix(g, vec3(l), roll);
  return mix(c, clamp(g, 0.0, 1.0), k); }
void main(){
  vec2 uv = vUV, tuv = vUV*uUVS;                                        // uv: position on screen; tuv: in the buffers
  vec4 s0 = texture(uScene, tuv); vec3 c = s0.rgb;
  float tb = smoothstep(0.2, 0.5, abs(uv.y - 0.5))*uTilt;               // miniature tilt-shift
  if (tb > 0.0) c = mix(c, textureLod(uBlur, tuv, 0.0).rgb, tb);
  if (uInk > 0.0){                                                      // a one-pixel ink edge where solid voxels meet the ground or water
    vec2 tx = 1.0/vec2(textureSize(uScene, 0));
    float nb = max(max(texture(uScene, tuv + vec2(tx.x, 0)).a, texture(uScene, tuv - vec2(tx.x, 0)).a), max(texture(uScene, tuv + vec2(0, tx.y)).a, texture(uScene, tuv - vec2(0, tx.y)).a));
    float edge = step(0.5, nb)*step(s0.a, 0.35)*smoothstep(0.5, 1.0, nb);
    c = mix(c, c*vec3(0.36, 0.42, 0.48), edge*uInk);
  }
  if (uBloomK > 0.0) c += texture(uBloom, tuv).rgb*uBloomK;
  if (uFogC.a > 0.01){                                                  // fog banks drifting over fjords and bogs, never over the boat
    vec2 wp = uCam.xy + vec2(uv.x, 1.0 - uv.y)*uCam.zw;
    float f = fbm(wp*0.0045 + vec2(uT*0.011, uT*0.004)) + (fbm(wp*0.022 - uT*0.04) - 0.5)*0.45;   // banks with wispy edges
    float bank = smoothstep(0.3, 0.9, f);
    float open = smoothstep(0.08, 0.4, length((uv - 0.5)*vec2(1.6, 1.0)));
    c = mix(c, uFogC.rgb, uFogC.a*bank*bank*open*0.4);
  }
  if (uHazeC.a > 0.01) c = mix(c, uHazeC.rgb, uHazeC.a*(0.04 + 0.08*uv.y));   // warm haze, thicker toward the horizon
  if (uRain > 0.01){
    // wet light: cooler and a little flatter, rather than a grey wash
    float lr = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, vec3(lr), 0.2*uRain)*mix(vec3(1.0), vec3(0.9, 0.95, 1.02), uRain);
    vec2 wp = uCam.xy + vec2(uv.x, 1.0 - uv.y)*uCam.zw;              // the world point under this pixel
    c = mix(c, vec3(0.84, 0.9, 0.96), rainDrops(wp, uDrops));
  }
  c *= uExp*uTint;
  float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uSat);
  c = grade(aces(c), uGrade);
  c *= mix(1.0, smoothstep(1.3, 0.3, length((uv - 0.5)*vec2(1.3, 1.0))), uVig);
  c += (hash(uv*uRes + fract(uT)*91.0) - 0.5)*uGrain;
  if (uQ > 0.0) c = floor(c*uQ + 0.5)/uQ;                               // gentle shared palette: uQ flat levels per channel, no dither
  c += uFlash*0.25;
  o = vec4(c, 1.0);
}`;
export const COPY_FS = `#version 300 es
precision highp float; precision highp int; in vec2 vUV; out vec4 o; uniform sampler2D uT; uniform vec2 uUVS;
void main(){ o = texture(uT, vUV*uUVS); }`;
// The pixel-style frame scaled up to the canvas. uMap: device position (y up) of the frame's corner, and device pixels
// per frame pixel. Each device pixel samples its frame pixel's centre, except within half a device pixel of a pixel
// edge, where the linear filter blends the two: hard pixels at whole-number scales, even ones in between.
export const PRESENT_FS = `#version 300 es
precision highp float; precision highp int; out vec4 o; uniform sampler2D uT; uniform vec4 uMap;
void main(){
  vec2 t = (gl_FragCoord.xy - uMap.xy)/uMap.z, fl = floor(t), d = t - fl - 0.5, r = vec2(0.5 - 0.5/uMap.z);
  o = texture(uT, (fl + 0.5 + (d - clamp(d, -r, r))*uMap.z)/vec2(textureSize(uT, 0))); }`;
