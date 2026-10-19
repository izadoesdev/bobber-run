// GLSL for the renderer. World: x right, y down (south), z up. The camera looks from the south and
// above, so a point (x,y,z) lands on screen at (x, y - z) and is nearer the more (y + z) it has.
const NOISE = `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a*noise(p); p = p*2.03 + vec2(17.1, 9.3); a *= 0.5; } return s; }
`;
const LIGHTS = `
uniform int uNL; uniform vec4 uL[16]; uniform vec3 uLC[16];
uniform int uNB; uniform vec4 uB[6];
vec3 pointLights(vec3 p, vec3 n){ vec3 acc = vec3(0.0);
  for (int i = 0; i < 16; i++){ if (i >= uNL) break; vec4 L = uL[i]; vec3 lp = vec3(L.xy, 7.0); vec3 d = lp - p; float r = length(d.xy);
    float k = clamp(1.0 - r/L.z, 0.0, 1.0); acc += uLC[i]*L.w*k*k*(0.35 + 0.65*max(dot(n, normalize(d)), 0.0)); }
  return acc; }
float beams(vec2 p){ float b = 0.0;
  for (int i = 0; i < 6; i++){ if (i >= uNB) break; vec4 B = uB[i]; vec2 dv = p - B.xy; float d = length(dv);
    float a = atan(dv.y, dv.x) - B.z; a = mod(a + 3.14159, 6.28318) - 3.14159;
    b += smoothstep(0.22, 0.0, abs(a))*smoothstep(B.w, B.w*0.15, d)*smoothstep(3.0, 14.0, d); }
  return b; }
`;
export const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aP; out vec2 vUV;
void main(){ vUV = aP*0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;

export const GROUND_FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vUV; out vec4 outC;
uniform sampler2D uH, uFoam, uShadow;
uniform vec4 uHR, uCam;
uniform float uT, uWT, uWind, uRain, uNight, uCloud, uFlash;
uniform vec2 uWD; uniform vec3 uSun, uSunC, uAmb, uSky;
${NOISE}${LIGHTS}
const float HS = 40.0;
float H(vec2 w){ return texture(uH, (w - uHR.xy + 0.5)/uHR.zw).r; }
vec2 TUV(vec2 w){ return (w - uHR.xy + 0.5)/uHR.zw; }
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
float sparkle(vec2 p){
  vec2 g = p/2.6, c = floor(g), f = fract(g);
  float r = hash(c), r2 = hash(c + 11.3);
  vec2 pt = vec2(hash(c + 3.7), hash(c + 8.1))*0.7 + 0.15;
  float tw = pow(max(0.0, sin(uT*(2.0 + r*3.0) + r2*40.0)), 14.0);
  return step(0.62, r)*smoothstep(0.17, 0.0, length(f - pt))*tw; }
float terrainShadow(vec2 p, float h0){
  vec2 sd = normalize(uSun.xy + 1e-4); float tanE = uSun.z/max(length(uSun.xy), 1e-3), s = 0.0;
  for (int i = 1; i <= 10; i++){ float d = float(i)*3.0; if (H(p + sd*d)*HS > h0*HS + d*tanE + 0.4) s += 0.11; }
  return min(s, 0.8); }
void main(){
  vec2 p = uCam.xy + vec2(vUV.x, 1.0 - vUV.y)*uCam.zw;
  float h = H(p), wm = warm(p.y), cd = cold(p.y);
  vec2 tu = TUV(p), tp = 1.0/vec2(textureSize(uShadow, 0));
  float objSh = (texture(uShadow, tu).r*2.0 + texture(uShadow, tu + vec2(tp.x*2.0, 0)).r + texture(uShadow, tu - vec2(tp.x*2.0, 0)).r
               + texture(uShadow, tu + vec2(0, tp.y*2.0)).r + texture(uShadow, tu - vec2(0, tp.y*2.0)).r)/6.0;
  float cloud = smoothstep(0.42, 0.78, fbm(p*0.0032 + uWD*uT*0.004))*uCloud;
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
    vec3 rock = vec3(.52,.55,.58), snow = vec3(.93,.95,.97), peak = mix(vec3(.68,.70,.72), snow, cd);
    col = mix(wet, sand, smoothstep(0.02, 0.045, hh));
    col = mix(col, grass*(0.85 + det2*0.3), smoothstep(0.09, 0.13, hh));
    col = mix(col, forest*(0.8 + det2*0.35), smoothstep(0.33, 0.40, hh));
    col = mix(col, rock*(0.85 + det*0.3), smoothstep(mix(0.72, 0.6, cd), mix(0.78, 0.66, cd), hh));
    col = mix(col, peak, smoothstep(mix(0.88, 0.74, cd), mix(0.92, 0.78, cd), hh));
    col = mix(col, snow, cd*smoothstep(0.42, 0.58, hh)*smoothstep(0.75, 0.95, n.z)*0.85);
    float avg = (H(p + vec2(5, 0)) + H(p - vec2(5, 0)) + H(p + vec2(0, 5)) + H(p - vec2(0, 5)))*0.25;
    float ao = clamp(1.0 - (avg - h)*6.0, 0.62, 1.0);
    float diff = max(dot(n, uSun), 0.0), tsh = terrainShadow(p, h);
    vec3 light = uAmb*ao*(0.8 + 0.2*n.z) + uSunC*diff*sunVis*(1.0 - tsh);
    light += pointLights(vec3(p, 0.0), n) + vec3(1.0, .92, .7)*beams(p)*(0.12 + uNight*0.9);
    col *= light;
    float wetk = smoothstep(0.035, 0.0, h);                     // wet sand glistens
    col += uSunC*wetk*pow(max(dot(reflect(-uSun, n), normalize(vec3(0, .55, .85))), 0.0), 30.0)*0.3*sunVis;
  } else {
    float depth = -h, e = 0.7;
    float wx = waveH(p + vec2(e, 0)) - waveH(p - vec2(e, 0)), wy = waveH(p + vec2(0, e)) - waveH(p - vec2(0, e));
    vec3 n = normalize(vec3(-wx*0.5, -wy*0.5, 1.0)), nS = n;
    // fine wind ripples on top of the swell (used for shading, not for the sharp highlight)
    vec2 rq = p*0.42 + uWD*uT*0.9; float r0 = noise(rq), rx = noise(rq + vec2(0.3, 0.0)), ry = noise(rq + vec2(0.0, 0.3));
    n = normalize(n + vec3(-(rx - r0), -(ry - r0), 0.0)*(0.9 + uWind*0.9));
    vec2 fp = 1.0/vec2(textureSize(uFoam, 0));
    vec4 fo = texture(uFoam, tu);
    float fdx = texture(uFoam, tu + vec2(fp.x*2.0, 0)).g - texture(uFoam, tu - vec2(fp.x*2.0, 0)).g;
    float fdy = texture(uFoam, tu + vec2(0, fp.y*2.0)).g - texture(uFoam, tu - vec2(0, fp.y*2.0)).g;
    n = normalize(n + vec3(-fdx, -fdy, 0.0)*2.5); nS = normalize(nS + vec3(-fdx, -fdy, 0.0)*2.5);
    if (uRain > 0.01) n = normalize(n + vec3(ripples(p), 0.0)*uRain*0.7);
    vec3 shallowC = mix(mix(vec3(.34,.66,.70), vec3(.24,.80,.78), wm), vec3(.40,.56,.62), cd);
    vec3 midC     = mix(mix(vec3(.17,.43,.55), vec3(.07,.53,.62), wm), vec3(.22,.36,.46), cd);
    vec3 deepC    = mix(mix(vec3(.07,.22,.35), vec3(.03,.27,.42), wm), vec3(.10,.18,.27), cd);
    vec3 wc = mix(midC, shallowC, smoothstep(0.2, 0.0, depth));
    wc = mix(deepC, wc, smoothstep(0.55, 0.12, depth));
    vec3 bed = mix(mix(vec3(.80,.73,.54), vec3(.94,.90,.75), wm), vec3(.6,.6,.56), cd)*(0.72 + 0.6*caustic(p + n.xy*4.0)*(1.0 - uNight)*(1.0 - cloud*0.5));
    float clarity = exp(-depth*7.5)*mix(0.72, 0.9, wm);
    wc = mix(wc, bed*vec3(0.78, 0.96, 0.96), clarity);
    wc *= 0.9 + 0.2*fbm(p*0.018 + vec2(uT*0.01, 0.0));                // broad blotches of lighter and darker water
    vec3 V = normalize(vec3(0.0, 0.55, 0.85));
    vec3 Rv = reflect(-V, n);
    float fres = 0.06 + 0.94*pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 skyR = uSky*(0.8 + 0.4*smoothstep(-0.1, 0.5, -Rv.y));
    vec3 Lp = pointLights(vec3(p, 0.0), n);
    vec3 light = uAmb + uSunC*(0.55 + 0.45*max(dot(n, uSun), 0.0))*sunVis + Lp + vec3(1.0, .92, .7)*beams(p)*(0.12 + uNight*0.9);
    float tsh = depth < 0.22 ? terrainShadow(p, 0.0)*0.8 : 0.0;
    col = wc*light*(1.0 - tsh*0.7) + skyR*fres*0.7*(1.0 - cloud*0.35);
    float sd = max(dot(reflect(-uSun, nS), V), 0.0);
    col += uSunC*pow(sd, 36.0)*0.7*sunVis*(1.0 - tsh);
    float golden = smoothstep(0.62, 0.36, uSun.z)*(1.0 - uNight);             // low sun: warm sheen across the water
    col += uSunC*golden*pow(sd, 30.0)*1.3*sunVis;
    col += uSunC*sparkle(p)*(0.35 + 0.65*smoothstep(0.55, 0.95, sd))*2.2*sunVis*(1.0 - tsh)*smoothstep(0.04, 0.2, depth)*(1.0 - cloud*0.6);
    col += Lp*pow(max(dot(reflect(-normalize(vec3(0.0, -0.3, 1.0)), nS), V), 0.0), 12.0)*0.35;
    float edge = smoothstep(0.03, 0.0, depth);
    float roll = sin(depth*150.0 - uT*2.3 + fbm(p*0.05)*8.0);
    float breakers = smoothstep(0.55, 0.95, roll)*smoothstep(0.11, 0.015, depth);
    float caps = smoothstep(0.74, 0.84, fbm(p*0.09 + uWD*uT*0.6))*smoothstep(0.35, 0.9, uWind)*smoothstep(0.05, 0.2, depth);
    float foam = clamp(edge + breakers*0.75 + caps*0.9 + fo.r*1.2, 0.0, 1.0);
    foam *= 0.55 + 0.45*noise(p*0.9 + uT*0.3);
    vec3 foamC = vec3(0.95, 0.98, 0.98)*(uAmb*1.1 + uSunC*sunVis*0.85 + Lp);
    col = mix(col, foamC, foam);
  }
  col *= 1.0 - cloud*0.12;
  col += vec3(0.85, 0.9, 1.0)*uFlash*0.5;
  outC = vec4(col, 1.0);
}`;

export const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec4 aCol;
layout(location=3) in vec4 aI0; layout(location=4) in vec4 aI1; layout(location=5) in vec4 aIT;
uniform vec4 uCam, uHR; uniform vec2 uShXY; uniform int uMode;
out vec3 vW; out vec3 vN; out vec4 vC;
void main(){
  vec3 q = aPos*aI0.w, nn = aNor;
  float cp = cos(aI1.y), sp = sin(aI1.y), cr = cos(aI1.z), sr = sin(aI1.z);
  q = vec3(q.x, q.y*cr - q.z*sr, q.y*sr + q.z*cr); nn = vec3(nn.x, nn.y*cr - nn.z*sr, nn.y*sr + nn.z*cr);   // roll
  q = vec3(q.x*cp - q.z*sp, q.y, q.x*sp + q.z*cp); nn = vec3(nn.x*cp - nn.z*sp, nn.y, nn.x*sp + nn.z*cp);   // pitch
  float c = cos(aI0.z), s = sin(aI0.z);
  vec3 w = vec3(aI0.x + q.x*c - q.y*s, aI0.y + q.x*s + q.y*c, q.z + aI1.x);
  vN = vec3(nn.x*c - nn.y*s, nn.x*s + nn.y*c, nn.z); vW = w; vC = vec4(aCol.rgb*aIT.rgb, aCol.a);
  if (uMode == 1){ vec2 g = w.xy - uShXY*max(w.z, 0.0); gl_Position = vec4(((g - uHR.xy + 0.5)/uHR.zw)*2.0 - 1.0, 0.0, 1.0); }
  else gl_Position = vec4((w.x - uCam.x)/uCam.z*2.0 - 1.0, 1.0 - (w.y - w.z - uCam.y)/uCam.w*2.0, 1.0 - ((w.y - uCam.y) + w.z + 90.0)/(uCam.w + 280.0)*2.0, 1.0);
}`;
export const MESH_FS = `#version 300 es
precision highp float; precision highp int;
in vec3 vW; in vec3 vN; in vec4 vC; out vec4 o;
uniform int uMode; uniform vec3 uSun, uSunC, uAmb, uWater; uniform float uNight;
uniform sampler2D uH; uniform vec4 uHR;
${LIGHTS}
void main(){
  if (uMode == 1){ o = vec4(1.0); return; }
  vec3 n = normalize(vN);
  vec3 light = uAmb*(0.72 + 0.28*n.z) + uSunC*max(dot(n, uSun), 0.0) + pointLights(vW, n);
  vec3 col = vC.rgb*light;
  if (vC.a > 0.5) col = vC.rgb*(1.6 + uNight*2.2);
  if (vW.z < 0.9){                                  // below the waterline: fade into the water colour
    float h = texture(uH, (vW.xy - uHR.xy + 0.5)/uHR.zw).r;
    if (h < 0.0) col = mix(col, uWater*(uAmb + uSunC*0.55), clamp((0.9 - vW.z)*0.32, 0.0, 0.88));
  }
  o = vec4(col, 1.0);
}`;

