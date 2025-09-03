# RealHome - Property Location Scoring Application

A Next.js application that helps users find ideal property locations based on their preferences using Google Maps integration and intelligent scoring algorithms.

## Features

- **Natural Language Search**: Describe your ideal location in plain English
- **Google Maps Integration**: Interactive maps with real-time location visualization
- **Intelligent Scoring**: AI-powered location scoring based on commute times and amenities
- **Real Estate Data**: Integration with UK property sales data (7,540+ listings)
- **Responsive Design**: Mobile-optimized interface with professional styling

## Technology Stack

- **Frontend**: Next.js 15, React, TypeScript, Tailwind CSS
- **Maps**: Google Maps JavaScript API, Google Distance Matrix API
- **Data**: CSV processing with Papa Parse
- **Deployment**: Vercel-optimized with serverless functions

## Local Development

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Setup**:
   Create `.env.local` with:
   ```
   GOOGLE_MAPS_SERVER_KEY=your_server_key
   NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=your_browser_key
   NEXT_PUBLIC_DATA_URL=/data/realhome_listings_uk_sales_minimal.csv
   REALHOME_MAX_TILES=140
   REALHOME_PLACES_RADIUS=800
   REALHOME_DISABLE_PLACES=0
   REALHOME_DISABLE_DISTMATRIX=0
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```

4. **Access Application**:
   - Main app: http://localhost:3000
   - Health check: http://localhost:3000/api/health

## Vercel Deployment

### Prerequisites
- Google Maps Platform API keys with the following APIs enabled:
  - Maps JavaScript API
  - Geocoding API
  - Distance Matrix API
- Vercel account

### Deployment Steps

1. **Connect Repository**: Link your GitHub repository to Vercel

2. **Environment Variables**: Set in Vercel dashboard:
   ```
   GOOGLE_MAPS_SERVER_KEY=your_server_key
   NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=your_browser_key
   NEXT_PUBLIC_DATA_URL=/data/realhome_listings_uk_sales_minimal.csv
   REALHOME_MAX_TILES=140
   REALHOME_PLACES_RADIUS=800
   REALHOME_DISABLE_PLACES=0
   REALHOME_DISABLE_DISTMATRIX=0
   ```

3. **Deploy**: Vercel will automatically build and deploy

### Post-Deployment Testing

Test these endpoints after deployment:

1. **Health Check**: `https://your-app.vercel.app/api/health`
   - Should return: `{"ok":true,"dataUrl":"/data/realhome_listings_uk_sales_minimal.csv","time":"..."}`

2. **CSV Data**: `https://your-app.vercel.app/data/realhome_listings_uk_sales_minimal.csv`
   - Should download the CSV file

3. **Main Application**: `https://your-app.vercel.app`
   - Should show Google Maps (not placeholder)
   - Search functionality should work with real results

## API Endpoints

### `/api/health`
Health check endpoint that verifies:
- Google Maps API keys are configured
- Data URL is accessible
- Returns current timestamp

### `/api/parse`
Parses natural language location preferences:
- Extracts area/location
- Identifies budget constraints
- Determines bedroom requirements
- Analyzes commute preferences

### `/api/score`
Scores locations based on parsed preferences:
- Uses Google Distance Matrix API for commute calculations
- Generates geographic grid of candidate locations
- Applies scoring algorithm combining commute and amenity factors
- Returns ranked results with detailed breakdowns

## Configuration

### Environment Variables

- `GOOGLE_MAPS_SERVER_KEY`: Server-side Google Maps API key
- `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`: Client-side Google Maps API key
- `NEXT_PUBLIC_DATA_URL`: Path to property listings CSV
- `REALHOME_MAX_TILES`: Maximum tiles per search (quota management)
- `REALHOME_PLACES_RADIUS`: Radius for Places API calls (meters)
- `REALHOME_DISABLE_PLACES`: Set to 1 to disable Places API
- `REALHOME_DISABLE_DISTMATRIX`: Set to 1 to disable Distance Matrix API

### Quota Management

The application includes built-in quota management:
- Limited to 140 tiles per search
- Modest 5x5 grid for efficient API usage
- Configurable radius for Places API calls
- Option to disable expensive API calls

## Data Format

The application expects CSV data with these columns:
- `price`: Property price
- `bedrooms`: Number of bedrooms
- `latitude`: Property latitude
- `longitude`: Property longitude
- Additional columns are preserved but not required

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Performance

- Server-side rendering for fast initial load
- Dynamic imports for Google Maps (client-side only)
- Optimized bundle size with code splitting
- Efficient API quota usage

## License

This project is licensed under the MIT License.
