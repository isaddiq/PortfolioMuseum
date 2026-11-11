// Polished floors: one planar reflection shared by every floor (they all lie
// at y = 0). The scene is rendered once more from the camera mirrored through
// the floor, into a half-size target with mipmaps; each floor material then
// samples it, blurred by a mip level that stands in for its roughness and
// weighted by a Fresnel term, so the reflection strengthens towards the
// horizon as it does on real stone and varnish.

import * as THREE from 'three';

export function createFloorReflection(renderer, scene, camera, floors) {
    const target = new THREE.WebGLRenderTarget(8, 8, {
        type: THREE.HalfFloatType,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter
    });
    const mirror = new THREE.PerspectiveCamera();
    const shared = {
        tReflect: { value: target.texture },
        uReflectVP: { value: new THREE.Matrix4() },
        uReflectOn: { value: 0 }
    };
    const eye = new THREE.Vector3();
    const look = new THREE.Vector3();
    const up = new THREE.Vector3();

    /** Teach a floor's standard material to add the reflection. */
    function patch(material, { strength = 0.5, blur = 2.0, specular = 0.3 } = {}) {
        const own = { uReflectGain: { value: strength }, uReflectBlur: { value: blur }, uSpecularKeep: { value: specular } };
        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, shared, own);
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nuniform mat4 uReflectVP;\nvarying vec4 vReflectPos;')
                .replace('#include <project_vertex>', '#include <project_vertex>\nvReflectPos = uReflectVP * modelMatrix * vec4(transformed, 1.0);');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
                    uniform sampler2D tReflect;
                    uniform float uReflectOn;
                    uniform float uReflectGain;
                    uniform float uReflectBlur;
                    uniform float uSpecularKeep;
                    varying vec4 vReflectPos;`)
                .replace('#include <opaque_fragment>', `
                    if (uReflectOn > 0.0) {
                        // The mirror image replaces the analytic highlight of the key light.
                        outgoingLight -= reflectedLight.directSpecular * (1.0 - uSpecularKeep);
                        vec2 ruv = vReflectPos.xy / vReflectPos.w * 0.5 + 0.5;
                        ruv += (normal.xy - nonPerturbedNormal.xy) * 0.035;
                        float ndv = clamp(dot(nonPerturbedNormal, normalize(vViewPosition)), 0.0, 1.0);
                        float fresnel = 0.16 + 0.84 * pow(1.0 - ndv, 4.0);
                        // Five taps a texel apart at that mip level smooth out its blocks.
                        float lod = uReflectBlur + roughnessFactor * 1.5;
                        vec2 texel = exp2(lod) / vec2(textureSize(tReflect, 0)) * 0.75;
                        ruv = clamp(ruv, 0.002, 0.998);
                        vec3 mirrored = textureLod(tReflect, ruv, lod).rgb * 2.0
                            + textureLod(tReflect, ruv + texel, lod).rgb
                            + textureLod(tReflect, ruv - texel, lod).rgb
                            + textureLod(tReflect, ruv + vec2(texel.x, -texel.y), lod).rgb
                            + textureLod(tReflect, ruv + vec2(-texel.x, texel.y), lod).rgb;
                        mirrored /= 6.0;
                        // Lamps are far brighter than white: keep them from burning holes in the floor.
                        mirrored = min(mirrored, vec3(1.6));
                        outgoingLight += mirrored * fresnel * uReflectGain * uReflectOn;
                    }
                    #include <opaque_fragment>`);
        };
        material.customProgramCacheKey = () => 'floor-reflect';
        material.needsUpdate = true;
    }

    return {
        patch,
        target,
        get enabled() { return shared.uReflectOn.value > 0; },
        set enabled(on) { shared.uReflectOn.value = on ? 1 : 0; },
        setSize(w, h) {
            target.setSize(Math.max(8, Math.round(w / 2)), Math.max(8, Math.round(h / 2)));
        },
        /** Draw the mirrored view. Call before the main render. */
        render() {
            if (shared.uReflectOn.value <= 0) return;
            camera.updateMatrixWorld();
            eye.setFromMatrixPosition(camera.matrixWorld);
            camera.getWorldDirection(look).add(eye);
            up.set(0, 1, 0).transformDirection(camera.matrixWorld);
            mirror.position.set(eye.x, -eye.y, eye.z);
            mirror.up.set(up.x, -up.y, up.z);
            mirror.lookAt(look.x, -look.y, look.z);
            mirror.projectionMatrix.copy(camera.projectionMatrix);
            mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
            mirror.updateMatrixWorld();
            shared.uReflectVP.value.multiplyMatrices(mirror.projectionMatrix, mirror.matrixWorldInverse);
            // A floor cannot be drawn into the texture it is reading from.
            for (const floor of floors) floor.visible = false;
            const before = renderer.getRenderTarget();
            renderer.setRenderTarget(target);
            renderer.render(scene, mirror);
            renderer.setRenderTarget(before);
            for (const floor of floors) floor.visible = true;
        },
        dispose() {
            target.dispose();
        }
    };
}
