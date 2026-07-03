// lib/pass-finder/star-catalog.js - bright-star catalogs + spectral
// color table + per-star dot styling for the polar-modal sky-chart
// renderer and the 3D-scene star labels.
//
// Catalogs are pure data; the rendering helpers below
// (starDotColor / starDotRadius / starDotOpacity / starDirectionEcef)
// are pure functions of their inputs. The 3D-scene star labels in
// pass-finder-scene.js wrap starLabelPos / planetSkyPos around these
// because those need viewer.camera + Cesium for camera-relative
// placement.
//
// RA in decimal hours, Dec in decimal degrees, J2000 epoch.
// `cls` is the dominant Morgan-Keenan spectral class letter
// (O/B/A/F/G/K/M) - maps to SPECTRAL_COLOR for chart rendering.

import * as sat from "satellite.js";

// Brightest naked-eye stars + a few constellation markers (Polaris,
// Big-Dipper bowl). These are the ones that get NAMED labels in the
// 3D scene, in addition to being plotted as dots in the polar modal.
export const BRIGHT_STARS = [
  { name: "Sirius",         ra:  6.7525, dec: -16.7161, mag: -1.46, cls: "A" },
  { name: "Canopus",        ra:  6.3992, dec: -52.6957, mag: -0.74, cls: "A" },
  { name: "Arcturus",       ra: 14.2610, dec:  19.1824, mag: -0.05, cls: "K" },
  { name: "Vega",           ra: 18.6156, dec:  38.7837, mag:  0.03, cls: "A" },
  { name: "Capella",        ra:  5.2782, dec:  45.9981, mag:  0.08, cls: "G" },
  { name: "Rigel",          ra:  5.2423, dec:  -8.2017, mag:  0.13, cls: "B" },
  { name: "Procyon",        ra:  7.6550, dec:   5.2250, mag:  0.34, cls: "F" },
  { name: "Betelgeuse",     ra:  5.9195, dec:   7.4070, mag:  0.50, cls: "M" },
  { name: "Achernar",       ra:  1.6286, dec: -57.2367, mag:  0.46, cls: "B" },
  { name: "Hadar",          ra: 14.0637, dec: -60.3729, mag:  0.61, cls: "B" },
  { name: "Altair",         ra: 19.8464, dec:   8.8683, mag:  0.77, cls: "A" },
  { name: "Acrux",          ra: 12.4433, dec: -63.0991, mag:  0.76, cls: "B" },
  { name: "Aldebaran",      ra:  4.5987, dec:  16.5092, mag:  0.86, cls: "K" },
  { name: "Antares",        ra: 16.4901, dec: -26.4320, mag:  1.06, cls: "M" },
  { name: "Spica",          ra: 13.4199, dec: -11.1614, mag:  0.97, cls: "B" },
  { name: "Pollux",         ra:  7.7553, dec:  28.0262, mag:  1.14, cls: "K" },
  { name: "Fomalhaut",      ra: 22.9608, dec: -29.6222, mag:  1.17, cls: "A" },
  { name: "Deneb",          ra: 20.6906, dec:  45.2803, mag:  1.25, cls: "A" },
  { name: "Mimosa",         ra: 12.7953, dec: -59.6886, mag:  1.25, cls: "B" },
  { name: "Regulus",        ra: 10.1395, dec:  11.9672, mag:  1.36, cls: "B" },
  { name: "Adhara",         ra:  6.9770, dec: -28.9721, mag:  1.50, cls: "B" },
  { name: "Castor",         ra:  7.5767, dec:  31.8884, mag:  1.58, cls: "A" },
  { name: "Shaula",         ra: 17.5601, dec: -37.1038, mag:  1.62, cls: "B" },
  { name: "Gacrux",         ra: 12.5194, dec: -57.1131, mag:  1.63, cls: "M" },
  { name: "Bellatrix",      ra:  5.4189, dec:   6.3497, mag:  1.64, cls: "B" },
  { name: "Elnath",         ra:  5.4382, dec:  28.6075, mag:  1.65, cls: "B" },
  { name: "Miaplacidus",    ra:  9.2200, dec: -69.7172, mag:  1.69, cls: "A" },
  { name: "Alnilam",        ra:  5.6035, dec:  -1.2019, mag:  1.69, cls: "B" },
  { name: "Alnitak",        ra:  5.6793, dec:  -1.9426, mag:  1.77, cls: "O" },
  { name: "Mintaka",        ra:  5.5334, dec:  -0.2991, mag:  2.23, cls: "O" },
  { name: "Saiph",          ra:  5.7959, dec:  -9.6696, mag:  2.09, cls: "B" },
  { name: "Wezen",          ra:  7.1399, dec: -26.3933, mag:  1.83, cls: "F" },
  { name: "Kaus Australis", ra: 18.4029, dec: -34.3847, mag:  1.85, cls: "B" },
  { name: "Avior",          ra:  8.3753, dec: -59.5095, mag:  1.86, cls: "K" },
  { name: "Alkaid",         ra: 13.7923, dec:  49.3133, mag:  1.85, cls: "B" },
  { name: "Menkalinan",     ra:  5.9921, dec:  44.9474, mag:  1.90, cls: "A" },
  { name: "Atria",          ra: 16.8111, dec: -69.0277, mag:  1.91, cls: "K" },
  { name: "Alhena",         ra:  6.6285, dec:  16.3993, mag:  1.93, cls: "A" },
  { name: "Peacock",        ra: 20.4275, dec: -56.7351, mag:  1.94, cls: "B" },
  { name: "Mirfak",         ra:  3.4054, dec:  49.8612, mag:  1.79, cls: "F" },
  { name: "Dubhe",          ra: 11.0621, dec:  61.7508, mag:  1.79, cls: "K" },
  { name: "Mizar",          ra: 13.3988, dec:  54.9254, mag:  2.23, cls: "A" },
  { name: "Alioth",         ra: 12.9004, dec:  55.9598, mag:  1.76, cls: "A" },
  { name: "Merak",          ra: 11.0307, dec:  56.3824, mag:  2.37, cls: "A" },
  { name: "Phecda",         ra: 11.8972, dec:  53.6948, mag:  2.44, cls: "A" },
  { name: "Megrez",         ra: 12.2571, dec:  57.0326, mag:  3.31, cls: "A" },
  { name: "Schedar",        ra:  0.6751, dec:  56.5374, mag:  2.24, cls: "K" },
  { name: "Caph",           ra:  0.1530, dec:  59.1498, mag:  2.27, cls: "F" },
  { name: "Ruchbah",        ra:  1.4302, dec:  60.2353, mag:  2.66, cls: "A" },
  { name: "Sadr",           ra: 20.3705, dec:  40.2567, mag:  2.23, cls: "F" },
  { name: "Albireo",        ra: 19.5125, dec:  27.9597, mag:  3.18, cls: "K" },
  { name: "Hamal",          ra:  2.1196, dec:  23.4624, mag:  2.00, cls: "K" },
  { name: "Algol",          ra:  3.1361, dec:  40.9556, mag:  2.12, cls: "B" },
  { name: "Diphda",         ra:  0.7264, dec: -17.9866, mag:  2.04, cls: "K" },
  { name: "Markab",         ra: 23.0793, dec:  15.2053, mag:  2.49, cls: "A" },
  { name: "Alpheratz",      ra:  0.1397, dec:  29.0904, mag:  2.06, cls: "B" },
  { name: "Almach",         ra:  2.0649, dec:  42.3297, mag:  2.10, cls: "K" },
  { name: "Polaris",        ra:  2.5302, dec:  89.2641, mag:  1.98, cls: "F" },
  { name: "Alcyone",        ra:  3.7913, dec:  24.1052, mag:  2.87, cls: "B" },
];

