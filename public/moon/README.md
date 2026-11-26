# Moon maps

The colour and elevation maps of the moon the cloth lands on (`lib/cloth-scene.ts`), from
NASA's CGI Moon Kit: https://svs.gsfc.nasa.gov/4720

Credit: **NASA's Scientific Visualization Studio**

| File | Size | Source |
| --- | --- | --- |
| `moon_albedo_1k.jpg` | 1024 × 512 | The kit's `lroc_color_poles_1k.jpg` (LROC colour), unchanged. |
| `moon_height_1k.jpg` | 1024 × 512 | The kit's `ldem_3_8bit.jpg` (LOLA elevation, 8 bit), unchanged. |
| `moon_albedo_2k.webp` | 2048 × 1024 | The kit's `lroc_color_poles_2k.tif`, encoded as WebP (quality 85). |
| `moon_height_2k.webp` | 2048 × 1024 | The kit's `ldem_16_uint.tif` (16 pixels per degree, 16 bit), shrunk to 2048 × 1024 (Lanczos), mapped to the 8-bit levels of `ldem_3_8bit.jpg` by a least-squares fit, and encoded as WebP (quality 90). |

The 1K pair is, byte for byte, the pair the game Chicken Rescue ships
(`game/assets/environment/moon/moon_albedo.jpg` and `moon_height.jpg`). The 2K pair is only
downloaded when the moon is drawn large enough to need it.
