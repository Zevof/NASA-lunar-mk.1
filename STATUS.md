# Projektstatus – Zwischenstand 2026-11-11

## Speicherungen in diesem Ordner

| Datei | Größe | Inhalt |
|---|---|---|
| `snapshot_20261111_191454.zip` | 27,7 MB | Vollständiger Projektstand (401 Einträge, index.html, app.js, 42 Texturen, 7 Tests) |
| `zwischenspeicher_20261111_191637.zip` | 55,4 MB | Erweiterter Stand inkl. obigem Snapshot (809 Einträge) |

Beide Archive wurden per ZipFile-Prüfung verifiziert: enthalten `static/index.html`, `static/app.js`, `static/textures/` (42 bzw. 84 Einträge), `tests/`, `serve.py`.

## Was im Projekt funktioniert

| Bereich | Status | Beleg |
|---|---|---|
| Projektstruktur | OK | `static/`, `tests/`, `browsertest/`, `android/`, `docs/` |
| Relativistik | OK | `static/relativity-core.mjs`: `timeDilationFactor`, `properTimeSeconds`, `gravitationalRedshift`, `applyTimeDilationToTransfer` |
| Hohmann/Lambert | OK | `static/mission-transfer-core.mjs`: `hohmannTransfer`, `lambertTransfer`, `biEllipticTransfer`, `swingByTransfer` |
| Landestellen | OK | `static/landing-sites-core.mjs` (13 KB, echte Daten) |
| Planeten-Texturen | OK | 42 Texturen in `static/textures/` inkl. aller 8 Planeten |
| Scroll-Layout | OK | `static/styles.css`: beide Panels `overflow-y:auto`, `height:100%`, gleiche Grid-Row |
| Sonnenlicht-Geometrie | OK | `static/sunlight-core.mjs`: `sunlightDirectionFromPositions`, `unifiedSunLightingVector` |

## Was NICHT umgesetzt ist

| Anforderung | Ist-Zustand |
|---|---|
| Eine einzige Lichtquelle | `static/app.js` hat `AmbientLight` + drei `DirectionalLight` (`moonSunlight`, `earthSunlight`, `solarKeyLight`) – keine `id="sunLight"` |
| `getSunDirectionWorld`-API | fehlt in `sunlight-core.mjs` (andere Namen vorhanden) |
| Planeten-Realismus-Module | `planet-realism-core.mjs`, `planet-texture-loader.mjs`, `planet-atmosphere.mjs`, `planet-rings.mjs`, `planet-rotation.mjs`, `planet-surface-relief.mjs` fehlen |
| Site-Vergleich-UI | `site-compare-ui.mjs` fehlt |
| Sonne/Erde-Horizont-UI | `sun-earth-horizon.mjs` fehlt |
| Planet-Real-Controls | `planet-real-controls.mjs` fehlt |
| Site-Export CSV/GPX | `site-export.mjs` fehlt |
| A11y-/Perf-Skripte | fehlen |
| `hohmann-diagram.mjs` | Stub (277 B) |
| `route-visualizer.mjs` | Stub (274 B) |
| `porkchop-heatmap.mjs` | Stub |
| `qa-selfcheck.mjs` | Stub |
| `controls-core.mjs` Exporte | keine `export`-Anweisungen |
| `ui-core.mjs` neue Panels | keine Panel-Mounts |
| `docs/` | leer |
| Neue Tests | nur die alten 7 Tests |
| Altlasten | `lunar-link-planner` und ZIP-Dateien neben `lunar mk.1` noch vorhanden |
| Verbotene Wörter in README | keine Treffer |

## Nächste Schritte

1. In `app.js`/`index.html`: genau EINE `<directionalLight id="sunLight">`, kein Ambient, kein Zweitlicht.
2. `sunlight-core.mjs` um `getSunDirectionWorld` als Wrapper erweitern.
3. Fehlende Module implementieren (Realismus, Loader, Atmosphäre, Ringe, Rotation, Relief, Site-Vergleich, Horizont, Controls, Export).
4. Stubs ersetzen.
5. `controls-core.mjs`, `ui-core.mjs` erweitern.
6. Tests + Browser-Tests ergänzen.
7. `docs/` füllen.
8. Altlasten entfernen.