// Supplemental fainter catalog - RA/Dec/mag, no names. Plotted as dots
// in the fullscreen polar modal to give the sky chart visual density,
// but NOT added as labels in the 3D scene (would crowd the globe).
// J2000 epoch, mostly mag 2.0 - 3.5.
export const MORE_STARS = [
  { ra:  1.1623, dec:  35.6206, mag: 2.07, cls: "M" },  // Mirach β And
  { ra: 22.0964, dec:  -0.3198, mag: 2.95, cls: "G" },  // Sadalmelik α Aqr
  { ra: 21.5260, dec:  -5.5712, mag: 2.87, cls: "G" },  // Sadalsuud β Aqr
  { ra: 19.7717, dec:  10.6133, mag: 2.72, cls: "K" },  // Tarazed γ Aql
  { ra: 19.9213, dec:   6.4068, mag: 3.71, cls: "G" },  // Alshain β Aql
  { ra:  1.9118, dec:  20.8081, mag: 2.65, cls: "A" },  // Sheratan β Ari
  { ra:  6.0651, dec:  37.2125, mag: 2.69, cls: "K" },  // Hassaleh ι Aur
  { ra: 14.7497, dec:  27.0741, mag: 2.35, cls: "K" },  // Izar ε Boo
  { ra: 14.5347, dec:  38.3083, mag: 3.50, cls: "G" },  // Nekkar β Boo
  { ra: 13.9114, dec:  18.3977, mag: 2.68, cls: "G" },  // Muphrid η Boo
  { ra:  8.7747, dec:  18.1542, mag: 3.94, cls: "K" },  // Asellus Australis δ Cnc
  { ra: 12.9337, dec:  38.3184, mag: 2.89, cls: "A" },  // Cor Caroli α CVn
  { ra:  7.0140, dec: -23.8336, mag: 1.98, cls: "B" },  // Mirzam β CMa
  { ra:  7.4017, dec: -29.3030, mag: 2.45, cls: "B" },  // Aludra η CMa
  { ra: 20.3000, dec: -14.7814, mag: 2.85, cls: "A" },  // Deneb Algedi δ Cap
  { ra:  3.0379, dec:   4.0897, mag: 2.54, cls: "M" },  // Menkar α Cet
  { ra:  5.6604, dec: -34.0741, mag: 2.65, cls: "B" },  // Phact α Col
  { ra: 15.5784, dec:  26.7147, mag: 2.23, cls: "A" },  // Alphecca α CrB
  { ra: 12.4172, dec: -22.6195, mag: 2.65, cls: "G" },  // Kraz β Crv
  { ra: 12.2635, dec: -17.5419, mag: 2.59, cls: "B" },  // Gienah γ Crv
  { ra: 20.6605, dec:  15.9120, mag: 3.77, cls: "B" },  // Sualocin α Del
  { ra: 14.0731, dec:  64.3758, mag: 3.65, cls: "A" },  // Thuban α Dra
  { ra: 17.9434, dec:  51.4889, mag: 2.24, cls: "K" },  // Eltanin γ Dra
  { ra: 16.3994, dec:  61.5141, mag: 2.79, cls: "G" },  // Rastaban β Dra
  { ra:  2.9707, dec: -40.3047, mag: 2.88, cls: "A" },  // Acamar θ Eri
  { ra: 22.1372, dec: -46.9609, mag: 1.74, cls: "B" },  // Alnair α Gru
  { ra: 17.2444, dec:  14.3903, mag: 3.06, cls: "M" },  // Rasalgethi α Her
  { ra: 16.5036, dec:  21.4895, mag: 2.78, cls: "G" },  // Kornephoros β Her
  { ra:  9.4598, dec:  -8.6586, mag: 1.98, cls: "K" },  // Alphard α Hya
  { ra: 11.8177, dec:  14.5720, mag: 2.14, cls: "A" },  // Denebola β Leo
  { ra: 10.3328, dec:  19.8415, mag: 2.61, cls: "K" },  // Algieba γ Leo
  { ra: 11.2351, dec:  20.5237, mag: 2.56, cls: "A" },  // Zosma δ Leo
  { ra: 14.8479, dec: -16.0418, mag: 2.61, cls: "B" },  // Zubeneschamali β Lib
  { ra: 14.7202, dec: -15.7297, mag: 2.75, cls: "A" },  // Zubenelgenubi α Lib
  { ra: 18.7456, dec:  37.6051, mag: 3.24, cls: "B" },  // Sulafat γ Lyr
  { ra: 18.8358, dec:  33.3625, mag: 3.45, cls: "B" },  // Sheliak β Lyr
  { ra: 17.5823, dec:  12.5601, mag: 2.07, cls: "A" },  // Rasalhague α Oph
  { ra: 17.1729, dec: -15.7249, mag: 2.43, cls: "A" },  // Sabik η Oph
  { ra: 23.0628, dec:  28.0828, mag: 2.42, cls: "M" },  // Scheat β Peg
  { ra: 21.7364, dec:   9.8750, mag: 2.39, cls: "K" },  // Enif ε Peg
  { ra:  0.2206, dec:  15.1836, mag: 2.83, cls: "B" },  // Algenib γ Peg
  { ra:  0.4380, dec: -42.3061, mag: 2.40, cls: "K" },  // Ankaa α Phe
  { ra: 18.3536, dec: -29.8281, mag: 2.70, cls: "K" },  // Kaus Media δ Sgr
  { ra: 18.2333, dec: -36.7615, mag: 2.81, cls: "K" },  // Kaus Borealis λ Sgr
  { ra: 19.0444, dec: -27.6699, mag: 2.05, cls: "B" },  // Nunki σ Sgr
  { ra: 16.6053, dec: -28.2161, mag: 2.82, cls: "B" },  // Alniyat τ Sco
  { ra: 16.0050, dec: -22.6217, mag: 2.50, cls: "B" },  // Graffias β Sco
  { ra: 16.8359, dec: -34.2929, mag: 1.86, cls: "F" },  // Sargas θ Sco
  { ra: 14.8451, dec:  74.1556, mag: 2.07, cls: "K" },  // Kochab β UMi
  { ra: 15.3457, dec:  71.8340, mag: 3.04, cls: "A" },  // Pherkad γ UMi
  { ra: 11.8378, dec:   1.7647, mag: 3.61, cls: "F" },  // Zavijava β Vir
  { ra: 13.0364, dec:  10.9591, mag: 2.83, cls: "G" },  // Vindemiatrix ε Vir
  { ra: 20.7702, dec:  33.9701, mag: 2.48, cls: "K" },  // Gienah ε Cyg
  { ra: 14.6601, dec: -60.8354, mag: -0.27, cls: "G" }, // Rigil Kentaurus α Cen
  { ra: 13.8228, dec: -47.2885, mag: 2.06, cls: "K" },  // Menkent θ Cen
  { ra:  8.7458, dec: -54.7086, mag: 1.83, cls: "O" },  // Suhail γ Vel (WR/early-type, hot blue)
  { ra:  9.1330, dec: -43.4326, mag: 1.93, cls: "A" },  // δ Vel
  { ra:  8.0586, dec: -40.0031, mag: 2.21, cls: "O" },  // Naos ζ Pup
  { ra:  3.7544, dec:  32.2880, mag: 2.85, cls: "O" },  // Atik ζ Per
];

