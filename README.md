# Aircraft Event Viewer - Map Switcher

This project provides a unified interface to switch between 2D (Leaflet) and 3D (Cesium) maps for viewing aircraft intrusion events.

## Features

- **Seamless Map Switching**: Toggle between 2D and 3D views with a single button
- **Unified Data Management**: Same event data displayed in both map modes
- **Interactive Controls**: Event selection, animation playback, and media preview
- **Responsive Design**: Works on desktop and mobile devices

## Files Structure

- `index.html` - Main HTML file with unified interface
- `map-switcher.js` - Core JavaScript for map switching and data management
- `3D.css` - Styling for the application
- `3D.html` - Original 3D map (standalone)
- `3D.js` - Original 3D map JavaScript
- `2Dmap/script.js` - Original 2D map JavaScript

## Usage

1. **Open the main interface**:
   ```
   Open index.html in your web browser
   ```

2. **Switch between maps**:
   - Use the toggle switch in the top-right corner
   - Left position (2D): Shows Leaflet-based 2D map
   - Right position (3D): Shows Cesium-based 3D map

3. **Interact with events**:
   - Select events from the dropdown in the sidebar
   - View event details and media
   - Use animation controls to play event sequences

## Map Modes

### 2D Mode (Leaflet)
- Traditional flat map view
- Multiple base layers (OpenStreetMap, Satellite)
- GIS layer support
- Measurement tools
- Location controls

### 3D Mode (Cesium)
- Full 3D globe visualization
- Terrain visualization
- Aircraft model animations
- Advanced camera controls
- Real-time altitude display

## Configuration

Update the API endpoints in `map-switcher.js`:

```javascript
const BASE_API_URL = "http://your-api-server:port/event/event/api";
```

## Dependencies

### 2D Map Dependencies
- Leaflet.js
- Leaflet.locatecontrol
- Font Awesome (for icons)

### 3D Map Dependencies
- Cesium.js
- Cesium Ion token (configured in map-switcher.js)

## Browser Support

- Modern browsers with WebGL support for 3D features
- Mobile browsers (responsive design)
- Internet connection required for map tiles and Cesium library

## API Integration

The application expects the following API endpoints:

- `GET /events/` - List all events
- `GET /events/{id}/full/` - Get full event details
- `GET /events/{id}/media/` - Get event media files

## Customization

### Adding New Features
1. Modify `map-switcher.js` for core functionality
2. Update `index.html` for UI elements
3. Extend CSS in `3D.css` for styling

### Map-Specific Features
- 2D-only features: Add to the 2D rendering functions
- 3D-only features: Add to the 3D rendering functions
- Shared features: Add to the common data management functions

## Troubleshooting

### 3D Map Not Loading
- Check internet connection (Cesium loads from CDN)
- Verify Cesium Ion token is valid
- Ensure WebGL is supported in browser

### API Connection Issues
- Verify API server is running
- Check CORS settings on API server
- Update API endpoints in configuration

### Performance Issues
- Reduce number of events displayed simultaneously
- Adjust animation speed settings
- Use appropriate zoom levels for large datasets