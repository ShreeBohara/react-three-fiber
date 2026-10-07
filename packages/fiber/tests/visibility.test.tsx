//* Visibility Events Tests ==============================
// Tests for onFramed, onOccluded, and onVisible event handlers

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { useRef, useEffect } from 'react'
import { render, act as rtlAct } from '@testing-library/react'
import { Canvas, useThree, useFrame, extend } from '../src'
import {
  __resetWarningFlag,
  registerVisibility,
  updateVisibilityHandlers,
  unregisterVisibility,
  checkVisibility,
  cleanupHelperGroup,
} from '../src/core/visibility'
import { createStore } from '../src/core/store'
import { registerThree } from '../src/core/three'
import { webgpuSupport } from '../src/support/webgpu'
import * as THREE from 'three'
import type { RootState, RootStore } from '#types'

// Reset warning flag before each test to ensure clean state
beforeEach(() => {
  __resetWarningFlag()
})

import { act, advanceFrames } from './utils/act'

describe('visibility events', () => {
  //* onFramed Tests --------------------------------

  describe('onFramed', () => {
    it('fires with true when object is in frustum', async () => {
      const handleFramed = vi.fn()

      await act(async () => {
        render(
          <Canvas>
            <mesh position={[0, 0, 0]} onFramed={handleFramed}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial />
            </mesh>
          </Canvas>,
        )
      })

      // Wait for visibility check to run
      await advanceFrames(3)

      // Object is at origin, camera default looks at origin, so should be in view
      expect(handleFramed).toHaveBeenCalledWith(true)
    })

    it('fires with false when object moves out of frustum', async () => {
      const handleFramed = vi.fn()
      let meshRef: THREE.Mesh | null = null

      function TestComponent() {
        const ref = useRef<THREE.Mesh>(null)

        useEffect(() => {
          meshRef = ref.current
        }, [])

        return (
          <mesh ref={ref} position={[0, 0, 0]} onFramed={handleFramed}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial />
          </mesh>
        )
      }

      await act(async () => {
        render(
          <Canvas>
            <TestComponent />
          </Canvas>,
        )
      })

      // Wait for initial visibility check
      await advanceFrames(3)

      // Clear mock to only track the next call
      handleFramed.mockClear()

      // Move object far behind camera (camera looks at -Z by default from +Z)
      await act(async () => {
        if (meshRef) {
          meshRef.position.set(0, 0, 1000)
          meshRef.updateMatrixWorld()
        }
      })

      await advanceFrames(3)

      // Should have been called with false when moving out of view
      expect(handleFramed).toHaveBeenCalledWith(false)
    })

    it('only fires on state change, not every frame', async () => {
      const handleFramed = vi.fn()

      await act(async () => {
        render(
          <Canvas>
            <mesh position={[0, 0, 0]} onFramed={handleFramed}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial />
            </mesh>
          </Canvas>,
        )
      })

      // Wait for multiple frames
      await advanceFrames(10)

      // Should only fire once (initial state) not every frame
      expect(handleFramed).toHaveBeenCalledTimes(1)
    })
  })

  //* onOccluded Tests --------------------------------

  describe('onOccluded', () => {
    it('does not error when used without WebGPU renderer', async () => {
      const handleOccluded = vi.fn()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // This should not throw
      await expect(
        act(async () => {
          render(
            <Canvas>
              <mesh onOccluded={handleOccluded}>
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial />
              </mesh>
            </Canvas>,
          )
        }),
      ).resolves.not.toThrow()

      await advanceFrames(3)

      // Without WebGPU, onOccluded should not fire (no occlusion support)
      // This is expected behavior - occlusion queries are WebGPU only
      expect(handleOccluded).not.toHaveBeenCalled()

      // Should have warned about WebGL limitation
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WebGPU'))

      warnSpy.mockRestore()
    })

    it('sets occlusionTest flag on object', async () => {
      let meshRef: THREE.Mesh | null = null
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      function TestComponent() {
        const ref = useRef<THREE.Mesh>(null)

        useEffect(() => {
          meshRef = ref.current
        }, [])

        return (
          <mesh ref={ref} onOccluded={() => {}}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial />
          </mesh>
        )
      }

      await act(async () => {
        render(
          <Canvas>
            <TestComponent />
          </Canvas>,
        )
      })

      await advanceFrames(3)

      // The occlusionTest flag should be set on the mesh
      expect((meshRef as any)?.occlusionTest).toBe(true)

      warnSpy.mockRestore()
    })

    it('warns once about WebGL limitation', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // First component
      await act(async () => {
        render(
          <Canvas>
            <mesh onOccluded={() => {}}>
              <boxGeometry />
              <meshBasicMaterial />
            </mesh>
          </Canvas>,
        )
      })

      await advanceFrames(3)

      // Warning should be called once
      const warningCallCount = warnSpy.mock.calls.filter((call) => call[0]?.toString().includes('WebGPU')).length

      // The warning is per-session, so it should only fire once even with multiple objects
      expect(warningCallCount).toBeLessThanOrEqual(1)

      warnSpy.mockRestore()
    })
  })

  //* onVisible Tests --------------------------------

  describe('onVisible', () => {
    it('fires with true when object is visible (in frustum and visible=true)', async () => {
      const handleVisible = vi.fn()

      await act(async () => {
        render(
          <Canvas>
            <mesh position={[0, 0, 0]} onVisible={handleVisible}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial />
            </mesh>
          </Canvas>,
        )
      })

      await advanceFrames(3)

      // Object is visible: in frustum + visible=true (default) + not occluded
      expect(handleVisible).toHaveBeenCalledWith(true)
    })

    it('fires with false when object.visible is set to false', async () => {
      const handleVisible = vi.fn()
      let meshRef: THREE.Mesh | null = null

      function TestComponent() {
        const ref = useRef<THREE.Mesh>(null)

        useEffect(() => {
          meshRef = ref.current
        }, [])

        return (
          <mesh ref={ref} position={[0, 0, 0]} onVisible={handleVisible}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial />
          </mesh>
        )
      }

      await act(async () => {
        render(
          <Canvas>
            <TestComponent />
          </Canvas>,
        )
      })

      await advanceFrames(3)
      handleVisible.mockClear()

      // Set visible to false
      await act(async () => {
        if (meshRef) {
          meshRef.visible = false
        }
      })

      await advanceFrames(3)

      // Should fire with false because visible=false
      expect(handleVisible).toHaveBeenCalledWith(false)
    })

    it('fires with false when object moves out of frustum', async () => {
      const handleVisible = vi.fn()
      let meshRef: THREE.Mesh | null = null

      function TestComponent() {
        const ref = useRef<THREE.Mesh>(null)

        useEffect(() => {
          meshRef = ref.current
        }, [])

        return (
          <mesh ref={ref} position={[0, 0, 0]} onVisible={handleVisible}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial />
          </mesh>
        )
      }

      await act(async () => {
        render(
          <Canvas>
            <TestComponent />
          </Canvas>,
        )
      })

      await advanceFrames(3)
      handleVisible.mockClear()

      // Move object far away
      await act(async () => {
        if (meshRef) {
          meshRef.position.set(0, 0, 1000)
          meshRef.updateMatrixWorld()
        }
      })

      await advanceFrames(3)

      // Should fire with false because out of frustum
      expect(handleVisible).toHaveBeenCalledWith(false)
    })
  })

  //* Cleanup Tests --------------------------------

  describe('cleanup', () => {
    it('removes object from visibility registry on unmount', async () => {
      const handleFramed = vi.fn()
      let storeRef: RootState | null = null

      function StoreCapture() {
        const state = useThree()
        useEffect(() => {
          storeRef = state
        }, [state])
        return null
      }

      function TestMesh({ show }: { show: boolean }) {
        if (!show) return null
        return (
          <mesh onFramed={handleFramed}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial />
          </mesh>
        )
      }

      const { rerender } = await act(async () =>
        render(
          <Canvas>
            <StoreCapture />
            <TestMesh show={true} />
          </Canvas>,
        ),
      )

      await advanceFrames(3)

      // Verify object is registered
      expect(storeRef!.internal.visibilityRegistry.size).toBe(1)

      // Unmount the mesh
      await act(async () => {
        rerender(
          <Canvas>
            <StoreCapture />
            <TestMesh show={false} />
          </Canvas>,
        )
      })

      await advanceFrames(3)

      // Registry should be empty after unmount
      expect(storeRef!.internal.visibilityRegistry.size).toBe(0)
    })
  })

  //* Handler Updates --------------------------------
  // Regression coverage for two halves of one defect. Visibility registration used to sit behind
  // `prevHandlers !== instance.eventCount` in applyProps — a handler *count*. See
  // updateVisibilityHandlers for why re-registering is not a valid substitute for updating.

  describe('handler updates on a mounted object', () => {
    it('uses the latest handler after it is swapped for a different function', async () => {
      // The count is unchanged across this swap, so the old gate never re-ran and the registry
      // kept the first closure. Inline handlers produce a new function every render, so this is
      // the normal case, not an edge case.
      const first = vi.fn()
      const second = vi.fn()
      let storeRef: RootState | null = null

      function StoreCapture() {
        const state = useThree()
        useEffect(() => {
          storeRef = state
        }, [state])
        return null
      }

      function TestMesh({ handler }: { handler: () => void }) {
        return (
          <mesh onFramed={handler}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial />
          </mesh>
        )
      }

      const { rerender } = await act(async () =>
        render(
          <Canvas>
            <StoreCapture />
            <TestMesh handler={first} />
          </Canvas>,
        ),
      )
      await advanceFrames(3)

      await act(async () => {
        rerender(
          <Canvas>
            <StoreCapture />
            <TestMesh handler={second} />
          </Canvas>,
        )
      })
      await advanceFrames(3)

      const entry = [...storeRef!.internal.visibilityRegistry.values()][0]
      expect(entry).toBeDefined()
      // The registry must hold the CURRENT closure, not the one captured at mount.
      expect(entry.handlers.onFramed).toBe(second)
      expect(entry.handlers.onFramed).not.toBe(first)
    })

    it('preserves last-known visibility state when a handler is ADDED', async () => {
      // Adding a handler changes eventCount, which DID re-run the old block -> registerVisibility
      // -> a fresh entry with lastFramedState = null. The checker reads null as "no previous
      // state, fire on next check", so onFramed re-fired even though the object never left the
      // frustum, breaking the "only fires on state change" contract asserted earlier in this file.
      const handleFramed = vi.fn()
      let storeRef: RootState | null = null

      function StoreCapture() {
        const state = useThree()
        useEffect(() => {
          storeRef = state
        }, [state])
        return null
      }

      function TestMesh({ withVisible }: { withVisible: boolean }) {
        return (
          <mesh onFramed={handleFramed} {...(withVisible ? { onVisible: () => {} } : {})}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial />
          </mesh>
        )
      }

      const { rerender } = await act(async () =>
        render(
          <Canvas>
            <StoreCapture />
            <TestMesh withVisible={false} />
          </Canvas>,
        ),
      )
      await advanceFrames(3)

      const callsAfterMount = handleFramed.mock.calls.length
      const stateAfterMount = [...storeRef!.internal.visibilityRegistry.values()][0].lastFramedState
      expect(stateAfterMount).not.toBeNull()

      // Add a second handler: eventCount changes 1 -> 2
      await act(async () => {
        rerender(
          <Canvas>
            <StoreCapture />
            <TestMesh withVisible={true} />
          </Canvas>,
        )
      })
      await advanceFrames(3)

      const entry = [...storeRef!.internal.visibilityRegistry.values()][0]
      expect(entry.lastFramedState).toBe(stateAfterMount)
      expect(handleFramed.mock.calls.length).toBe(callsAfterMount)
    })
  })

  //* Combined Handler Tests --------------------------------

  describe('multiple handlers', () => {
    it('supports all three handlers on the same object', async () => {
      const handleFramed = vi.fn()
      const handleOccluded = vi.fn()
      const handleVisible = vi.fn()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await act(async () => {
        render(
          <Canvas>
            <mesh onFramed={handleFramed} onOccluded={handleOccluded} onVisible={handleVisible}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial />
            </mesh>
          </Canvas>,
        )
      })

      await advanceFrames(3)

      // onFramed and onVisible should fire (object is in view)
      expect(handleFramed).toHaveBeenCalledWith(true)
      expect(handleVisible).toHaveBeenCalledWith(true)
      // onOccluded won't fire without WebGPU renderer

      warnSpy.mockRestore()
    })
  })

  //* Occlusion System Tests --------------------------------

  describe('occlusion system', () => {
    it('can be explicitly enabled via Canvas prop (triggers warning on WebGL)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // When using the occlusion prop with a handler, it should trigger
      // the WebGL warning since the test environment doesn't have WebGPU
      await act(async () => {
        render(
          <Canvas>
            <mesh onOccluded={() => {}}>
              <boxGeometry />
              <meshBasicMaterial />
            </mesh>
          </Canvas>,
        )
      })

      await advanceFrames(3)

      // On WebGL, occlusion can't be enabled (warning should be logged)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WebGPU'))

      warnSpy.mockRestore()
    })

    it('auto-enables when onVisible is used', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const handleVisible = vi.fn()

      await act(async () => {
        render(
          <Canvas>
            <mesh onVisible={handleVisible}>
              <boxGeometry />
              <meshBasicMaterial />
            </mesh>
          </Canvas>,
        )
      })

      await advanceFrames(3)

      // Should have tried to enable occlusion (and warned about WebGL)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WebGPU'))

      warnSpy.mockRestore()
    })
  })
})