// Even fainter fill-in catalog - RA/Dec/mag/cls. No names, no labels.
// Used to give the polar modal real sky density (typical naked-eye
// limit on a dark night is ~mag 6, suburban ~4 - these are mostly
// mag 3.0-4.0 stars on common constellation outlines).
export const FAINT_STARS = [
  { ra:  0.66, dec:  30.86, mag: 3.27, cls: "K" },  // δ And
  { ra:  0.95, dec:  38.50, mag: 3.86, cls: "A" },  // μ And
  { ra: 19.42, dec:   3.11, mag: 3.36, cls: "F" },  // δ Aql
  { ra: 19.09, dec:  13.86, mag: 2.99, cls: "A" },  // ζ Aql
  { ra: 20.19, dec:  -0.82, mag: 3.23, cls: "B" },  // θ Aql
  { ra: 19.10, dec:  -4.88, mag: 3.43, cls: "B" },  // λ Aql
  { ra: 22.36, dec:  -1.39, mag: 3.84, cls: "A" },  // γ Aqr
  { ra: 22.91, dec: -15.82, mag: 3.27, cls: "A" },  // δ Aqr (Skat)
  { ra: 14.27, dec:  30.37, mag: 3.04, cls: "A" },  // γ Boo (Seginus)
  { ra: 15.26, dec:  33.31, mag: 3.46, cls: "G" },  // δ Boo
  { ra:  0.94, dec:  60.72, mag: 2.68, cls: "B" },  // γ Cas
  { ra:  1.91, dec:  63.67, mag: 3.38, cls: "B" },  // ε Cas
  { ra:  2.72, dec:  10.11, mag: 3.47, cls: "G" },  // γ Cet
  { ra:  1.85, dec:  10.34, mag: 3.56, cls: "G" },  // δ Cet
  { ra:  1.73, dec: -15.94, mag: 3.49, cls: "K" },  // η Cet
  { ra: 21.31, dec:  62.59, mag: 2.45, cls: "A" },  // α Cep (Alderamin)
  { ra: 21.48, dec:  70.56, mag: 3.21, cls: "K" },  // β Cep (Alfirk)
  { ra: 23.66, dec:  77.63, mag: 3.21, cls: "K" },  // γ Cep (Errai)
  { ra: 12.50, dec: -22.62, mag: 3.18, cls: "K" },  // ε Crv
  { ra: 12.30, dec: -16.51, mag: 3.81, cls: "F" },  // ζ Crv
  { ra: 19.75, dec:  45.13, mag: 2.86, cls: "B" },  // δ Cyg
  { ra: 21.22, dec:  30.23, mag: 3.20, cls: "K" },  // ζ Cyg
  { ra: 20.71, dec:  16.12, mag: 3.63, cls: "F" },  // β Del (Rotanev)
  { ra: 18.35, dec:  72.73, mag: 2.73, cls: "K" },  // ζ Dra
  { ra: 19.21, dec:  67.66, mag: 3.07, cls: "G" },  // δ Dra
  { ra:  4.20, dec:  -6.84, mag: 2.97, cls: "M" },  // γ Eri (Zaurak)
  { ra:  3.55, dec:  -9.46, mag: 2.95, cls: "K" },  // δ Eri (Rana)
  { ra:  7.34, dec:  21.98, mag: 3.06, cls: "M" },  // μ Gem (Tejat)
  { ra:  6.38, dec:  22.51, mag: 2.87, cls: "M" },  // η Gem (Propus)
  { ra:  7.04, dec:  20.57, mag: 3.36, cls: "F" },  // ε Gem (Mebsuta)
  { ra:  7.43, dec:  27.80, mag: 3.50, cls: "F" },  // δ Gem (Wasat)
  { ra: 16.71, dec:  31.60, mag: 3.13, cls: "A" },  // δ Her
  { ra: 16.39, dec:  31.60, mag: 2.78, cls: "G" },  // ζ Her
  { ra: 17.25, dec:  36.81, mag: 3.16, cls: "A" },  // π Her
  { ra: 10.83, dec: -16.19, mag: 3.00, cls: "G" },  // γ Hya
  { ra:  8.93, dec:   5.95, mag: 3.11, cls: "B" },  // ζ Hya
  { ra:  5.55, dec: -17.82, mag: 2.58, cls: "F" },  // α Lep (Arneb)
  { ra:  5.47, dec: -20.76, mag: 2.81, cls: "G" },  // β Lep (Nihal)
  { ra: 14.71, dec: -47.39, mag: 2.30, cls: "B" },  // α Lup
  { ra: 15.07, dec: -52.10, mag: 2.68, cls: "B" },  // β Lup
  { ra: 16.61, dec:  -3.69, mag: 2.74, cls: "M" },  // δ Oph (Yed Prior)
  { ra: 16.62, dec:  -4.69, mag: 3.23, cls: "G" },  // ε Oph (Yed Posterior)
  { ra: 17.72, dec:   4.57, mag: 2.77, cls: "K" },  // β Oph (Cebalrai)
  { ra:  1.52, dec:  15.35, mag: 3.62, cls: "G" },  // η Psc (Alpherg)
  { ra:  7.72, dec: -37.10, mag: 2.71, cls: "F" },  // π Pup
  { ra:  6.83, dec: -50.61, mag: 3.01, cls: "K" },  // ν Pup
  { ra:  7.82, dec: -24.86, mag: 2.83, cls: "K" },  // ρ Pup
  { ra: 19.97, dec:  19.49, mag: 3.51, cls: "K" },  // γ Sge
  { ra: 18.96, dec: -29.88, mag: 2.59, cls: "A" },  // ζ Sgr (Ascella)
  { ra: 18.13, dec: -30.42, mag: 2.99, cls: "B" },  // γ Sgr (Alnasl)
  { ra: 17.71, dec: -37.30, mag: 2.69, cls: "B" },  // υ Sco
  { ra: 16.00, dec: -22.62, mag: 2.30, cls: "B" },  // β Sco (Graffias, dup safe)
  { ra: 16.00, dec: -19.81, mag: 2.32, cls: "B" },  // δ Sco (Dschubba)
  { ra: 15.74, dec:   6.43, mag: 2.63, cls: "K" },  // α Ser (Unukalhai)
  { ra:  4.84, dec:  19.18, mag: 3.41, cls: "A" },  // θ Tau
  { ra:  4.48, dec:  15.87, mag: 3.40, cls: "K" },  // ε Tau (Ain)
  { ra:  3.95, dec:  12.49, mag: 3.65, cls: "A" },  // γ Tau
  { ra:  4.38, dec:  17.93, mag: 3.76, cls: "K" },  // δ Tau
  { ra:  3.41, dec:  12.49, mag: 3.41, cls: "B" },  // λ Tau
  { ra:  2.16, dec:  34.99, mag: 3.00, cls: "A" },  // β Tri
  { ra: 11.30, dec:  31.53, mag: 3.06, cls: "K" },  // ψ UMa
  { ra:  9.79, dec: -54.57, mag: 2.21, cls: "K" },  // λ Vel
  { ra: 12.69, dec:  -1.45, mag: 2.74, cls: "F" },  // γ Vir (Porrima)
  { ra: 13.58, dec:   0.60, mag: 3.38, cls: "G" },  // ζ Vir
  { ra:  3.96, dec:  31.88, mag: 2.91, cls: "B" },  // ε Per
  { ra:  3.08, dec:  53.51, mag: 2.92, cls: "M" },  // δ Per
  { ra:  4.01, dec:  47.79, mag: 3.01, cls: "B" },  // γ Per
  { ra:  5.99, dec:  37.21, mag: 3.18, cls: "F" },  // δ Aur
  { ra:  6.06, dec:  39.18, mag: 3.69, cls: "K" },  // ν Aur
  { ra: 17.92, dec:   2.93, mag: 3.74, cls: "K" },  // β Ser
];

