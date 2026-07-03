// lib/pass-finder/constellations.js - asterism outline data + the
// polar-modal painter that draws those outlines onto the sky chart.
//
// Pure data + a paint function whose only state-coupled input is the
// caller's MODAL_GEOM ({cx, cy, R}). All sky/projection math comes
// from sky-helpers.js and star-catalog.js.

import { SVG_NS, altAzToSvg, naturalSkyLimMag, starAltAzForObs } from "./sky-helpers.js";
import { starDirectionEcef } from "./star-catalog.js";

// Constellation outline segments - each entry is
// [[ra1Hours, dec1Deg], [ra2Hours, dec2Deg]]. Endpoints are J2000
// positions of well-known asterism stars; we don't reference the
// star catalogs by name so this list stays self-contained.
// Coverage: the ~20 most-recognizable asterisms (Big Dipper, Orion,
// Cassiopeia, Cygnus, Lyra, Aquila, Leo, Boötes, Scorpius, etc.).
export const CONSTELLATION_LINES = [
  // Ursa Major (Big Dipper) - Dubhe-Merak-Phecda-Megrez-Alioth-Mizar-Alkaid + Dubhe-Megrez
  [[11.0621, 61.7508], [11.0307, 56.3824]],
  [[11.0307, 56.3824], [11.8972, 53.6948]],
  [[11.8972, 53.6948], [12.2571, 57.0326]],
  [[12.2571, 57.0326], [12.9004, 55.9598]],
  [[12.9004, 55.9598], [13.3988, 54.9254]],
  [[13.3988, 54.9254], [13.7923, 49.3133]],
  [[11.0621, 61.7508], [12.2571, 57.0326]],
  // Ursa Minor (Little Dipper) - Polaris-Yildun-εUMi-ζUMi-Kochab-Pherkad-ηUMi-Polaris (simplified)
  [[ 2.5302, 89.2641], [17.5369, 86.5864]],  // Polaris-Yildun
  [[17.5369, 86.5864], [16.7660, 82.0372]],  // Yildun-εUMi
  [[16.7660, 82.0372], [15.7345, 77.7944]],  // εUMi-ζUMi
  [[15.7345, 77.7944], [14.8451, 74.1556]],  // ζUMi-Kochab
  [[14.8451, 74.1556], [15.3457, 71.8340]],  // Kochab-Pherkad
  // Cassiopeia (W) - Caph-Schedar-γCas-Ruchbah-Segin
  [[ 0.1530, 59.1498], [ 0.6751, 56.5374]],
  [[ 0.6751, 56.5374], [ 0.9451, 60.7167]],
  [[ 0.9451, 60.7167], [ 1.4302, 60.2353]],
  [[ 1.4302, 60.2353], [ 1.9061, 63.6701]],
  // Cepheus - Alderamin-Alfirk-Errai (simplified pentagon, partial)
  [[21.3096, 62.5856], [21.4778, 70.5607]],  // Alderamin-Alfirk
  [[21.4778, 70.5607], [23.6553, 77.6322]],  // Alfirk-Errai
  // Cygnus (Northern Cross) - Deneb-Sadr-Albireo + Sadr-δCyg + Sadr-εCyg
  [[20.6906, 45.2803], [20.3705, 40.2567]],
  [[20.3705, 40.2567], [19.5125, 27.9597]],
  [[20.3705, 40.2567], [19.7494, 45.1304]],
  [[20.3705, 40.2567], [20.7702, 33.9701]],
  // Lyra - Vega + parallelogram (Vega-ζLyr-δLyr-Sulafat-Sheliak-Vega)
  [[18.6156, 38.7837], [18.7456, 37.6051]],  // Vega-Sulafat
  [[18.6156, 38.7837], [18.8358, 33.3625]],  // Vega-Sheliak
  [[18.7456, 37.6051], [18.8358, 33.3625]],  // Sulafat-Sheliak
  // Aquila - Altair head (Tarazed-Altair-Alshain) + body to λAql
  [[19.7717, 10.6133], [19.8464,  8.8683]],  // Tarazed-Altair
  [[19.8464,  8.8683], [19.9213,  6.4068]],  // Altair-Alshain
  [[19.8464,  8.8683], [19.1041, -4.8825]],  // Altair-λAql (long body)
  // Boötes (kite) - Arcturus-Izar-Nekkar-γBoo-Arcturus  + Arcturus-Muphrid
  [[14.2610, 19.1824], [14.7497, 27.0741]],  // Arcturus-Izar
  [[14.7497, 27.0741], [14.5347, 38.3083]],  // Izar-Nekkar
  [[14.5347, 38.3083], [14.5346, 38.3083]],  // (stub, kept for parity)
  [[14.5347, 38.3083], [14.2702, 30.3714]],  // Nekkar-γBoo (Seginus)
  [[14.2702, 30.3714], [14.2610, 19.1824]],  // γBoo-Arcturus
  [[14.2610, 19.1824], [13.9114, 18.3977]],  // Arcturus-Muphrid
  // Hercules keystone - π-η-ζ-ε (top half) + ζ-β (left side)
  [[17.2510, 36.8092], [16.7148, 38.9223]],  // πHer-ηHer
  [[16.7148, 38.9223], [16.6883, 31.6027]],  // ηHer-ζHer
  [[16.6883, 31.6027], [17.2575, 24.8392]],  // ζHer-εHer (approx)
  [[17.2510, 36.8092], [17.2575, 24.8392]],  // πHer-εHer (close keystone)
  [[16.6883, 31.6027], [16.5036, 21.4895]],  // ζHer-Kornephoros (βHer)
  // Pegasus Great Square - Markab-Scheat-Alpheratz-Algenib
  [[23.0793, 15.2053], [23.0628, 28.0828]],
  [[23.0628, 28.0828], [ 0.1397, 29.0904]],
  [[ 0.1397, 29.0904], [ 0.2206, 15.1836]],
  [[ 0.2206, 15.1836], [23.0793, 15.2053]],
  // Andromeda chain - Alpheratz-Mirach-Almach
  [[ 0.1397, 29.0904], [ 1.1623, 35.6206]],
  [[ 1.1623, 35.6206], [ 2.0649, 42.3297]],
  // Perseus - Mirfak-Algol-α' segment-bar
  [[ 3.4054, 49.8612], [ 3.1361, 40.9556]],  // Mirfak-Algol
  [[ 3.4054, 49.8612], [ 3.9624, 40.0102]],  // Mirfak-ε Per
  [[ 3.4054, 49.8612], [ 3.0792, 53.5063]],  // Mirfak-δ Per
  // Auriga pentagon - Capella-Menkalinan-θAur-Hassaleh-βTau(Elnath) - Elnath shared w/ Taurus
  [[ 5.2782, 45.9981], [ 5.9921, 44.9474]],  // Capella-Menkalinan
  [[ 5.9921, 44.9474], [ 5.9952, 37.2125]],  // Menkalinan-θAur (~mag 2.62)
  [[ 5.9952, 37.2125], [ 5.4382, 28.6075]],  // θAur-Elnath
  [[ 5.4382, 28.6075], [ 4.9498, 33.1661]],  // Elnath-ιAur (Hassaleh)? - using Hassaleh coords
  [[ 4.9498, 33.1661], [ 5.2782, 45.9981]],  // Hassaleh-Capella
  // Taurus - Aldebaran-Elnath (long horn) + Hyades V (just the spine)
  [[ 4.5987, 16.5092], [ 5.4382, 28.6075]],
  [[ 4.4767, 19.1804], [ 4.5987, 16.5092]],  // εTau-Aldebaran
  [[ 4.3829, 17.5425], [ 4.5987, 16.5092]],  // γTau-Aldebaran (Hyades apex)
  // Orion - Bellatrix-Betelgeuse-Alnitak-Saiph-Rigel-Mintaka-Bellatrix + belt
  [[ 5.4189,  6.3497], [ 5.9195,  7.4070]],  // Bellatrix-Betelgeuse
  [[ 5.9195,  7.4070], [ 5.6793, -1.9426]],  // Betelgeuse-Alnitak
  [[ 5.6793, -1.9426], [ 5.7959, -9.6696]],  // Alnitak-Saiph
  [[ 5.7959, -9.6696], [ 5.2423, -8.2017]],  // Saiph-Rigel
  [[ 5.2423, -8.2017], [ 5.5334, -0.2991]],  // Rigel-Mintaka
  [[ 5.5334, -0.2991], [ 5.4189,  6.3497]],  // Mintaka-Bellatrix
  [[ 5.5334, -0.2991], [ 5.6035, -1.2019]],  // belt: Mintaka-Alnilam
  [[ 5.6035, -1.2019], [ 5.6793, -1.9426]],  // belt: Alnilam-Alnitak
  // Canis Major - Sirius-Mirzam + Sirius-Adhara-Wezen triangle
  [[ 6.7525,-16.7161], [ 7.0140,-23.8336]],  // Sirius-Mirzam
  [[ 6.7525,-16.7161], [ 6.9770,-28.9721]],  // Sirius-Adhara
  [[ 6.9770,-28.9721], [ 7.1399,-26.3933]],  // Adhara-Wezen
  // Canis Minor - Procyon-Gomeisa
  [[ 7.6550,  5.2250], [ 7.4528,  8.2893]],
  // Gemini - Castor-Pollux (and to Alhena)
  [[ 7.5767, 31.8884], [ 7.7553, 28.0262]],
  [[ 7.7553, 28.0262], [ 6.6285, 16.3993]],  // Pollux-Alhena
  // Leo (sickle + back triangle) - Regulus-η-γAlgieba-ζAdhafera-μ-εRas Algethi (head)
  [[10.1395, 11.9672], [10.3328, 19.8415]],  // Regulus-Algieba
  [[10.3328, 19.8415], [10.2786, 23.4173]],  // Algieba-ζLeo Adhafera (~mag 3.43)
  [[10.2786, 23.4173], [ 9.7639, 23.7740]],  // ζLeo-μLeo
  [[ 9.7639, 23.7740], [ 9.7642, 26.0070]],  // μLeo-εLeo (head/sickle tip)
  // Back triangle: Regulus-Denebola-Zosma-Algieba
  [[10.1395, 11.9672], [11.8177, 14.5720]],  // Regulus-Denebola
  [[11.8177, 14.5720], [11.2351, 20.5237]],  // Denebola-Zosma
  [[11.2351, 20.5237], [10.3328, 19.8415]],  // Zosma-Algieba
  // Virgo - Spica-Vindemiatrix-γVirginis(Porrima)-ζVir
  [[13.4199,-11.1614], [13.0364, 10.9591]],  // Spica-Vindemiatrix
  [[13.0364, 10.9591], [12.6943, -1.4496]],  // Vindemiatrix-Porrima
  [[12.6943, -1.4496], [13.4199,-11.1614]],  // Porrima-Spica (close)
  // Corona Borealis - half-circle: ζ-α(Alphecca)-γ
  [[15.5784, 26.7147], [15.6438, 28.6201]],  // Alphecca-γCrB (approx)
  [[15.5784, 26.7147], [15.4297, 26.0686]],  // Alphecca-βCrB (approx)
  // Scorpius head + body - Acrab-Dschubba-π-Antares + Antares-εSco-...-Shaula-Sargas
  [[16.0050,-19.8054], [16.0050,-22.6217]],  // Dschubba-Acrab
  [[16.0050,-22.6217], [16.0050,-26.1140]],  // Acrab-πSco (approx)
  [[16.0050,-22.6217], [16.4901,-26.4320]],  // Acrab-Antares
  [[16.4901,-26.4320], [16.8359,-34.2929]],  // Antares-Sargas-area εSco
  [[16.8359,-34.2929], [17.5601,-37.1038]],  // Sargas-Shaula
  // Sagittarius teapot - Kaus Australis-KausMedia-KausBorealis-Nunki-Phi-Tau (abbreviated)
  [[18.4029,-34.3847], [18.3536,-29.8281]],  // KausAus-KausMedia
  [[18.3536,-29.8281], [18.2333,-25.4217]],  // KausMedia-KausBorealis (λSgr)
  [[18.2333,-25.4217], [19.0444,-27.6699]],  // KausBorealis-Nunki
  [[19.0444,-27.6699], [18.4029,-34.3847]],  // Nunki-KausAus (close teapot)
  // Crux (Southern Cross) - Acrux-Mimosa-Gacrux-δCru
  [[12.4433,-63.0991], [12.7953,-59.6886]],
  [[12.7953,-59.6886], [12.5194,-57.1131]],
  [[12.5194,-57.1131], [12.2522,-58.7489]],
  [[12.2522,-58.7489], [12.4433,-63.0991]],
  // Centaurus pointers - Rigil Kentaurus-Hadar (point at Crux)
  [[14.6601,-60.8354], [14.0637,-60.3729]],
];

