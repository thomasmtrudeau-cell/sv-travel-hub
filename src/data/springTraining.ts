import type { Coordinates } from '../types/roster'

// Spring Training typically runs mid-February through late March
export const SPRING_TRAINING_START = '02-15' // MM-DD
export const SPRING_TRAINING_END = '03-28'   // MM-DD

export function isSpringTraining(dateStr: string): boolean {
  const mmdd = dateStr.slice(5) // "YYYY-MM-DD" → "MM-DD"
  return mmdd >= SPRING_TRAINING_START && mmdd <= SPRING_TRAINING_END
}

interface SpringTrainingSite {
  venueName: string
  coords: Coordinates
  league: 'Grapefruit' | 'Cactus'
}

// MLB parent team ID → Spring Training facility
// Grapefruit League = Florida, Cactus League = Arizona
export const SPRING_TRAINING_SITES: Record<number, SpringTrainingSite> = {
  // --- Grapefruit League (Florida) — within Orlando driving range ---
  147: { // Yankees
    venueName: 'George M. Steinbrenner Field',
    coords: { lat: 27.9789, lng: -82.5034 },
    league: 'Grapefruit',
  },
  111: { // Red Sox
    venueName: 'JetBlue Park',
    coords: { lat: 26.5560, lng: -81.8465 },
    league: 'Grapefruit',
  },
  141: { // Blue Jays
    venueName: 'TD Ballpark',
    coords: { lat: 28.0222, lng: -82.7473 },
    league: 'Grapefruit',
  },
  146: { // Marlins
    venueName: 'Roger Dean Chevrolet Stadium',
    coords: { lat: 26.8901, lng: -80.1156 },
    league: 'Grapefruit',
  },
  138: { // Cardinals
    venueName: 'Roger Dean Chevrolet Stadium',
    coords: { lat: 26.8901, lng: -80.1156 },
    league: 'Grapefruit',
  },
  120: { // Nationals
    venueName: 'The Ballpark of the Palm Beaches',
    coords: { lat: 26.7525, lng: -80.1227 },
    league: 'Grapefruit',
  },
  144: { // Braves
    venueName: 'CoolToday Park',
    coords: { lat: 27.0229, lng: -82.2360 },
    league: 'Grapefruit',
  },
  142: { // Twins
    venueName: 'Hammond Stadium at CenturyLink Sports Complex',
    coords: { lat: 26.5549, lng: -81.8087 },
    league: 'Grapefruit',
  },
  139: { // Rays
    venueName: 'Charlotte Sports Park',
    coords: { lat: 26.9609, lng: -82.1133 },
    league: 'Grapefruit',
  },
  116: { // Tigers
    venueName: 'Publix Field at Joker Marchant Stadium',
    coords: { lat: 28.0672, lng: -81.7539 },
    league: 'Grapefruit',
  },
  143: { // Phillies
    venueName: 'BayCare Ballpark',
    coords: { lat: 27.9772, lng: -82.7293 },
    league: 'Grapefruit',
  },
  134: { // Pirates
    venueName: 'LECOM Park',
    coords: { lat: 27.4960, lng: -82.5591 },
    league: 'Grapefruit',
  },
  110: { // Orioles
    venueName: 'Ed Smith Stadium',
    coords: { lat: 27.3373, lng: -82.5259 },
    league: 'Grapefruit',
  },
  121: { // Mets
    venueName: 'Clover Park',
    coords: { lat: 27.3069, lng: -80.3667 },
    league: 'Grapefruit',
  },
  117: { // Astros
    venueName: 'The Ballpark of the Palm Beaches',
    coords: { lat: 26.7525, lng: -80.1227 },
    league: 'Grapefruit',
  },

  // --- Cactus League (Arizona) — NOT within Orlando driving range ---
  113: { // Reds
    venueName: 'Goodyear Ballpark',
    coords: { lat: 33.4394, lng: -112.3988 },
    league: 'Cactus',
  },
  136: { // Mariners
    venueName: 'Peoria Sports Complex',
    coords: { lat: 33.5812, lng: -112.2385 },
    league: 'Cactus',
  },
  114: { // Guardians
    venueName: 'Goodyear Ballpark',
    coords: { lat: 33.4394, lng: -112.3988 },
    league: 'Cactus',
  },
  108: { // Angels
    venueName: 'Tempe Diablo Stadium',
    coords: { lat: 33.3945, lng: -111.9668 },
    league: 'Cactus',
  },
  133: { // Athletics
    venueName: 'Hohokam Stadium',
    coords: { lat: 33.4378, lng: -111.8270 },
    league: 'Cactus',
  },
  119: { // Dodgers
    venueName: 'Camelback Ranch',
    coords: { lat: 33.5076, lng: -112.3199 },
    league: 'Cactus',
  },
  115: { // Rockies
    venueName: 'Salt River Fields at Talking Stick',
    coords: { lat: 33.5453, lng: -111.8852 },
    league: 'Cactus',
  },
  112: { // Cubs
    venueName: 'Sloan Park',
    coords: { lat: 33.4353, lng: -111.8291 },
    league: 'Cactus',
  },
  145: { // White Sox
    venueName: 'Camelback Ranch',
    coords: { lat: 33.5076, lng: -112.3199 },
    league: 'Cactus',
  },
  158: { // Brewers
    venueName: 'American Family Fields of Phoenix',
    coords: { lat: 33.5260, lng: -112.1494 },
    league: 'Cactus',
  },
  135: { // Padres
    venueName: 'Peoria Sports Complex',
    coords: { lat: 33.5812, lng: -112.2385 },
    league: 'Cactus',
  },
  137: { // Giants
    venueName: 'Scottsdale Stadium',
    coords: { lat: 33.4886, lng: -111.9260 },
    league: 'Cactus',
  },
  109: { // Diamondbacks
    venueName: 'Salt River Fields at Talking Stick',
    coords: { lat: 33.5453, lng: -111.8852 },
    league: 'Cactus',
  },
  140: { // Rangers
    venueName: 'Surprise Stadium',
    coords: { lat: 33.6290, lng: -112.3697 },
    league: 'Cactus',
  },
  118: { // Royals
    venueName: 'Surprise Stadium',
    coords: { lat: 33.6290, lng: -112.3697 },
    league: 'Cactus',
  },
}

// Get the spring training site for a parent org, if it exists
export function getSpringTrainingSite(parentTeamId: number): SpringTrainingSite | null {
  return SPRING_TRAINING_SITES[parentTeamId] ?? null
}

// Check if a team's ST site is in the Grapefruit League (Florida = drivable from Orlando)
export function isGrapefruitLeague(parentTeamId: number): boolean {
  return SPRING_TRAINING_SITES[parentTeamId]?.league === 'Grapefruit'
}
