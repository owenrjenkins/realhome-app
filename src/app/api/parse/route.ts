import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();
    
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    // Simple parsing logic - extract location preferences
    const parsed = {
      location: extractLocation(text),
      preferences: extractPreferences(text),
      commute: extractCommute(text),
      amenities: extractAmenities(text)
    };

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Parse error:', error);
    return NextResponse.json({ error: 'Failed to parse text' }, { status: 500 });
  }
}

function extractLocation(text: string): string {
  const locationPatterns = [
    /in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
    /near\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi
  ];
  
  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0].replace(/^(in|near)\s+/i, '').trim();
    }
  }
  
  return 'London'; // Default fallback
}

function extractPreferences(text: string): string[] {
  const preferences = [];
  
  if (/quiet/i.test(text)) preferences.push('quiet');
  if (/park/i.test(text)) preferences.push('near_park');
  if (/caf[eé]s?/i.test(text)) preferences.push('cafes');
  if (/supermarket/i.test(text)) preferences.push('supermarket');
  if (/transport|transit/i.test(text)) preferences.push('good_transport');
  
  return preferences;
}

function extractCommute(text: string): { destination?: string; maxTime?: number } {
  const commuteMatch = text.match(/(\d+)\s*min(?:utes?)?\s*to\s+([^,\.]+)/i);
  
  if (commuteMatch) {
    return {
      destination: commuteMatch[2].trim(),
      maxTime: parseInt(commuteMatch[1])
    };
  }
  
  return {};
}

function extractAmenities(text: string): string[] {
  const amenities = [];
  
  if (/park/i.test(text)) amenities.push('park');
  if (/caf[eé]s?/i.test(text)) amenities.push('cafe');
  if (/supermarket|shop/i.test(text)) amenities.push('supermarket');
  if (/restaurant/i.test(text)) amenities.push('restaurant');
  if (/gym/i.test(text)) amenities.push('gym');
  
  return amenities;
}