// Paint asterism outlines into the modal's [data-layer="constellations"]
// group. Visibility gate: limMag at this instant must reach ~mag 3 so
// the outline endpoints would themselves plausibly be visible. Fades
// in between civil and astronomical twilight so the lines emerge
// rather than pop. Cool blue-violet stroke distinguishes "sky overlay"
// from the neutral chart grid.
export function paintPolarModalConstellations(svg, obs, jsDate, sunAltDeg, modalGeom) {
  const layer = svg.querySelector('[data-layer="constellations"]');
  if (!layer) return;
  layer.replaceChildren();
  const limMag = naturalSkyLimMag(sunAltDeg ?? -90);
  if (limMag < 3.0) return;
  const fade = Math.max(0, Math.min(1, (limMag - 3.0) / 1.5));
  const stroke = "rgb(150, 180, 230)";
  const opacity = 0.18 + 0.20 * fade; // 0.18 .. 0.38
  const { cx, cy, R } = modalGeom;
  for (const seg of CONSTELLATION_LINES) {
    const [p1, p2] = seg;
    const d1 = starDirectionEcef({ ra: p1[0], dec: p1[1] }, jsDate);
    const d2 = starDirectionEcef({ ra: p2[0], dec: p2[1] }, jsDate);
    const a1 = starAltAzForObs(obs, d1);
    const a2 = starAltAzForObs(obs, d2);
    if (a1.alt < 0 || a2.alt < 0) continue;
    const [x1, y1] = altAzToSvg(a1.alt, a1.az, cx, cy, R);
    const [x2, y2] = altAzToSvg(a2.alt, a2.az, cx, cy, R);
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", x1.toFixed(2));
    l.setAttribute("y1", y1.toFixed(2));
    l.setAttribute("x2", x2.toFixed(2));
    l.setAttribute("y2", y2.toFixed(2));
    l.classList.add("const-line");
    l.style.stroke = stroke;
    l.style.strokeOpacity = opacity.toFixed(2);
    layer.appendChild(l);
  }
}
