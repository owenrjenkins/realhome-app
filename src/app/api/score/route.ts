import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { parsed } = await request.json();
    
    if (!parsed) {
      return NextResponse.json({ error: 'Parsed data is required' }, { status: 400 });
    }

    // Get center coordinates for the location
    const center = await geocodeLocation(parsed.location);
    
    // Generate grid of candidate areas around the center
    const tiles = generateTileGrid(center, 160); // Use tiles cap from env
    
    // Score each tile based on preferences
    const scoredTiles = await scoreTiles(tiles, parsed);
    
    // Sort by score and return top results
    const results = scoredTiles
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    return NextResponse.json({
      center,
      results,
      query: parsed
    });
  } catch (error) {
    console.error('Score error:', error);
    return NextResponse.json({ 
      error: 'Failed to score locations. Please check your Google Maps API configuration.' 
    }, { status: 500 });
  }
}

async function geocodeLocation(location: string): Promise<{ lat: number; lng: number }> {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  
  if (!apiKey) {
    throw new Error('Google Maps API key not configured');
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' || !data.results.length) {
    // Fallback to London coordinates
    return { lat: 51.5074, lng: -0.1278 };
  }
  
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng };
}

function generateTileGrid(center: { lat: number; lng: number }, maxTiles: number): Array<{ lat: number; lng: number }> {
  const tiles = [];
  const gridSize = Math.ceil(Math.sqrt(maxTiles));
  const stepLat = 0.01; // Roughly 1km
  const stepLng = 0.015; // Roughly 1km (adjusted for latitude)
  
  const startLat = center.lat - (gridSize / 2) * stepLat;
  const startLng = center.lng - (gridSize / 2) * stepLng;
  
  for (let i = 0; i < gridSize && tiles.length < maxTiles; i++) {
    for (let j = 0; j < gridSize && tiles.length < maxTiles; j++) {
      tiles.push({
        lat: startLat + i * stepLat,
        lng: startLng + j * stepLng
      });
    }
  }
  
  return tiles;
}

async function scoreTiles(tiles: Array<{ lat: number; lng: number }>, parsed: ParsedQuery): Promise<Array<{ lat: number; lng: number; score: number; parts?: ScoreParts }>> {
  const scoredTiles = [];
  
  for (const tile of tiles) {
    let score = 0;
    const parts = { commute: 0, amenity: 0, vibe: 0 };
    
    // Distance-based scoring (closer to center = higher score)
    const distanceScore = calculateDistanceScore(tile, parsed);
    parts.vibe = distanceScore;
    
    // Commute scoring (if specified)
    if (parsed.commute?.destination) {
      const commuteScore = await calculateCommuteScore(tile, {
        destination: parsed.commute.destination,
        maxTime: parsed.commute.maxTime
      });
      parts.commute = commuteScore;
    } else {
      parts.commute = 0.5; // Neutral score
    }
    
    // Amenity scoring
    const amenityScore = await calculateAmenityScore(tile, parsed.amenities || []);
    parts.amenity = amenityScore;
    
    // Combine scores
    score = (parts.commute * 0.4) + (parts.amenity * 0.4) + (parts.vibe * 0.2);
    
    scoredTiles.push({
      ...tile,
      score: Math.max(0, Math.min(1, score)), // Clamp between 0 and 1
      parts
    });
  }
  
  return scoredTiles;
}

function calculateDistanceScore(_tile: { lat: number; lng: number }, _parsed: ParsedQuery): number {
  // Simple distance-based scoring - closer to search center gets higher score
  // This is a placeholder - in a real implementation you'd use more sophisticated scoring
  const randomFactor = Math.random() * 0.3; // Add some randomness
  const baseScore = 0.4 + randomFactor;
  
  return Math.max(0, Math.min(1, baseScore));
}

async function calculateCommuteScore(_tile: { lat: number; lng: number }, _commute: { destination: string; maxTime?: number }): Promise<number> {
  // Placeholder commute scoring
  // In a real implementation, you'd use Google Distance Matrix API
  const randomScore = 0.3 + Math.random() * 0.4;
  return Math.max(0, Math.min(1, randomScore));
}

async function calculateAmenityScore(_tile: { lat: number; lng: number }, _amenities: string[]): Promise<number> {
  // Placeholder amenity scoring
  // In a real implementation, you'd use Google Places API
  const randomScore = 0.2 + Math.random() * 0.6;
  return Math.max(0, Math.min(1, randomScore));
}

interface ParsedQuery {
  location: string;
  preferences: string[];
  commute?: { destination?: string; maxTime?: number };
  amenities?: string[];
}

interface ScoreParts {
  commute: number;
  amenity: number;
  vibe: number;
}

