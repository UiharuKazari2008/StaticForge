# Generated art sources

Full-size sources of generated art, kept out of `public/`, because the service worker precaches everything served there.

- `cafe/cafe-ready-wide-generated.png`: the Melaton CaféReady logo (#815). gpt-image-2.5 via TokenRouter, with the Melaton four-leaf mark as reference. Served cuts are `public/static_images/melaton/cafe-ready.png` (704 px wide) and `cafe-ready-bios.png` (120x51, 64 colours), plus DSApp's `res/drawable-nodpi/cafe_ready_logo.png`.
- `cpu/*-512.png`: the processor case badges for the BIOS splash (#815): Snapdragon, MediaTek, Exynos, Tensor. These are era-style badges with the vendor names, not copies of the official logo artwork. Served at 64 px tall, 256 colours, in `public/static_images/cpu/`.
- `cpu/intel-inside-2020.svg`, `cpu/amd-arrow.svg`, `cpu/amd-logo.svg`: Intel and AMD on the BIOS splash are the vendors' own logos, not generated art and not a processor model badge: the current Intel Inside badge (Wikimedia Commons "Intel Inside Logo (2020).svg") and AMD's arrow mark alone in AMD red #ED1C24, cut from the official "AMD Logo.svg" (amd-logo.svg) by cropping the view to the arrow (Yukimi, Nov 19). Served as `public/static_images/cpu/intel.png` (64x64) and `amd.png` (52 px).
