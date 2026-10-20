// Minimal WebGL2 helpers: programs, uniforms, textures, framebuffers.

/** A linked program and its active uniforms by name (array uniforms are keyed without the `[0]`). */
export interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null | undefined>;
}
/** A colour texture with a framebuffer that renders into it (and a depth buffer, if asked for). */
export interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number; db?: WebGLRenderbuffer }
/** A multisampled colour + depth framebuffer that resolves (blits) into `resolve`. */
export interface MsTarget { fb: WebGLFramebuffer; rb: WebGLRenderbuffer; db: WebGLRenderbuffer; w: number; h: number; resolve: Target }

type GL = WebGL2RenderingContext;

function compile(gl: GL, type: GLenum, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const listing = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(gl.getShaderInfoLog(s) + '\n' + listing);
  }
  return s;
}

export function program(gl: GL, vs: string, fs: string): Program {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link failed');
  const u: Program['u'] = {}, n: number = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    if (!info) continue;
    u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export function texture(gl: GL, w: number, h: number, internal: GLenum, format: GLenum, type: GLenum, filter: GLenum = gl.LINEAR): WebGLTexture {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function target(gl: GL, w: number, h: number, internal: GLenum, format: GLenum, type: GLenum, depth = false): Target {
  const tex = texture(gl, w, h, internal, format, type), fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const db = depth ? gl.createRenderbuffer() : undefined;
  if (db) {
    gl.bindRenderbuffer(gl.RENDERBUFFER, db);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, w, h, db };
}

export function msTarget(gl: GL, w: number, h: number, internal: GLenum, format: GLenum, type: GLenum, samples: number): MsTarget {
  const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer(), db = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, internal, w, h);
  gl.bindRenderbuffer(gl.RENDERBUFFER, db);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, rb, db, w, h, resolve: target(gl, w, h, internal, format, type) };
}

export function free(gl: GL, t: Target | MsTarget | null | undefined): void {
  if (!t) return;
  gl.deleteFramebuffer(t.fb);
  if ('tex' in t) { gl.deleteTexture(t.tex); if (t.db) gl.deleteRenderbuffer(t.db); }
  else {
    gl.deleteRenderbuffer(t.rb);
    gl.deleteRenderbuffer(t.db);
    free(gl, t.resolve);
  }
}
