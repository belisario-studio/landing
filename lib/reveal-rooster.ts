// The rooster of the studio's game Chicken Rescue (its chicken.glb, pose idle1 at t = 0), as a
// three.js group. The mesh is a compact binary asset, public/chicken/rooster.bin (see
// public/chicken/README.md for where it comes from); this file fetches and decodes it.
import * as THREE from "three"

/** Where the mesh is served from. */
export const ROOSTER_URL = "/chicken/rooster.bin"

// rooster.bin, little endian:
//    0  char[4]  "RSTR"
//    4  u32      version (1)
//    8  u32      vertexCount
//   12  u32      indexCount
//   16  f64[3]   ext: the half extent of each axis, in units of the rooster's height
//   40  u32[12]  six material groups as (first index, index count)
//   88  u8[8]    reserved
//   96  i16[3 * vertexCount]  positions, position = value / 32767 * ext[axis]
//       i8[3 * vertexCount]   normals, normal = value / 127, zero padded to a multiple of 4 bytes
//       u16[indexCount]       triangle indices
const MAGIC = 0x52545352 // "RSTR" read as a little endian u32
const VERSION = 1
const HEADER_BYTES = 96
const GROUPS = 6

// The glb's own flat colours (sRGB hex), roughness per material, in group order. The glb has no textures.
const MATERIALS: ReadonlyArray<readonly [name: string, color: number, roughness: number]> = [
  ["body", 0xe6e6e6, 0.55],
  ["comb", 0xe60005, 0.5],
  ["beak", 0xe6c400, 0.45],
  ["legs", 0xe67100, 0.5],
  ["eye", 0xf2f2f2, 0.2],
  ["pupil", 0x0b0b0b, 0.25],
]

interface RoosterMesh {
  vertexCount: number
  positions: Float32Array
  normals: Float32Array
  indices: Uint16Array
  /** [first index, index count] of each material. */
  groups: Array<[number, number]>
}

/** Decodes rooster.bin. Throws on a file that is not one. */
export function decodeRooster(buffer: ArrayBuffer): RoosterMesh {
  if (buffer.byteLength < HEADER_BYTES) throw new Error("rooster.bin: too short")
  const head = new DataView(buffer)
  if (head.getUint32(0, true) !== MAGIC) throw new Error("rooster.bin: bad magic")
  if (head.getUint32(4, true) !== VERSION) throw new Error("rooster.bin: unknown version")
  const vertexCount = head.getUint32(8, true)
  const indexCount = head.getUint32(12, true)
  const ext = [head.getFloat64(16, true), head.getFloat64(24, true), head.getFloat64(32, true)]
  const groups: Array<[number, number]> = []
  for (let i = 0; i < GROUPS; i++) groups.push([head.getUint32(40 + i * 8, true), head.getUint32(44 + i * 8, true)])

  const normalBytes = vertexCount * 3
  const normalsAt = HEADER_BYTES + vertexCount * 6
  const indicesAt = normalsAt + normalBytes + ((4 - (normalBytes % 4)) % 4)
  if (buffer.byteLength < indicesAt + indexCount * 2) throw new Error("rooster.bin: truncated")

  const q = new Int16Array(buffer, HEADER_BYTES, vertexCount * 3)
  const nq = new Int8Array(buffer, normalsAt, normalBytes)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  for (let i = 0; i < q.length; i++) {
    positions[i] = (q[i] / 32767) * ext[i % 3]
    normals[i] = nq[i] / 127
  }
  // Copied out so the file's buffer can go.
  const indices = new Uint16Array(buffer.slice(indicesAt, indicesAt + indexCount * 2))
  return { vertexCount, positions, normals, indices, groups }
}

function roosterGroup(mesh: RoosterMesh): THREE.Group {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3))
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3))
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
  mesh.groups.forEach(([start, count], i) => geometry.addGroup(start, count, i))
  const materials = MATERIALS.map(
    ([, color, roughness]) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side: THREE.DoubleSide }),
  )
  const body = new THREE.Mesh(geometry, materials)
  body.name = "rooster"
  body.castShadow = true
  body.receiveShadow = true
  const group = new THREE.Group()
  group.name = "RevealRooster"
  group.add(body)
  return group
}

let download: Promise<RoosterMesh> | null = null

/**
 * The rooster: height 1, feet at y = 0, centred in x and z, facing +Z, one MeshStandardMaterial
 * for each of body, comb, beak, legs, eyes and pupils (in that order). The file is fetched once;
 * every call returns a new group with its own geometry object and materials (the vertex arrays are shared).
 */
export function buildRooster(url: string = ROOSTER_URL): Promise<THREE.Group> {
  if (!download) {
    download = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`rooster.bin: HTTP ${response.status}`)
        return response.arrayBuffer()
      })
      .then(decodeRooster)
    // A failed download is tried again the next time the rooster is asked for.
    download.catch(() => {
      download = null
    })
  }
  return download.then(roosterGroup)
}

/** Frees a rooster made by buildRooster. */
export function disposeRooster(group: THREE.Group) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material.dispose()
  })
}