// soft discs/rings stamped into a world-aligned buffer: R = foam, G = ripple height
export const FOAM_VS = `#version 300 es
layout(location=0) in vec4 aP;   // x, y, size, alpha
layout(location=1) in float aK;  // 0 disc, 1 ring
uniform vec4 uHR; uniform float uPx;
out float vA; out float vK;
void main(){ vA = aP.w; vK = aK; gl_Position = vec4(((aP.xy - uHR.xy + 0.5)/uHR.zw)*2.0 - 1.0, 0.0, 1.0); gl_PointSize = aP.z*uPx; }`;
export const FOAM_FS = `#version 300 es
precision mediump float; precision highp int;
in float vA; in float vK; out vec4 o;
void main(){ float d = length(gl_PointCoord*2.0 - 1.0); if (d > 1.0) discard;
  float a = vK > 0.5 ? smoothstep(0.22, 0.0, abs(d - 0.75)) : smoothstep(1.0, 0.1, d);
  o = vec4(a*vA, a*vA*(vK > 0.5 ? 0.9 : 0.4), 0.0, 1.0); }`;

// coloured particles drawn in the scene (sparks, debris, spray)
export const PART_VS = `#version 300 es
layout(location=0) in vec4 aP; layout(location=1) in vec4 aC;   // x, y, z, size ; rgba
uniform vec4 uCam; uniform float uPx; out vec4 vC;
void main(){ vC = aC; gl_Position = vec4((aP.x - uCam.x)/uCam.z*2.0 - 1.0, 1.0 - (aP.y - aP.z - uCam.y)/uCam.w*2.0, 0.0, 1.0); gl_PointSize = aP.w*uPx; }`;
export const PART_FS = `#version 300 es
precision mediump float; precision highp int;
in vec4 vC; out vec4 o;
void main(){ float d = length(gl_PointCoord*2.0 - 1.0); if (d > 1.0) discard; o = vec4(vC.rgb, vC.a*smoothstep(1.0, 0.4, d)); }`;