// Deep-sky fill catalog - mag 4.0 to 5.0, mostly constellation
// infill so the chart looks naturally dense on dark-sky nights
// (naturalSkyLimMag returns 5.0+ for sun below ~-15°). Same
// {ra,dec,mag,cls} shape as the other catalogs. No names; dots only.
export const DIM_STARS = [
  // Andromeda
  { ra:  0.8307, dec:  38.4992, mag: 4.41, cls: "B" },  // ε And
  { ra:  0.7295, dec:  23.4178, mag: 4.27, cls: "K" },  // ι Psc near
  { ra:  1.6377, dec:  48.6285, mag: 4.05, cls: "G" },  // 51 And
  { ra:  1.5839, dec:  41.4051, mag: 4.84, cls: "K" },  // υ And
  // Cassiopeia infill
  { ra:  1.1543, dec:  62.9303, mag: 4.61, cls: "G" },  // η Cas (binary)
  { ra:  0.4900, dec:  64.8775, mag: 4.50, cls: "G" },  // κ Cas
  { ra:  1.2528, dec:  68.1311, mag: 4.51, cls: "B" },  // 50 Cas
  { ra:  2.4194, dec:  74.9892, mag: 4.30, cls: "B" },  // λ Cas
  { ra: 23.5108, dec:  77.6322, mag: 4.16, cls: "A" },  // η Cep nearby
  // Cepheus
  { ra: 22.1814, dec:  58.2009, mag: 3.39, cls: "K" },  // ζ Cep
  { ra: 22.4878, dec:  66.2003, mag: 4.21, cls: "A" },  // θ Cep
  { ra: 22.8281, dec:  66.2003, mag: 4.29, cls: "A" },  // ν Cep
  { ra: 21.7251, dec:  58.7803, mag: 4.04, cls: "M" },  // μ Cep (Garnet)
  { ra: 22.8281, dec:  61.8364, mag: 4.18, cls: "A" },  // δ Cep
  // Draco
  { ra: 19.2090, dec:  67.6614, mag: 3.07, cls: "G" },  // δ Dra
  { ra: 18.3464, dec:  72.7325, mag: 3.29, cls: "M" },  // ζ Dra
  { ra: 17.5083, dec:  52.3014, mag: 3.75, cls: "G" },  // ξ Dra
  { ra: 16.0089, dec:  58.5650, mag: 3.84, cls: "M" },  // ι Dra (Edasich)
  { ra: 15.4156, dec:  58.9661, mag: 3.85, cls: "F" },  // θ Dra
  // Perseus
  { ra:  3.7544, dec:  32.2880, mag: 2.85, cls: "O" },  // ζ Per (dup-safe)
  { ra:  4.2992, dec:  41.0727, mag: 4.04, cls: "O" },  // ξ Per
  { ra:  2.9706, dec:  53.5063, mag: 3.96, cls: "A" },  // η Per
  { ra:  3.9544, dec:  35.7910, mag: 3.77, cls: "K" },  // ν Per
  { ra:  3.4574, dec:  44.8579, mag: 3.79, cls: "K" },  // κ Per
  // Auriga
  { ra:  6.0653, dec:  29.4988, mag: 2.65, cls: "B" },  // β Tau (Elnath)... already in BRIGHT
  { ra:  4.9498, dec:  33.1661, mag: 2.69, cls: "K" },  // Hassaleh in MORE
  { ra:  6.2289, dec:  37.3878, mag: 4.99, cls: "K" },  // 14 Aur
  // Taurus (Hyades + Pleiades infill)
  { ra:  3.7913, dec:  24.1052, mag: 2.87, cls: "B" },  // Alcyone (in BRIGHT)
  { ra:  3.8197, dec:  24.0533, mag: 3.62, cls: "B" },  // Atlas (27 Tau)
  { ra:  3.7497, dec:  24.0507, mag: 3.70, cls: "B" },  // Electra (17 Tau)
  { ra:  3.7656, dec:  24.3678, mag: 3.85, cls: "B" },  // Maia (20 Tau)
  { ra:  4.4767, dec:  19.1804, mag: 3.53, cls: "K" },  // ε Tau (Ain)
  { ra:  4.3829, dec:  17.5425, mag: 3.65, cls: "K" },  // γ Tau (Hyadum I)
  { ra:  4.4783, dec:  15.6203, mag: 3.76, cls: "K" },  // δ Tau (Hyadum II)
  { ra:  4.5031, dec:  15.9619, mag: 3.40, cls: "K" },  // θ² Tau (Chamukuy)
  { ra:  5.6276, dec:  21.1426, mag: 3.00, cls: "B" },  // ζ Tau (Tien Kuan)
  { ra:  4.0061, dec:  12.4906, mag: 3.41, cls: "B" },  // λ Tau
  // Orion infill
  { ra:  5.3531, dec:  -4.8389, mag: 3.19, cls: "B" },  // π³ Ori
  { ra:  5.4078, dec:  -2.3972, mag: 3.69, cls: "B" },  // π⁴ Ori
  { ra:  5.5856, dec:   9.9342, mag: 3.39, cls: "O" },  // λ Ori (Meissa)
  { ra:  5.5934, dec:   9.9342, mag: 4.39, cls: "O" },  // φ¹ Ori (~near λ)
  { ra:  5.5878, dec:  -5.9100, mag: 2.77, cls: "O" },  // ι Ori (Hatysa)
  { ra:  5.6457, dec:  -2.6000, mag: 3.81, cls: "O" },  // σ Ori
  { ra:  5.1296, dec:   2.4408, mag: 4.40, cls: "B" },  // χ¹ Ori
  // Gemini
  { ra:  7.3354, dec:  21.9824, mag: 3.50, cls: "F" },  // δ Gem (Wasat)
  { ra:  6.7325, dec:  25.1311, mag: 3.06, cls: "G" },  // ε Gem (Mebsuta)
  { ra:  7.0686, dec:  20.5703, mag: 3.79, cls: "G" },  // ζ Gem (Mekbuda)
  { ra:  6.2483, dec:  22.5067, mag: 3.31, cls: "M" },  // η Gem (Propus)
  { ra:  6.3793, dec:  22.5142, mag: 2.88, cls: "M" },  // μ Gem (Tejat)
  { ra:  6.7536, dec:  12.8956, mag: 3.58, cls: "A" },  // λ Gem
  { ra:  6.6298, dec:  16.3993, mag: 1.93, cls: "A" },  // Alhena (in BRIGHT)
  { ra:  6.2475, dec:  16.0794, mag: 3.36, cls: "F" },  // ξ Gem
  // Canis Major
  { ra:  6.9776, dec: -28.9722, mag: 1.50, cls: "B" },  // Adhara (BRIGHT)
  { ra:  6.3782, dec: -17.9550, mag: 3.95, cls: "B" },  // ν² CMa
  { ra:  7.2861, dec: -26.7720, mag: 4.07, cls: "B" },  // σ CMa
  // Leo
  { ra: 10.1219, dec:  16.7625, mag: 3.52, cls: "A" },  // η Leo
  { ra: 11.2378, dec:  15.4296, mag: 3.34, cls: "A" },  // θ Leo (Chertan)
  { ra: 11.4017, dec:  10.5295, mag: 3.94, cls: "F" },  // ι Leo
  { ra: 11.3501, dec:   6.0297, mag: 4.05, cls: "A" },  // σ Leo
  { ra:  9.7642, dec:  23.7740, mag: 3.88, cls: "K" },  // μ Leo
  { ra:  9.5292, dec:  26.0070, mag: 2.98, cls: "G" },  // ε Leo (Ras Elased)
  { ra: 10.2786, dec:  23.4173, mag: 3.43, cls: "F" },  // ζ Leo (Adhafera)
  // Virgo
  { ra: 12.9266, dec:   3.3974, mag: 3.39, cls: "M" },  // δ Vir
  { ra: 12.3322, dec:  -0.6664, mag: 3.89, cls: "A" },  // η Vir
  { ra: 14.2129, dec:  -6.0006, mag: 4.07, cls: "F" },  // ι Vir
  { ra: 14.7704, dec:   1.8930, mag: 3.72, cls: "A" },  // 109 Vir
  { ra: 11.8407, dec:   6.5293, mag: 4.03, cls: "M" },  // ν Vir
  // Boötes
  { ra: 14.5347, dec:  38.3083, mag: 3.50, cls: "G" },  // β Boo (Nekkar)
  { ra: 14.5347, dec:  46.0883, mag: 3.78, cls: "A" },  // ζ Boo
  { ra: 14.4172, dec:  51.7906, mag: 4.05, cls: "F" },  // θ Boo
  // Hercules
  { ra: 16.5036, dec:  21.4895, mag: 2.78, cls: "G" },  // β Her (in MORE)
  { ra: 17.4014, dec:  29.2483, mag: 2.81, cls: "G" },  // ζ Her
  { ra: 17.2510, dec:  14.3903, mag: 3.13, cls: "A" },  // δ Her
  { ra: 17.0001, dec:  30.9264, mag: 3.92, cls: "A" },  // ε Her
  { ra: 16.7148, dec:  38.9223, mag: 3.53, cls: "G" },  // η Her
  { ra: 17.2510, dec:  36.8092, mag: 3.16, cls: "K" },  // π Her
  { ra: 17.2492, dec:  27.7203, mag: 3.42, cls: "G" },  // μ Her
  { ra: 17.9759, dec:  29.2483, mag: 3.70, cls: "K" },  // ξ Her
  // Lyra parallelogram (fainter members)
  { ra: 18.8973, dec:  36.8989, mag: 4.36, cls: "G" },  // ζ¹ Lyr
  { ra: 19.2179, dec:  39.1469, mag: 4.39, cls: "M" },  // η Lyr
  { ra: 19.2542, dec:  38.1336, mag: 4.36, cls: "K" },  // θ Lyr
  { ra: 18.9087, dec:  36.8989, mag: 4.30, cls: "M" },  // δ² Lyr
  // Cygnus infill
  { ra: 19.7494, dec:  45.1304, mag: 2.87, cls: "B" },  // δ Cyg
  { ra: 21.2154, dec:  30.2266, mag: 3.21, cls: "G" },  // ζ Cyg
  { ra: 19.5125, dec:  35.0833, mag: 3.89, cls: "K" },  // η Cyg
  { ra: 19.4933, dec:  51.7297, mag: 3.79, cls: "A" },  // ι Cyg
  { ra: 21.0786, dec:  43.9281, mag: 3.72, cls: "K" },  // ξ Cyg
  { ra: 19.5567, dec:  53.3681, mag: 3.77, cls: "K" },  // κ Cyg
  { ra: 20.3000, dec:  47.7142, mag: 4.43, cls: "K" },  // 39 Cyg
  // Aquila
  { ra: 19.4250, dec:   3.1147, mag: 3.36, cls: "F" },  // δ Aql (in FAINT)
  { ra: 20.1882, dec:  -0.8214, mag: 3.23, cls: "B" },  // θ Aql
  { ra: 19.0922, dec: -13.7726, mag: 3.43, cls: "B" },  // λ Aql
  { ra: 18.9930, dec:  15.0683, mag: 4.02, cls: "K" },  // ε Aql
  { ra: 19.4036, dec: -14.3814, mag: 4.36, cls: "B" },  // ι Aql
  // Sagittarius infill (teapot interior)
  { ra: 18.4029, dec: -25.4217, mag: 2.81, cls: "K" },  // λ Sgr (Kaus Bor)
  { ra: 19.0444, dec: -21.7411, mag: 3.10, cls: "F" },  // ζ Sgr
  { ra: 18.9657, dec: -29.8281, mag: 2.99, cls: "B" },  // φ Sgr
  { ra: 18.2814, dec: -25.6231, mag: 3.51, cls: "K" },  // μ Sgr
  // Capricornus
  { ra: 20.2935, dec: -14.7814, mag: 2.85, cls: "A" },  // δ Cap (in MORE)
  { ra: 20.3001, dec: -12.5444, mag: 3.05, cls: "G" },  // β Cap (Dabih)
  { ra: 21.1187, dec: -16.6622, mag: 3.69, cls: "A" },  // γ Cap
  { ra: 21.5440, dec: -22.4117, mag: 3.74, cls: "G" },  // ζ Cap
  // Aquarius
  { ra: 22.0964, dec:  -0.3198, mag: 2.95, cls: "G" },  // α Aqr (in MORE)
  { ra: 21.5260, dec:  -5.5712, mag: 2.87, cls: "G" },  // β Aqr (in MORE)
  { ra: 22.2862, dec:  -7.5783, mag: 3.84, cls: "A" },  // γ Aqr (in FAINT)
  { ra: 22.4806, dec: -16.8347, mag: 3.74, cls: "M" },  // λ Aqr
  { ra: 20.6781, dec:  -9.4956, mag: 3.77, cls: "A" },  // ε Aqr
  { ra: 22.5878, dec:  -0.0197, mag: 4.04, cls: "B" },  // η Aqr
  // Pisces
  { ra:  1.5247, dec:  15.3458, mag: 3.62, cls: "G" },  // η Psc (Alpherg)
  { ra: 23.2867, dec:   3.2828, mag: 3.69, cls: "G" },  // γ Psc
  { ra: 23.6594, dec:   6.8639, mag: 4.03, cls: "F" },  // ω Psc
  { ra:  0.8203, dec:  -7.7831, mag: 4.27, cls: "K" },  // ε Psc
  { ra: 23.2806, dec:   1.7811, mag: 4.27, cls: "K" },  // θ Psc
  // Ophiuchus
  { ra: 17.7250, dec:   4.5673, mag: 2.78, cls: "K" },  // β Oph
  { ra: 16.6184, dec:  -3.6942, mag: 2.43, cls: "A" },  // δ Oph (Yed Prior)
  { ra: 16.9619, dec:  -3.4344, mag: 3.24, cls: "G" },  // ε Oph (Yed Post)
  { ra: 17.7233, dec:  -9.7733, mag: 3.27, cls: "K" },  // η Oph
  { ra: 17.0964, dec: -15.7250, mag: 2.43, cls: "A" },  // η Oph (Sabik, in MORE)
  // Corvus
  { ra: 12.2635, dec: -17.5419, mag: 2.59, cls: "B" },  // γ Crv (in MORE)
  { ra: 12.4172, dec: -22.6195, mag: 2.65, cls: "G" },  // β Crv (in MORE)
  { ra: 12.4972, dec: -16.5156, mag: 2.95, cls: "K" },  // δ Crv (Algorab)
  { ra: 12.1404, dec: -24.7290, mag: 4.02, cls: "A" },  // ε Crv
  // Crater
  { ra: 11.3239, dec: -18.3506, mag: 4.07, cls: "K" },  // δ Crt
  { ra: 11.4196, dec: -14.7780, mag: 4.46, cls: "G" },  // γ Crt
  // Centaurus / Lupus (some southern infill)
  { ra: 13.6647, dec: -53.4664, mag: 2.06, cls: "K" },  // ε Cen
  { ra: 12.1393, dec: -50.7222, mag: 2.20, cls: "B" },  // δ Cen
  { ra: 13.9259, dec: -47.2885, mag: 2.30, cls: "B" },  // ζ Cen
  // Pavo / Tucana / Grus southern stars
  { ra: 22.7117, dec: -46.8847, mag: 4.11, cls: "B" },  // β Gru
  { ra: 22.0911, dec: -39.5430, mag: 3.49, cls: "G" },  // γ Gru
];

