// PixiJS @pixi/unsafe-eval 7.4.2 — MIT, copyright (c) 2013-2023 Mathew Groves, Chad Engler.
// Source: https://github.com/pixijs/pixijs/blob/v7.4.2/packages/unsafe-eval/src/syncUniforms.ts
// Transpiled to ESM; explicit install below adapts upstream selfInstall to the app's lazy global PIXI.
// The full MIT notice is in THIRD-PARTY-NOTICES.md. No runtime code generation.
// cv = CachedValue
// v = value
// ud = uniformData
// uv = uniformValue
// l = location
const GLSL_TO_SINGLE_SETTERS = {
    vec3(gl, location, cv, v) {
        if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            gl.uniform3f(location, v[0], v[1], v[2]);
        }
    },
    int(gl, location, _cv, value) { gl.uniform1i(location, value); },
    ivec2(gl, location, _cv, value) { gl.uniform2i(location, value[0], value[1]); },
    ivec3(gl, location, _cv, value) { gl.uniform3i(location, value[0], value[1], value[2]); },
    ivec4(gl, location, _cv, value) { gl.uniform4i(location, value[0], value[1], value[2], value[3]); },
    uint(gl, location, _cv, value) { gl.uniform1ui(location, value); },
    uvec2(gl, location, _cv, value) { gl.uniform2ui(location, value[0], value[1]); },
    uvec3(gl, location, _cv, value) { gl.uniform3ui(location, value[0], value[1], value[2]); },
    uvec4(gl, location, _cv, value) { gl.uniform4ui(location, value[0], value[1], value[2], value[3]); },
    bvec2(gl, location, _cv, value) { gl.uniform2i(location, value[0], value[1]); },
    bvec3(gl, location, _cv, value) { gl.uniform3i(location, value[0], value[1], value[2]); },
    bvec4(gl, location, _cv, value) { gl.uniform4i(location, value[0], value[1], value[2], value[3]); },
    mat2(gl, location, _cv, value) { gl.uniformMatrix2fv(location, false, value); },
    mat4(gl, location, _cv, value) { gl.uniformMatrix4fv(location, false, value); },
};
const GLSL_TO_ARRAY_SETTERS = {
    float(gl, location, _cv, value) { gl.uniform1fv(location, value); },
    vec2(gl, location, _cv, value) { gl.uniform2fv(location, value); },
    vec3(gl, location, _cv, value) { gl.uniform3fv(location, value); },
    vec4(gl, location, _cv, value) { gl.uniform4fv(location, value); },
    int(gl, location, _cv, value) { gl.uniform1iv(location, value); },
    ivec2(gl, location, _cv, value) { gl.uniform2iv(location, value); },
    ivec3(gl, location, _cv, value) { gl.uniform3iv(location, value); },
    ivec4(gl, location, _cv, value) { gl.uniform4iv(location, value); },
    uint(gl, location, _cv, value) { gl.uniform1uiv(location, value); },
    uvec2(gl, location, _cv, value) { gl.uniform2uiv(location, value); },
    uvec3(gl, location, _cv, value) { gl.uniform3uiv(location, value); },
    uvec4(gl, location, _cv, value) { gl.uniform4uiv(location, value); },
    bool(gl, location, _cv, value) { gl.uniform1iv(location, value); },
    bvec2(gl, location, _cv, value) { gl.uniform2iv(location, value); },
    bvec3(gl, location, _cv, value) { gl.uniform3iv(location, value); },
    bvec4(gl, location, _cv, value) { gl.uniform4iv(location, value); },
    sampler2D(gl, location, _cv, value) { gl.uniform1iv(location, value); },
    samplerCube(gl, location, _cv, value) { gl.uniform1iv(location, value); },
    sampler2DArray(gl, location, _cv, value) { gl.uniform1iv(location, value); },
};
export function syncUniforms(group, uniformData, ud, uv, renderer) {
    let textureCount = 0;
    let v;
    let cv;
    const gl = renderer.gl;
    for (const i in group.uniforms) {
        const data = uniformData[i];
        const uvi = uv[i];
        const udi = ud[i];
        const gu = group.uniforms[i];
        if (!data) {
            if (gu.group === true) // strict check to desambiguate from Array.group
             {
                renderer.shader.syncUniformGroup(uvi);
            }
            continue;
        }
        if (data.type === 'float' && data.size === 1 && !data.isArray) {
            if (uvi !== udi.value) {
                udi.value = uvi;
                gl.uniform1f(udi.location, uvi);
            }
        }
        else if (data.type === 'bool' && data.size === 1 && !data.isArray) {
            if (uvi !== udi.value) {
                udi.value = uvi;
                gl.uniform1i(udi.location, Number(uvi));
            }
        }
        else if ((data.type === 'sampler2D' || data.type === 'samplerCube' || data.type === 'sampler2DArray') && data.size === 1 && !data.isArray) 
        {
            renderer.texture.bind(uvi, textureCount);
            if (udi.value !== textureCount) {
                udi.value = textureCount;
                gl.uniform1i(udi.location, textureCount);
            }
            textureCount++;
        }
        else if (data.type === 'mat3' && data.size === 1 && !data.isArray) {
            if (gu.a !== undefined) {
                gl.uniformMatrix3fv(udi.location, false, uvi.toArray(true));
            }
            else {
                gl.uniformMatrix3fv(udi.location, false, uvi);
            }
        }
        else if (data.type === 'vec2' && data.size === 1 && !data.isArray) {
            if (gu.x !== undefined) {
                cv = udi.value;
                v = uvi;
                if (cv[0] !== v.x || cv[1] !== v.y) {
                    cv[0] = v.x;
                    cv[1] = v.y;
                    gl.uniform2f(udi.location, v.x, v.y);
                }
            }
            else {
                cv = udi.value;
                v = uvi;
                if (cv[0] !== v[0] || cv[1] !== v[1]) {
                    cv[0] = v[0];
                    cv[1] = v[1];
                    gl.uniform2f(udi.location, v[0], v[1]);
                }
            }
        }
        else if (data.type === 'vec4' && data.size === 1 && !data.isArray) {
            if (gu.width !== undefined) {
                cv = udi.value;
                v = uvi;
                if (cv[0] !== v.x || cv[1] !== v.y || cv[2] !== v.width || cv[3] !== v.height) {
                    cv[0] = v.x;
                    cv[1] = v.y;
                    cv[2] = v.width;
                    cv[3] = v.height;
                    gl.uniform4f(udi.location, v.x, v.y, v.width, v.height);
                }
            }
            else {
                cv = udi.value;
                v = uvi;
                if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2] || cv[3] !== v[3]) {
                    cv[0] = v[0];
                    cv[1] = v[1];
                    cv[2] = v[2];
                    cv[3] = v[3];
                    gl.uniform4f(udi.location, v[0], v[1], v[2], v[3]);
                }
            }
        }
        else {
            const funcArray = (data.size === 1) && !data.isArray ? GLSL_TO_SINGLE_SETTERS : GLSL_TO_ARRAY_SETTERS;
            funcArray[data.type].call(null, gl, udi.location, udi.value, uvi);
        }
    }
}

export function installPixiNoEval(PIXI) {
  Object.assign(PIXI.ShaderSystem.prototype, {
    systemCheck() {},
    syncUniforms(group, glProgram) {
      syncUniforms(group, this.shader.program.uniformData, glProgram.uniformData, group.uniforms, this.renderer);
    },
  });
}
