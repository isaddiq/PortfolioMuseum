// Rendering pipeline for the high quality mode: the scene is rendered to a
// multisampled HDR target, light panels, lamps and holograms (anything
// brighter than white) bloom, and a finishing pass rolls off highlights,
// adds a faint vignette and converts to sRGB.
//
// The roll-off is the identity below 0.82 (linear), so artworks, which are
// unlit and at most white, keep their colours; only true highlights compress.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FinishShader = {
    uniforms: {
        tDiffuse: { value: null },
        uVignette: { value: 0.2 }
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uVignette;
        varying vec2 vUv;
        vec3 rolloff(vec3 c) {
            const float k = 0.82;
            vec3 over = max(c - k, 0.0);
            return min(c, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
        }
        vec3 toSRGB(vec3 c) {
            return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        }
        void main() {
            vec3 c = rolloff(max(texture2D(tDiffuse, vUv).rgb, 0.0));
            vec2 d = vUv - 0.5;
            c *= 1.0 - uVignette * smoothstep(0.18, 0.75, dot(d, d) * 2.0);
            gl_FragColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);
        }`
};

export function createPipeline(renderer, scene, camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,
        samples: renderer.capabilities.isWebGL2 === false ? 0 : 4
    });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 1.0);
    composer.addPass(bloom);
    composer.addPass(new ShaderPass(FinishShader));
    return {
        composer,
        bloom,
        setSize(w, h) {
            composer.setPixelRatio(renderer.getPixelRatio());
            composer.setSize(w, h);
        },
        render() {
            composer.render();
        },
        dispose() {
            composer.dispose();
        }
    };
}