// Representative apparent color for each Morgan-Keenan spectral class.
// Values derived from B-V → sRGB conversions (Mitchell Charity's
// blackbody star-color table), then tweaked slightly for legibility
// against the near-black sky background of the polar plot.
export const SPECTRAL_COLOR = {
  O: "#a4c8ff",  // hot blue
  B: "#bbd0ff",
  A: "#dfe5ff",  // blue-white
  F: "#f7f5ff",  // white
  G: "#fff4d6",  // yellow (Sun-like)
  K: "#ffcf8e",  // orange
  M: "#ff9966",  // red-orange
};

export function starDotColor(star) {
  return SPECTRAL_COLOR[star.cls] ?? "#e8eefc";
}

// Star "dot" radius scales with apparent flux: area ∝ flux, so
// radius = const × 10^(-mag/5) (one mag step → flux ratio of
// 10^(2/5) ≈ 2.512, so r ratio of 10^(1/5) ≈ 1.585). Matches the
// Pogson scale: Sirius and Vega read as bigger than Polaris, which
// reads bigger than mag-3 fillers. Saturated at the bright end so
// Sirius (mag -1.46) doesn't dwarf the chart at ~2.5× Vega's radius,
// and at the faint end so mag-4 stars stay readable.
export function starDotRadius(mag) {
  if (mag == null) mag = 2.5;
  const r = 0.95 * Math.pow(10, -mag / 5);
  return Math.max(0.18, Math.min(1.15, r));
}

