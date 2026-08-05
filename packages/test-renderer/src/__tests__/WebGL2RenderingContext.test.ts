import * as THREE from 'three'

import { WebGL2RenderingContext } from '../WebGL2RenderingContext'

describe('WebGL2RenderingContext mock', () => {
  const gl = () => new WebGL2RenderingContext(document.createElement('canvas'))

  // three keys internal caches (currentDrawbuffers, bindingStates, …) off the handles it gets
  // back from gl.create*(). A handle of `undefined` throws "Invalid value used as weak map key"
  // out of WebGLRenderer.setRenderTarget the moment a render target is bound.
  it.each([
    'createBuffer',
    'createFramebuffer',
    'createProgram',
    'createQuery',
    'createRenderbuffer',
    'createSampler',
    'createShader',
    'createTexture',
    'createTransformFeedback',
    'createVertexArray',
  ])('%s returns a handle usable as a WeakMap key', (method) => {
    const handle = gl()[method]()

    expect(handle).toBeDefined()
    expect(() => new WeakMap().set(handle, {})).not.toThrow()
  })

  it('returns a distinct handle per call', () => {
    const context = gl()

    expect(context.createFramebuffer()).not.toBe(context.createFramebuffer())
  })

  it('supports binding a render target, as PMREM and effect passes do', () => {
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') })

    expect(() => renderer.setRenderTarget(new THREE.WebGLRenderTarget(1, 1))).not.toThrow()
  })
})
