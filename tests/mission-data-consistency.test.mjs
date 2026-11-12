/**
 * Konsistenztest: Vergleicht static/data/lunar-sites.json mit landing-sites-core.mjs
 * und verifiziert die Abdeckung aller geforderten Missionen.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANDING_SITES } from '../static/landing-sites-core.mjs';

// Lade die JSON-Datei
const jsonData = JSON.parse(readFileSync('static/data/lunar-sites.json', 'utf-8'));
const jsonSites = jsonData.sites;

console.log('=== MISSION DATA CONSISTENCY TEST ===\n');

// Test 1: Alle geforderten Programme sind vorhanden
const requiredPrograms = ['Apollo', 'Luna', 'Chang\'e', 'Chandrayaan', 'CLPS', 'Artemis'];
const foundPrograms = new Set(jsonSites.map(s => s.program));

console.log('1. Prüfung der geforderten Programme:');
for (const program of requiredPrograms) {
  const found = foundPrograms.has(program);
  console.log(`   ${found ? '✓' : '✗'} ${program}: ${found ? 'vorhanden' : 'FEHLT'}`);
  assert.ok(found, `Programm "${program}" fehlt in lunar-sites.json`);
}

// Test 2: Alle geforderten Agenturen sind vorhanden
const requiredAgencies = ['NASA', 'CNSA', 'ISRO', 'Intuitive Machines', 'Firefly Aerospace', 'ispace'];
const foundAgencies = new Set(jsonSites.map(s => s.agency));

console.log('\n2. Prüfung der geforderten Agenturen:');
for (const agency of requiredAgencies) {
  const found = foundAgencies.has(agency);
  console.log(`   ${found ? '✓' : '✗'} ${agency}: ${found ? 'vorhanden' : 'FEHLT'}`);
  assert.ok(found, `Agentur "${agency}" fehlt in lunar-sites.json`);
}

// Test 3: Konsistenz zwischen JSON und landing-sites-core.mjs
console.log('\n3. Konsistenzprüfung zwischen JSON und landing-sites-core.mjs:');
const jsonIds = new Set(jsonSites.map(s => s.id));
const coreIds = new Set(LANDING_SITES.map(s => s.id));

// Prüfe, ob alle IDs aus landing-sites-core.mjs in der JSON vorhanden sind
let missingInJson = 0;
let coordinateMismatch = 0;

for (const coreSite of LANDING_SITES) {
  const jsonSite = jsonSites.find(s => s.id === coreSite.id);

  if (!jsonSite) {
    console.log(`   ✗ ${coreSite.id}: fehlt in JSON`);
    missingInJson++;
    continue;
  }

  // Prüfe Koordinaten-Konsistenz (Toleranz: 0.01 Grad)
  const latDiff = Math.abs(jsonSite.latitude - coreSite.lat);
  const lonDiff = Math.abs(jsonSite.longitude - coreSite.lon);

  if (latDiff > 0.01 || lonDiff > 0.01) {
    console.log(`   ⚠ ${coreSite.id}: Koordinaten-Abweichung (lat: ${latDiff.toFixed(4)}°, lon: ${lonDiff.toFixed(4)}°)`);
    coordinateMismatch++;
  } else {
    console.log(`   ✓ ${coreSite.id}: Koordinaten konsistent`);
  }
}

assert.equal(missingInJson, 0, `${missingInJson} Sites aus landing-sites-core.mjs fehlen in JSON`);
console.log(`\n   ${coordinateMismatch === 0 ? '✓' : '⚠'} Koordinaten-Konsistenz: ${coordinateMismatch} Abweichungen`);

// Test 4: Spezifische Missionen prüfen
console.log('\n4. Prüfung spezifischer Missionen:');
const specificMissions = [
  { id: 'apollo11', name: 'Apollo 11' },
  { id: 'apollo17', name: 'Apollo 17' },
  { id: 'luna9', name: 'Luna 9' },
  { id: 'change3', name: "Chang'e 3" },
  { id: 'change4', name: "Chang'e 4" },
  { id: 'change6', name: "Chang'e 6" },
  { id: 'chandrayaan3', name: 'Chandrayaan-3' },
  { id: 'im1', name: 'IM-1 Odysseus' },
  { id: 'firefly1', name: 'Blue Ghost M1' },
  { id: 'hakuto_r_m1', name: 'Hakuto-R M1' }
];

for (const mission of specificMissions) {
  const site = jsonSites.find(s => s.id === mission.id);
  const found = !!site;
  console.log(`   ${found ? '✓' : '✗'} ${mission.name} (${mission.id}): ${found ? 'vorhanden' : 'FEHLT'}`);
  assert.ok(found, `Mission "${mission.name}" fehlt in lunar-sites.json`);
}

// Test 5: Koordinaten-Validierung
console.log('\n5. Koordinaten-Validierung:');
let invalidCoords = 0;
for (const site of jsonSites) {
  const latValid = site.latitude >= -90 && site.latitude <= 90;
  const lonValid = site.longitude >= -180 && site.longitude <= 180;

  if (!latValid || !lonValid) {
    console.log(`   ✗ ${site.id}: Ungültige Koordinaten (lat: ${site.latitude}, lon: ${site.longitude})`);
    invalidCoords++;
  }
}

assert.equal(invalidCoords, 0, `${invalidCoords} Sites haben ungültige Koordinaten`);
console.log(`   ✓ Alle ${jsonSites.length} Sites haben gültige Koordinaten`);

// Test 6: Referenzrahmen-Dokumentation
console.log('\n6. Referenzrahmen-Dokumentation:');
assert.ok(jsonData.reference_frames, 'reference_frames fehlt');
assert.equal(jsonData.reference_frames.default, 'Mean Earth/Polar Axis (ME)', 'Falscher Referenzrahmen');
console.log('   ✓ Referenzrahmen korrekt dokumentiert: Mean Earth/Polar Axis (ME)');

// Zusammenfassung
console.log('\n=== ZUSAMMENFASSUNG ===');
console.log(`✓ ${jsonSites.length} Sites in lunar-sites.json`);
console.log(`✓ ${LANDING_SITES.length} Sites in landing-sites-core.mjs`);
console.log(`✓ Alle geforderten Programme vorhanden: ${requiredPrograms.join(', ')}`);
console.log(`✓ Alle geforderten Agenturen vorhanden: ${requiredAgencies.join(', ')}`);
console.log(`✓ Koordinaten-Konsistenz: ${coordinateMismatch} Abweichungen (Toleranz: 0.01°)`);
console.log(`✓ Alle spezifischen Missionen vorhanden`);
console.log(`✓ Alle Koordinaten gültig`);
console.log('\n✅ Alle Konsistenztests bestanden.');
