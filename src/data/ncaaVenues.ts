import type { Coordinates } from '../types/roster'

// Hardcoded venue coordinates for NCAA baseball programs
// Source: stadium locations for each school's primary baseball venue
export const NCAA_VENUES: Record<string, { venueName: string; coords: Coordinates }> = {
  'Texas': {
    venueName: 'UFCU Disch-Falk Field',
    coords: { lat: 30.2833, lng: -97.7321 },
  },
  'Coastal Carolina': {
    venueName: 'Springs Brooks Stadium',
    coords: { lat: 33.7964, lng: -79.0117 },
  },
  'Florida': {
    venueName: 'Florida Ballpark',
    coords: { lat: 29.6382, lng: -82.3458 },
  },
  'Florida State': {
    venueName: 'Dick Howser Stadium',
    coords: { lat: 30.4393, lng: -84.2972 },
  },
  'Georgia Tech': {
    venueName: 'Russ Chandler Stadium',
    coords: { lat: 33.7723, lng: -84.3921 },
  },
  'Virginia': {
    venueName: 'Disharoon Park',
    coords: { lat: 38.0326, lng: -78.5131 },
  },
  'South Carolina': {
    venueName: 'Founders Park',
    coords: { lat: 33.9881, lng: -81.0329 },
  },
  'Alabama': {
    venueName: 'Sewell-Thomas Stadium',
    coords: { lat: 33.2132, lng: -87.5464 },
  },
  'Vanderbilt': {
    venueName: 'Hawkins Field',
    coords: { lat: 36.1476, lng: -86.8127 },
  },
  'Dallas Baptist': {
    venueName: 'Horner Ballpark',
    coords: { lat: 32.7242, lng: -96.9114 },
  },
  'Wake Forest': {
    venueName: 'David F. Couch Ballpark',
    coords: { lat: 36.1340, lng: -80.2817 },
  },
  'SE Louisiana': {
    venueName: 'Alumni Field',
    coords: { lat: 30.5154, lng: -90.4622 },
  },
  'Mercer': {
    venueName: 'OrthoGeorgia Park',
    coords: { lat: 32.8262, lng: -83.6515 },
  },
  'FIU': {
    venueName: 'FIU Baseball Stadium',
    coords: { lat: 25.7562, lng: -80.3735 },
  },
  'UCF': {
    venueName: 'John Euliano Park',
    coords: { lat: 28.6022, lng: -81.2016 },
  },
  'Auburn': {
    venueName: 'Plainsman Park',
    coords: { lat: 32.6028, lng: -85.4893 },
  },
  'Ohio State': {
    venueName: 'Bill Davis Stadium',
    coords: { lat: 40.0092, lng: -83.0282 },
  },
  'Southern Miss': {
    venueName: 'Pete Taylor Park',
    coords: { lat: 31.3298, lng: -89.3345 },
  },
  'Fordham': {
    venueName: 'Houlihan Park',
    coords: { lat: 40.8612, lng: -73.8855 },
  },
  'Michigan': {
    venueName: 'Ray Fisher Stadium',
    coords: { lat: 42.2710, lng: -83.7465 },
  },
  'USF': {
    venueName: 'USF Baseball Stadium',
    coords: { lat: 28.0647, lng: -82.4159 },
  },
  'Duke': {
    venueName: 'Durham Bulls Athletic Park',
    coords: { lat: 35.9941, lng: -78.9025 },
  },
  'North Carolina': {
    venueName: 'Boshamer Stadium',
    coords: { lat: 35.9683, lng: -79.0589 },
  },
  'Rutgers': {
    venueName: 'Bainton Field',
    coords: { lat: 40.5227, lng: -74.4631 },
  },
  'Sacramento State': {
    venueName: 'John Smith Field',
    coords: { lat: 38.5582, lng: -121.4235 },
  },
  'Saint Josephs': {
    venueName: "Smithson Field",
    coords: { lat: 40.0045, lng: -75.2446 },
  },
}
