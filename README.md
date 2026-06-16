# APSRTC Journey Planner

A browser-based transit planner built using APSRTC GTFS data.

## Features

- Direct Bus Route Search
- Smart Transfer Detection
- Fastest Connecting Route Selection
- Departure & Arrival Time Calculation
- Journey Duration Estimation
- Interactive Route Mapping using Leaflet
- GTFS Shapes Visualization

## How It Works

The application loads GTFS files:

- stops.txt
- stop_times.txt
- trips.txt
- routes.txt
- shapes.txt

and builds optimized in-memory indexes for fast route discovery.

### Direct Route Search

Finds trips where:

```text
Source Stop → Destination Stop
```

exist within the same trip.

### Connecting Route Search

If no direct route exists:

1. Finds all reachable stops from source.
2. Finds all stops that can reach destination.
3. Finds common transfer points.
4. Calculates waiting time and total journey time.
5. Recommends the fastest route.

## Algorithm

The planner uses:

- GTFS Indexing
- Transfer Stop Intersection Search
- Greedy Fastest Route Selection

This approach provides fast route planning without requiring a backend database.

## Tech Stack

- HTML
- CSS
- JavaScript
- Leaflet Maps
- GTFS Transit Data

## Future Improvements

- Multi-transfer routing
- Dijkstra-based shortest path search
- Real-time APSRTC vehicle tracking
- PostgreSQL/PostGIS backend
- Mobile application support
