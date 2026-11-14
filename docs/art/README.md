# Generated art sources

Full-size sources of generated art, kept out of `public/`, because the service worker precaches everything served there.

- `cafe/cafe-ready-wide-generated.png`: the Melaton CaféReady logo (#815). gpt-image-2.5 via TokenRouter, with the Melaton four-leaf mark as reference. Served cuts are `public/static_images/melaton/cafe-ready.png` (704 px wide) and `cafe-ready-bios.png` (120x51, 64 colours), plus DSApp's `res/drawable-nodpi/cafe_ready_logo.png`.
- `cpu/*-512.png`: the processor case badges for the BIOS splash (#815): Intel, AMD, Snapdragon, MediaTek, Exynos, Tensor. These are era-style badges with the vendor names, not copies of the official logo artwork. Served at 64 px tall, 256 colours, in `public/static_images/cpu/`.
