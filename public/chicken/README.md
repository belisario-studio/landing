# Chicken Rescue rooster

The rooster the egg reveal drops (`lib/reveal-rooster.ts`, `lib/reveal-egg.ts`), baked from the
player model of the studio's game Chicken Rescue.

| File | Size | Source |
| --- | --- | --- |
| `rooster.bin` | 115 432 bytes (about 62 KB gzipped) | The game's `game/assets/characters/chicken/chicken.glb`, pose `idle1` at t = 0, 8889 vertices and 5889 triangles. |

The glb has no textures; the six materials (body, comb, beak, legs, eyes, pupils) are flat colours
that live in `lib/reveal-rooster.ts`. Positions are normalised: height 1, feet at y = 0, centred
in x and z, facing +Z. Merging the glb's parts into the six materials gives the six index ranges.

## Layout of `rooster.bin` (little endian)

| Offset | Type | Content |
| --- | --- | --- |
| 0 | char[4] | `RSTR` |
| 4 | u32 | version (1) |
| 8 | u32 | vertexCount |
| 12 | u32 | indexCount |
| 16 | f64[3] | `ext`: the half extent of each axis, the scale of the quantised positions |
| 40 | u32[12] | six material groups, each (first index, index count), in the order body, comb, beak, legs, eyes, pupils |
| 88 | u8[8] | reserved, zero |
| 96 | i16[3 * vertexCount] | positions: `value / 32767 * ext[axis]` |
| then | i8[3 * vertexCount] | normals: `value / 127`, zero padded to a multiple of 4 bytes |
| then | u16[indexCount] | triangle indices |

## Regenerating

The prototype's baker took the glb's posed vertices (`rooster_extract.js`), normalised and
quantised them and merged the parts into the six materials (`rooster_build.js`); this file is
the same data, packed by a short node script from that output. The repo has no `scripts/`
folder, so the generator is not kept here: to change the pose or the model, redo the bake and
write the file in the layout above. `decodeRooster()` in `lib/reveal-rooster.ts` is the reader,
and throws on a bad magic, an unknown version or a truncated file.
