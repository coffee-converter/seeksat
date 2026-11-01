// Hand-written label points for continents, oceans and seas. Points are [lonDeg, latDeg].
// Multiple points let a big region show a label in whichever part is on screen.
export const REGIONS = [
  { name: 'Africa', kind: 'continent', rank: 0, points: [[20, 3], [20, 20]] },
  { name: 'Antarctica', kind: 'continent', rank: 0, points: [[0, -80], [120, -78]] },
  { name: 'Asia', kind: 'continent', rank: 0, points: [[90, 50], [60, 40]] },
  { name: 'Australia', kind: 'continent', rank: 0, points: [[134, -25]] },
  { name: 'Europe', kind: 'continent', rank: 0, points: [[15, 50], [40, 56]] },
  { name: 'North America', kind: 'continent', rank: 0, points: [[-100, 45], [-105, 62]] },
  { name: 'South America', kind: 'continent', rank: 0, points: [[-60, -12], [-65, -30]] },

  { name: 'Pacific Ocean', kind: 'ocean', rank: 0, points: [[-150, 25], [-140, -20], [160, 20], [-120, 0], [170, -35]] },
  { name: 'Atlantic Ocean', kind: 'ocean', rank: 0, points: [[-40, 30], [-20, -20], [-50, 5]] },
  { name: 'Indian Ocean', kind: 'ocean', rank: 0, points: [[80, -15], [65, -30]] },
  { name: 'Southern Ocean', kind: 'ocean', rank: 0, points: [[0, -60], [120, -62], [-120, -62]] },
  { name: 'Arctic Ocean', kind: 'ocean', rank: 0, points: [[0, 85], [150, 80]] },

  { name: 'Mediterranean Sea', kind: 'sea', rank: 2, points: [[18, 35], [5, 38]] },
  { name: 'Caribbean Sea', kind: 'sea', rank: 2, points: [[-75, 15]] },
  { name: 'Gulf of Mexico', kind: 'sea', rank: 2, points: [[-90, 25]] },
  { name: 'Bering Sea', kind: 'sea', rank: 2, points: [[-175, 58]] },
  { name: 'Arabian Sea', kind: 'sea', rank: 2, points: [[65, 15]] },
  { name: 'Bay of Bengal', kind: 'sea', rank: 2, points: [[88, 14]] },
  { name: 'South China Sea', kind: 'sea', rank: 2, points: [[114, 13]] },
  { name: 'Coral Sea', kind: 'sea', rank: 2, points: [[154, -16]] },
  { name: 'Tasman Sea', kind: 'sea', rank: 2, points: [[160, -38]] },
  { name: 'Philippine Sea', kind: 'sea', rank: 2, points: [[132, 20]] },
  { name: 'Sea of Japan', kind: 'sea', rank: 2, points: [[134, 40]] },
  { name: 'Hudson Bay', kind: 'sea', rank: 2, points: [[-85, 60]] },
  { name: 'Gulf of Alaska', kind: 'sea', rank: 2, points: [[-146, 56]] },
  { name: 'North Sea', kind: 'sea', rank: 2, points: [[3, 56]] },
];