// ---- post ----
export const BRIGHT_FS = `#version 300 es
precision highp float; precision highp int; in vec2 vUV; out vec4 o; uniform sampler2D uT; uniform float uTh;
void main(){ vec3 c = texture(uT, vUV).rgb; float l = max(max(c.r, c.g), c.b); o = vec4(c*smoothstep(uTh, uTh + 0.5, l), 1.0); }`;
export const BLUR_FS = `#version 300 es
precision highp float; precision highp int; in vec2 vUV; out vec4 o; uniform sampler2D uT; uniform vec2 uDir;
void main(){ vec3 c = texture(uT, vUV).rgb*0.227;
  c += (texture(uT, vUV + uDir*1.385).rgb + texture(uT, vUV - uDir*1.385).rgb)*0.316;
  c += (texture(uT, vUV + uDir*3.231).rgb + texture(uT, vUV - uDir*3.231).rgb)*0.070;
  o = vec4(c, 1.0); }`;
export const COMPOSITE_FS = `#version 300 es
precision highp float; precision highp int; in vec2 vUV; out vec4 o;
uniform sampler2D uScene, uBloom, uBlur;
uniform float uT, uExp, uSat, uVig, uTilt, uGrain, uRain, uFlash, uBloomK, uSlant;
uniform vec3 uTint; uniform vec2 uRes;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec2 uv = vUV;
  vec2 ca = (uv - 0.5)*0.0018;                                          // faint lens fringing at the edges
  vec3 c = vec3(texture(uScene, uv + ca).r, texture(uScene, uv).g, texture(uScene, uv - ca).b);
  float tb = smoothstep(0.2, 0.5, abs(uv.y - 0.5))*uTilt;               // miniature tilt-shift
  c = mix(c, texture(uBlur, uv).rgb, tb);
  c += texture(uBloom, uv).rgb*uBloomK;
  if (uRain > 0.01){
    vec2 q = vec2(uv.x*170.0 + uv.y*uSlant*40.0, uv.y*9.0 + uT*7.0); vec2 id = floor(q); float r = hash(id);
    float f = fract(q.y), x = fract(q.x);
    float s = step(1.0 - 0.05*uRain, r)*smoothstep(0.0, 0.35, f)*smoothstep(1.0, 0.7, f)*smoothstep(0.18, 0.0, abs(x - 0.5));
    c = mix(c, vec3(0.82, 0.88, 0.92), s*0.35);
  }
  c *= uExp*uTint;
  float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uSat);
  c = aces(c);
  c *= mix(1.0, smoothstep(1.15, 0.35, length((uv - 0.5)*vec2(1.3, 1.0))), uVig);
  c += (hash(uv*uRes + fract(uT)*91.0) - 0.5)*uGrain;
  c += uFlash*0.25;
  o = vec4(c, 1.0);
}`;
export const COPY_FS = `#version 300 es
precision highp float; precision highp int; in vec2 vUV; out vec4 o; uniform sampler2D uT;
void main(){ o = texture(uT, vUV); }`;
