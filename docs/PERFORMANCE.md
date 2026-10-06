# Measured cloud performance

Measured on 2026-10-06 using Chromium and SwiftShader software rendering, two independent browser contexts, 1280×720 viewport, Low preset and 0.5 render scale (640×360 drawing buffer). Each map measurement samples 60 requestAnimationFrame intervals. These measurements do not establish physical laptop performance or the requested 60 FPS target.

| Map | Mean frame interval | Maximum | Overlay |
| --- | ---: | ---: | --- |
| Saint Vesper Institute | 83.9 ms | 166.6 ms | 82.7 ms · 116 calls · 5878 triangles · 4 ms RTT · 48.0 KB/s |
| Blackwater Relay | 97.0 ms | 233.4 ms | 81.7 ms · 115 calls · 4802 triangles · 6 ms RTT · 51.1 KB/s |

Current production build: approximately 545 KB raw / 144 KB gzip across HTML, CSS and JavaScript. Original models, textures and audio are generated locally. The Three.js module contributes most download bytes. RTT and bandwidth above are local test observations, not wide-area network measurements.

Static meshes are merged by material. Low quality disables outlines and environmental point lights, reduces view distance and drawing resolution. The remaining software-rendered frame times are too high to claim the performance acceptance target. Measure full-route frame-time percentiles, memory and disposal on named physical devices and Safari/Apple Silicon before release.