// Opacity scale takes over where the radius clamp flattens out - once
// stars all hit the 0.18 minimum radius (mag ~3.7+), they'd otherwise
// look identical even though a mag 5 star is ~3× fainter than mag 3.5.
// Fading opacity preserves the Pogson "more flux = more rendered
// light" rule end-to-end. Bright stars (mag < 3.5) keep full opacity
// since radius already encodes brightness.
export function starDotOpacity(mag) {
  if (mag == null) return 1.0;
  const FADE_START = 3.5;
  const FADE_END   = 6.0;
  if (mag <= FADE_START) return 1.0;
  const t = Math.min(1, (mag - FADE_START) / (FADE_END - FADE_START));
  return 1.0 - t * 0.65;
}

// Stars are functionally at infinity, so a label needs to appear in
// the star's direction regardless of camera position. Callers (e.g.,
// starLabelPos in the scene file) place each label at
//   camera + starDirection × STAR_FAR_M
// Any reasonable camera→label distance dwarfs the camera→Earth
// distance, so the apparent sky direction stays effectively constant
// at any zoom level. Well inside Cesium's far plane but far enough
// that parallax is sub-pixel.
export const STAR_FAR_M = 1e9; // 1 million km

// Project a star's J2000 RA/Dec into an ECEF unit-vector at the given
// instant. ECI → ECEF rotation about Z by -gmst, so stars stay fixed
// in the celestial frame as the Earth-fixed scene clock advances.
export function starDirectionEcef(star, jsDate) {
  const ra = star.ra * Math.PI / 12;
  const dec = star.dec * Math.PI / 180;
  const cdec = Math.cos(dec);
  const ex = cdec * Math.cos(ra);
  const ey = cdec * Math.sin(ra);
  const ez = Math.sin(dec);
  const gmst = sat.gstime(jsDate);
  const c = Math.cos(gmst), s = Math.sin(gmst);
  return [c * ex + s * ey, -s * ex + c * ey, ez];
}
