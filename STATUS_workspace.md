# Projektstatus – Zwischenstand 2026-11-11 19:15

Dieser Bericht hält den **tatsächlichen** Zustand fest, geprüft per Tool-Output, nicht per Agenten-Behauptung.

## Verzeichnis

- Projektwurzel: `C:\Users\sahin\Downloads\NASA lunar\lunar mk.1\`
- Snapshot: `snapshot_20261111_191454.zip` (27,7 MB, ohne node_modules)

## Was tatsächlich funktioniert

| Bereich | Status | Beleg |
|---|---|---|
| Projekt migriert | OK | `lunar mk.1` enthält static, tests, browsertest, docs, node_modules |
| Relativistik-Modul | OK | `static/relativity-core.mjs` mit `timeDilationFactor`, `properTimeSeconds`, `gravitationalRedshift`, `applyTimeDilationToTransfer` |
| Hohmann/Lambert | OK | `static/mission-transfer-core.mjs` mit `hohmannTransfer`, `lambertTransfer`, `biEllipticTransfer`, `swingByTransfer` |
| Landestellen-Liste | OK | `static/landing-sites-core.mjs` (13 KB, echte Daten) |
| Texturen für alle Planeten | OK | Merkur/Venus/Mars/Jupiter/Saturn/Uranus/Neptun + Monde in `static/textures/` |

## Was NICHT umgesetzt ist (kritisch)

| Anforderung | Ist-Zustand |
|---|---|
| Sonne als einzige Lichtquelle | `static/app.js` hat `AmbientLight` + drei `DirectionalLight` (`moonSunlight`, `earthSunlight`, `solarKeyLight`). Kein `id="sunLight"`. |
| `getSunDirectionWorld` als Spec-API | `sunlight-core.mjs` exportiert stattdessen `sunlightDirectionFromPositions`, `unifiedSunLightingVector` etc. |
| Links/rechts scrollbar, gleiche Höhe | in `index.html`/`app.js` nicht nachgewiesen |
| Planeten-Realismus-Module | `planet-realism-core.mjs`, `planet-texture-loader.mjs`, `planet-atmosphere.mjs`, `planet-rings.mjs`, `planet-rotation.mjs`, `planet-surface-relief.mjs` fehlen komplett |
| Site-Vergleich-UI | `site-compare-ui.mjs` fehlt |
| Sonne/Erde-Horizont-UI | `sun-earth-horizon.mjs` fehlt |
| Planet-Real-Controls | `planet-real-controls.mjs` fehlt |
| Site-Export CSV/GPX | `site-export.mjs` fehlt |
| A11y-Audit, Perf-Metrics | fehlen |
| `hohmann-diagram.mjs` | nur Stub (277 Bytes) |
| `route-visualizer.mjs` | nur Stub (274 Bytes) |
| `porkchop-heatmap.mjs` | nur Stub |
| `qa-selfcheck.mjs` | nur Stub |
| `controls-core.mjs` Exporte (`setDateTime` etc.) | keine `export`-Anweisungen |
| `ui-core.mjs` neue Panels | keine Panel-Mounts |
| Dokumentation in `docs/` | Ordner leer |
| Neue Tests in `tests/` | nur die alten 7 Tests |
| Neue Browser-Tests | nur alte Tests, die neuen fehlen |
| Altlasten entfernt | `lunar-link-planner` und `.zip`-Altlasten existieren noch neben `lunar mk.1` |
| Verbotene Wörter in README | keine Treffer |

## Nächste Schritte (zweite Integrationswelle)

1. `sunlight-core.mjs` um `getSunDirectionWorld` als Wrapper erweitern (nutzt vorhandene Berechnungen).
2. `app.js` + `index.html`: genau EINE `<directionalLight id="sunLight">`, kein Ambient, kein Zweitlicht. Update-Pfad aus `getSunDirectionWorld`.
3. Scroll-Layout in `styles.css`/`ui.css`: `#leftPanel`/`#rightPanel` overflow-y:auto, Höhe = Viewport.
4. Alle fehlenden Module anlegen (realism, loader, atmosphere, rings, rotation, relief, site-compare, sun-earth-horizon, planet-real-controls, site-export).
5. Stubs durch echte Implementierungen ersetzen.
6. `controls-core.mjs` + `ui-core.mjs` erweitern.
7. Tests und Browser-Tests ergänzen.
8. `docs/` füllen.
9. Altlasten-Ordner löschen.
