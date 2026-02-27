// MLB parent org name → team ID mapping
// These are the 14 parent organizations Kent's clients play for
export const MLB_ORG_IDS: Record<string, number> = {
  'Reds': 113,
  'Cincinnati Reds': 113,
  'Nationals': 120,
  'Washington Nationals': 120,
  'Mariners': 136,
  'Seattle Mariners': 136,
  'Blue Jays': 141,
  'Toronto Blue Jays': 141,
  'Marlins': 146,
  'Miami Marlins': 146,
  'Guardians': 114,
  'Cleveland Guardians': 114,
  'Yankees': 147,
  'New York Yankees': 147,
  'Angels': 108,
  'Los Angeles Angels': 108,
  'Athletics': 133,
  'Oakland Athletics': 133,
  "A's": 133,
  'Dodgers': 119,
  'Los Angeles Dodgers': 119,
  'Red Sox': 111,
  'Boston Red Sox': 111,
  'Rockies': 115,
  'Colorado Rockies': 115,
  'Cardinals': 138,
  'St. Louis Cardinals': 138,
  'Twins': 142,
  'Minnesota Twins': 142,
  'Braves': 144,
  'Atlanta Braves': 144,
  'Mets': 121,
  'New York Mets': 121,
  'Phillies': 143,
  'Philadelphia Phillies': 143,
  'Pirates': 134,
  'Pittsburgh Pirates': 134,
  'Cubs': 112,
  'Chicago Cubs': 112,
  'White Sox': 145,
  'Chicago White Sox': 145,
  'Tigers': 116,
  'Detroit Tigers': 116,
  'Brewers': 158,
  'Milwaukee Brewers': 158,
  'Padres': 135,
  'San Diego Padres': 135,
  'Giants': 137,
  'San Francisco Giants': 137,
  'Diamondbacks': 109,
  'Arizona Diamondbacks': 109,
  'Rangers': 140,
  'Texas Rangers': 140,
  'Astros': 117,
  'Houston Astros': 117,
  'Royals': 118,
  'Kansas City Royals': 118,
  'Rays': 139,
  'Tampa Bay Rays': 139,
  'Orioles': 110,
  'Baltimore Orioles': 110,
}

// All unique parent team IDs
export const MLB_PARENT_IDS = [...new Set(Object.values(MLB_ORG_IDS))]

// NCAA school aliases for matching roster "Org" field
export const NCAA_ALIASES: Record<string, string[]> = {
  'Texas': ['University of Texas', 'UT Austin', 'Texas Longhorns'],
  'Coastal Carolina': ['CCU', 'Coastal', 'Chanticleers'],
  'Florida': ['University of Florida', 'UF', 'Florida Gators'],
  'Florida State': ['FSU', 'Florida State Seminoles', 'Seminoles'],
  'Georgia Tech': ['GT', 'Georgia Tech Yellow Jackets'],
  'Virginia': ['UVA', 'University of Virginia', 'Cavaliers'],
  'South Carolina': ['USC', 'University of South Carolina', 'Gamecocks'],
  'Alabama': ['University of Alabama', 'Bama', 'Crimson Tide'],
  'Vanderbilt': ['Vandy', 'Vanderbilt Commodores'],
  'Dallas Baptist': ['DBU', 'Dallas Baptist Patriots'],
  'Wake Forest': ['Wake', 'Demon Deacons'],
  'SE Louisiana': ['Southeastern Louisiana', 'SELA', 'SELA Lions'],
  'Mercer': ['Mercer Bears', 'Mercer University'],
  'FIU': ['Florida International', 'Florida International University', 'FIU Panthers'],
  'UCF': ['University of Central Florida', 'UCF Knights', 'Central Florida'],
  'Auburn': ['Auburn University', 'Auburn Tigers'],
  'Ohio State': ['OSU', 'The Ohio State University', 'Buckeyes'],
  'Southern Miss': ['USM', 'University of Southern Mississippi', 'Golden Eagles'],
  'Fordham': ['Fordham University', 'Fordham Rams'],
  'Michigan': ['University of Michigan', 'Michigan Wolverines'],
  'USF': ['University of South Florida', 'South Florida', 'USF Bulls'],
  'Duke': ['Duke University', 'Blue Devils'],
  'North Carolina': ['UNC', 'University of North Carolina', 'Tar Heels'],
  'Rutgers': ['Rutgers University', 'Scarlet Knights'],
  'Sacramento State': ['Sac State', 'Sacramento State Hornets'],
  'Saint Josephs': ["Saint Joseph's", "St. Joseph's", "St. Josephs", 'Hawks'],
}

// Reverse lookup: alias → canonical name
export function resolveNcaaName(orgName: string): string | null {
  const lower = orgName.toLowerCase().trim()
  for (const [canonical, aliases] of Object.entries(NCAA_ALIASES)) {
    if (canonical.toLowerCase() === lower) return canonical
    if (aliases.some((a) => a.toLowerCase() === lower)) return canonical
  }
  return null
}

// Resolve any org name to an MLB team ID (or null)
export function resolveMLBTeamId(orgName: string): number | null {
  // Direct match
  if (MLB_ORG_IDS[orgName] !== undefined) return MLB_ORG_IDS[orgName]!
  // Case-insensitive match
  const lower = orgName.toLowerCase().trim()
  for (const [key, id] of Object.entries(MLB_ORG_IDS)) {
    if (key.toLowerCase() === lower) return id
  }
  return null
}

// HS school info for geocoding — mapped from Org field
// Will be populated dynamically from roster data
export interface HSSchoolInfo {
  schoolName: string
  city: string
  state: string
}