//* Occlusion on a WebGPU root ==============================
// The Canvas tests above run on the WebGL mock, so enableOcclusion() stops at its warning and the
// observer is never built. These drive a bare store seeded with the real WebGPU support (node
// classes from three/webgpu; constructing them needs no device) and a renderer whose isOccluded()
// is stubbed. That proves the wiring: the observer, the cache it fills, the events read from that
// cache, and teardown. Whether a GPU occlusion query reports the right answer is Tier 2.

describe('occlusion on a WebGPU root', () => {
  registerThree(THREE)

  function createOcclusionStore(isOccluded: (object: THREE.Object3D) => boolean = () => false) {
    const store = createStore(
      () => {},
      () => {},
    )
    const state = store.getState()
    store.setState({
      camera: new THREE.PerspectiveCamera(),
      frustum: new THREE.Frustum(),
      rootScene: new THREE.Scene(),
      renderer: { isOccluded } as any,
      internal: { ...state.internal, support: webgpuSupport },
    } as any)
    return store
  }

  // What three's render pass does each frame: run the observer node's update
  function renderPass(store: RootStore) {
    const { internal, renderer } = store.getState()
    ;(internal.occlusionObserver!.material as any).colorNode.update({ renderer })
  }

  it('flags an object for occlusion queries when onOccluded is added after occlusion is already on', () => {
    const store = createOcclusionStore()
    const first = new THREE.Mesh(new THREE.BoxGeometry())
    const second = new THREE.Mesh(new THREE.BoxGeometry())

    // `first` turns occlusion on; `second` starts with only onFramed
    registerVisibility(store, first, { onVisible: () => {} })
    registerVisibility(store, second, { onFramed: () => {} })
    expect(store.getState().internal.occlusionEnabled).toBe(true)

    // A prop update on the mounted object, as applyProps does it
    updateVisibilityHandlers(store, second, { onFramed: () => {}, onOccluded: () => {} })

    // three only issues an occlusion query for objects with occlusionTest === true
    expect((second as any).occlusionTest).toBe(true)
  })

  it('builds one observer mesh in the internal helper group', () => {
    const store = createOcclusionStore()
    registerVisibility(store, new THREE.Mesh(), { onOccluded: () => {} })
    registerVisibility(store, new THREE.Mesh(), { onVisible: () => {} })

    const { internal, rootScene } = store.getState()
    expect(internal.occlusionEnabled).toBe(true)
    expect(internal.helperGroup!.parent).toBe(rootScene)
    expect(internal.helperGroup!.children).toEqual([internal.occlusionObserver])

    const observer = internal.occlusionObserver!
    expect(observer.name).toBe('__r3fOcclusionObserver')
    // Culling it would stop the node update that fills the cache
    expect(observer.frustumCulled).toBe(false)
    expect(observer.material).toBeInstanceOf(webgpuSupport.occlusion.MeshBasicNodeMaterial)
  })

  it('queries only objects with occlusion handlers during the render pass', () => {
    const isOccluded = vi.fn(() => true)
    const store = createOcclusionStore(isOccluded)
    const occluded = new THREE.Mesh()
    const framedOnly = new THREE.Mesh()
    registerVisibility(store, occluded, { onOccluded: () => {} })
    registerVisibility(store, framedOnly, { onFramed: () => {} })

    renderPass(store)

    expect(isOccluded).toHaveBeenCalledTimes(1)
    expect(isOccluded).toHaveBeenCalledWith(occluded)
    const { occlusionCache } = store.getState().internal
    expect(occlusionCache.get(occluded)).toBe(true)
    expect(occlusionCache.has(framedOnly)).toBe(false)
  })

  it('fires onOccluded from the render pass result, only when it changes', () => {
    let occluded = true
    const store = createOcclusionStore(() => occluded)
    const mesh = new THREE.Mesh()
    const onOccluded = vi.fn()
    registerVisibility(store, mesh, { onOccluded })

    // No render pass yet: nothing is known, nothing fires
    checkVisibility(store.getState())
    expect(onOccluded).not.toHaveBeenCalled()

    renderPass(store)
    checkVisibility(store.getState())
    renderPass(store)
    checkVisibility(store.getState())
    expect(onOccluded.mock.calls).toEqual([[true]])

    occluded = false
    renderPass(store)
    checkVisibility(store.getState())
    expect(onOccluded.mock.calls).toEqual([[true], [false]])
  })

  it('onVisible is false while occluded, even inside the frustum', () => {
    let occluded = true
    const store = createOcclusionStore(() => occluded)
    const { camera } = store.getState()
    camera.position.set(0, 0, 5)
    camera.updateMatrixWorld()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry())
    mesh.updateMatrixWorld()
    const onVisible = vi.fn()
    registerVisibility(store, mesh, { onVisible })

    renderPass(store)
    checkVisibility(store.getState())
    expect(onVisible.mock.calls).toEqual([[false]])

    occluded = false
    renderPass(store)
    checkVisibility(store.getState())
    expect(onVisible.mock.calls).toEqual([[false], [true]])
  })

  it('drops an unregistered object from the cache', () => {
    const store = createOcclusionStore(() => true)
    const mesh = new THREE.Mesh()
    registerVisibility(store, mesh, { onOccluded: () => {} })
    renderPass(store)
    expect(store.getState().internal.occlusionCache.has(mesh)).toBe(true)

    unregisterVisibility(store, mesh)
    expect(store.getState().internal.occlusionCache.has(mesh)).toBe(false)
  })

  it('tears the observer down and disposes it on cleanup', () => {
    const store = createOcclusionStore(() => true)
    registerVisibility(store, new THREE.Mesh(), { onOccluded: () => {} })
    renderPass(store)

    const { occlusionObserver, helperGroup } = store.getState().internal
    const disposeGeometry = vi.spyOn(occlusionObserver!.geometry, 'dispose')
    const disposeMaterial = vi.spyOn(occlusionObserver!.material as THREE.Material, 'dispose')

    cleanupHelperGroup(store)

    const { internal, rootScene } = store.getState()
    expect(disposeGeometry).toHaveBeenCalledTimes(1)
    expect(disposeMaterial).toHaveBeenCalledTimes(1)
    expect(occlusionObserver!.parent).toBeNull()
    expect(rootScene.children).not.toContain(helperGroup)
    expect(internal.occlusionEnabled).toBe(false)
    expect(internal.occlusionObserver).toBeNull()
    expect(internal.helperGroup).toBeNull()
    expect(internal.occlusionCache.size).toBe(0)
  })

  it.todo('covered by Tier 2: a real occlusion query reports a mesh hidden behind another as occluded')
})
