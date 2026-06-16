// APSRTC Journey Planner - Core Application logic

// Global GTFS Data
let stops = [];
let routes = [];
let trips = [];
let shapes = [];
let stopTimes = [];

// In-Memory Indexes
const stopMap = {};       // stop_id -> { stop_name, stop_lat, stop_lon }
const stopTripsMap = {};  // stop_id -> Array of trip_ids
const tripStopsMap = {};  // trip_id -> Array of { stop_id, stop_sequence, arrival_time, departure_time } (ordered)
const shapeMap = {};      // shape_id -> Array of { lat, lon, sequence } (ordered)
const routesMap = {};     // route_id -> { route_short_name, route_long_name }
const tripRouteMap = {};  // trip_id -> route_id

// Unique Stop Names for Autocomplete
let uniqueStopNames = []; // Array of { name, ids }

// Selected autocomplete stops
let selectedSourceStopIds = null;
let selectedDestStopIds = null;

// Search results store
let currentJourneys = [];
let selectedJourneyIndex = -1;

// CSV Parser
function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length === 0) return [];
    
    // Parse headers
    const headers = parseCSVLine(lines[0]);
    
    const results = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCSVLine(line);
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = values[j] !== undefined ? values[j] : '';
        }
        results.push(obj);
    }
    return results;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result.map(val => {
        if (val.startsWith('"') && val.endsWith('"')) {
            return val.slice(1, -1).replace(/""/g, '"');
        }
        return val;
    });
}

// Progress Steps Indicator
function updateStep(stepId, state) {
    const el = document.getElementById(`step-${stepId}`);
    if (!el) return;
    
    el.className = `step-item ${state}`;
    const icon = el.querySelector('.step-icon');
    if (icon) {
        if (state === 'loading') {
            icon.innerHTML = '●';
        } else if (state === 'success') {
            icon.innerHTML = '✓';
        } else if (state === 'error') {
            icon.innerHTML = '✗';
        }
    }
}

function updateProgressBar(percent) {
    document.getElementById('progressBar').style.width = `${percent}%`;
    document.getElementById('progressPercent').innerText = `${percent}%`;
}

// Fetch and load a GTFS file
async function loadGTFSFile(filename, stepId, progressVal) {
    updateStep(stepId, 'loading');
    try {
        const res = await fetch(`gtfs/${filename}`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const text = await res.text();
        const data = parseCSV(text);
        updateStep(stepId, 'success');
        updateProgressBar(progressVal);
        return data;
    } catch (e) {
        updateStep(stepId, 'error');
        console.error(`Error loading ${filename}:`, e);
        document.querySelector('.loading-card p').innerText = `Error loading ${filename}: ${e.message}. Check file location.`;
        throw e;
    }
}

// Initialize Application Data
async function initData() {
    try {
        stops = await loadGTFSFile('stops.txt', 'stops', 15);
        routes = await loadGTFSFile('routes.txt', 'routes', 30);
        trips = await loadGTFSFile('trips.txt', 'trips', 45);
        shapes = await loadGTFSFile('shapes.txt', 'shapes', 60);
        stopTimes = await loadGTFSFile('stop_times.txt', 'stop_times', 85);
        
        buildIndexes();
        updateProgressBar(100);
        
        // Hide loader overlay after short delay
        setTimeout(() => {
            document.getElementById('loadingOverlay').classList.add('fade-out');
            document.getElementById('dataStatusText').innerText = "Database Connected";
            document.querySelector('.system-status').classList.add('online');
            // Fix Leaflet grey box sizing bug
            if (map) {
                map.invalidateSize();
            }
        }, 500);
        
        // Initialize Map
        initMap();
        
        // Setup Search Autocompletes
        buildAutocompleteList();
        setupAutocompletes();
        
    } catch (e) {
        console.error("GTFS Initialization aborted due to error:", e);
    }
}

// Build fast indexes in memory
function buildIndexes() {
    updateStep('indexing', 'loading');
    
    // 1. Build stopMap
    stops.forEach(s => {
        if (!s.stop_id) return;
        stopMap[s.stop_id] = {
            stop_name: s.stop_name || '',
            stop_lat: parseFloat(s.stop_lat) || 0,
            stop_lon: parseFloat(s.stop_lon) || 0
        };
    });
    
    // 2. Build routesMap
    routes.forEach(r => {
        if (!r.route_id) return;
        routesMap[r.route_id] = {
            route_short_name: r.route_short_name || '',
            route_long_name: r.route_long_name || ''
        };
    });

    // 3. Build tripRouteMap
    trips.forEach(t => {
        if (!t.trip_id) return;
        tripRouteMap[t.trip_id] = t.route_id;
    });

    // 4. Build shapeMap
    shapes.forEach(pt => {
        const shapeId = pt.shape_id;
        if (!shapeId) return;
        if (!shapeMap[shapeId]) {
            shapeMap[shapeId] = [];
        }
        shapeMap[shapeId].push({
            lat: parseFloat(pt.shape_pt_lat) || 0,
            lon: parseFloat(pt.shape_pt_lon) || 0,
            sequence: parseInt(pt.shape_pt_sequence) || 0
        });
    });
    // Sort shapes
    for (const shapeId in shapeMap) {
        shapeMap[shapeId].sort((a, b) => a.sequence - b.sequence);
    }

    // 5. Build stopTripsMap and tripStopsMap
    stopTimes.forEach(st => {
        const stopId = st.stop_id;
        const tripId = st.trip_id;
        if (!stopId || !tripId) return;
        
        if (!stopTripsMap[stopId]) {
            stopTripsMap[stopId] = new Set();
        }
        stopTripsMap[stopId].add(tripId);

        if (!tripStopsMap[tripId]) {
            tripStopsMap[tripId] = [];
        }
        tripStopsMap[tripId].push({
            stop_id: stopId,
            stop_sequence: parseInt(st.stop_sequence) || 0,
            arrival_time: st.arrival_time || '',
            departure_time: st.departure_time || ''
        });
    });

    // Sort tripStopsMap sequences
    for (const tripId in tripStopsMap) {
        tripStopsMap[tripId].sort((a, b) => a.stop_sequence - b.stop_sequence);
    }

    // Convert stopTripsMap Sets to Arrays for fast iteration
    for (const stopId in stopTripsMap) {
        stopTripsMap[stopId] = Array.from(stopTripsMap[stopId]);
    }
    
    updateStep('indexing', 'success');
}

// Build autocomplete reference map
function buildAutocompleteList() {
    const namesMap = {};
    stops.forEach(s => {
        const name = s.stop_name ? s.stop_name.trim() : '';
        if (!name) return;
        const key = name.toLowerCase();
        if (!namesMap[key]) {
            namesMap[key] = {
                name: name,
                ids: []
            };
        }
        namesMap[key].ids.push(s.stop_id);
    });
    uniqueStopNames = Object.values(namesMap).sort((a, b) => a.name.localeCompare(b.name));
}

// Set up Autocomplete Inputs
function setupAutocompletes() {
    setupAutocomplete('sourceInput', 'sourceSuggestions', 'clearSource', (ids) => {
        selectedSourceStopIds = ids;
    });

    setupAutocomplete('destInput', 'destSuggestions', 'clearDest', (ids) => {
        selectedDestStopIds = ids;
    });

    // Swap button
    document.getElementById('swapStopsBtn').addEventListener('click', () => {
        const sourceInput = document.getElementById('sourceInput');
        const destInput = document.getElementById('destInput');
        
        const tempVal = sourceInput.value;
        sourceInput.value = destInput.value;
        destInput.value = tempVal;
        
        const tempIds = selectedSourceStopIds;
        selectedSourceStopIds = selectedDestStopIds;
        selectedDestStopIds = tempIds;
        
        // Trigger clear button visibility
        document.getElementById('clearSource').style.display = sourceInput.value ? 'block' : 'none';
        document.getElementById('clearDest').style.display = destInput.value ? 'block' : 'none';
    });

    // Time input enabling
    const anyTimeCheckbox = document.getElementById('anyTimeCheckbox');
    const timeInput = document.getElementById('depTimeInput');
    
    // Set current local time by default
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    timeInput.value = `${hours}:${mins}`;

    anyTimeCheckbox.addEventListener('change', () => {
        timeInput.disabled = anyTimeCheckbox.checked;
    });

    // Find Journeys button
    document.getElementById('searchBtn').addEventListener('click', () => {
        performSearch();
    });
}

function setupAutocomplete(inputId, suggestionsId, clearBtnId, onSelectCallback) {
    const input = document.getElementById(inputId);
    const suggestions = document.getElementById(suggestionsId);
    const clearBtn = document.getElementById(clearBtnId);
    
    let activeIndex = -1;
    let filteredList = [];

    function hideList() {
        suggestions.classList.add('hidden');
        activeIndex = -1;
    }

    input.addEventListener('input', () => {
        const value = input.value.trim().toLowerCase();
        
        clearBtn.style.display = value.length > 0 ? 'block' : 'none';

        if (value.length < 1) {
            hideList();
            onSelectCallback(null);
            return;
        }

        // Search matches
        filteredList = uniqueStopNames.filter(stop => 
            stop.name.toLowerCase().includes(value)
        ).slice(0, 10);

        if (filteredList.length === 0) {
            suggestions.innerHTML = `<div class="no-suggestions">No stops found</div>`;
            suggestions.classList.remove('hidden');
            return;
        }

        // Render List
        suggestions.innerHTML = '';
        filteredList.forEach((stop, index) => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.dataset.index = index;

            // Highlight matches
            const indexMatch = stop.name.toLowerCase().indexOf(value);
            const rawName = stop.name;
            let displayName = rawName;
            if (indexMatch !== -1) {
                const prefix = rawName.substring(0, indexMatch);
                const match = rawName.substring(indexMatch, indexMatch + value.length);
                const suffix = rawName.substring(indexMatch + value.length);
                displayName = `${prefix}<span class="suggestion-match">${match}</span>${suffix}`;
            }

            div.innerHTML = `
                <span class="pin-icon">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="2" fill="currentColor"></circle>
                    </svg>
                </span>
                <span>${displayName}</span>
            `;

            div.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Prevent blur before selection
                selectSuggestion(stop);
            });

            suggestions.appendChild(div);
        });

        suggestions.classList.remove('hidden');
        activeIndex = -1;
    });

    input.addEventListener('keydown', (e) => {
        if (suggestions.classList.contains('hidden')) return;

        const items = suggestions.querySelectorAll('.suggestion-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % items.length;
            updateActiveState(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + items.length) % items.length;
            updateActiveState(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIndex >= 0 && activeIndex < filteredList.length) {
                selectSuggestion(filteredList[activeIndex]);
            } else if (filteredList.length > 0) {
                selectSuggestion(filteredList[0]);
            }
        } else if (e.key === 'Escape') {
            hideList();
        }
    });

    input.addEventListener('blur', () => {
        setTimeout(hideList, 200); // Small delay to register click
    });

    function updateActiveState(items) {
        items.forEach((item, index) => {
            if (index === activeIndex) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    function selectSuggestion(stop) {
        input.value = stop.name;
        clearBtn.style.display = 'block';
        hideList();
        onSelectCallback(stop.ids);
    }

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        hideList();
        onSelectCallback(null);
        input.focus();
    });
}

// Time parsing helpers
function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length < 2) return 0;
    const h = parseInt(parts[0]) || 0;
    const m = parseInt(parts[1]) || 0;
    return h * 60 + m;
}

function minutesToTimeStr(totalMinutes) {
    const normalized = totalMinutes % 1440;
    let h = Math.floor(normalized / 60);
    const m = normalized % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    const hStr = String(h).padStart(2, '0');
    const mStr = String(m).padStart(2, '0');
    return `${hStr}:${mStr} ${ampm}`;
}

function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} mins`;
    return `${h}h ${m}m`;
}

function getTripPathBetweenStops(tripId, startSeq, endSeq) {
    const stopsList = tripStopsMap[tripId] || [];
    return stopsList.filter(s => s.stop_sequence >= startSeq && s.stop_sequence <= endSeq);
}

// Search algorithm
function findJourneys(sourceIds, destIds, depTimeLimit) {
    const directResults = [];
    
    // 1. Find Direct Routes
    sourceIds.forEach(srcId => {
        destIds.forEach(dstId => {
            const srcTrips = stopTripsMap[srcId] || [];
            srcTrips.forEach(tripId => {
                const stopsInTrip = tripStopsMap[tripId] || [];
                const srcIdx = stopsInTrip.findIndex(st => st.stop_id === srcId);
                const dstIdx = stopsInTrip.findIndex(st => st.stop_id === dstId);
                
                if (srcIdx !== -1 && dstIdx !== -1 && srcIdx < dstIdx) {
                    const srcStop = stopsInTrip[srcIdx];
                    const dstStop = stopsInTrip[dstIdx];
                    const depTime = timeToMinutes(srcStop.departure_time);
                    const arrTime = timeToMinutes(dstStop.arrival_time);
                    
                    // Time filter
                    if (depTimeLimit === null || depTime >= depTimeLimit) {
                        const duration = arrTime - depTime;
                        const routeId = tripRouteMap[tripId] || '';
                        const routeInfo = routesMap[routeId] || { route_short_name: routeId, route_long_name: 'APSRTC Route' };
                        
                        directResults.push({
                          type: 'direct',
                          tripId: tripId,
                          routeShortName: routeInfo.route_short_name,
                          routeLongName: routeInfo.route_long_name,
                          sourceStopId: srcId,
                          destStopId: dstId,
                          depTime: depTime,
                          arrTime: arrTime,
                          duration: duration,
                          stopsCount: dstStop.stop_sequence - srcStop.stop_sequence,
                          path: getTripPathBetweenStops(tripId, srcStop.stop_sequence, dstStop.stop_sequence)
                        });
                    }
                }
            });
        });
    });

    if (directResults.length > 0) {
        // Sort direct results by departure time
        directResults.sort((a, b) => a.depTime - b.depTime);
        return directResults;
    }

    // 2. Find One-Transfer Routes (If no direct route exists)
    const reachableFromSource = {};
    sourceIds.forEach(srcId => {
        const tripsList = stopTripsMap[srcId] || [];
        tripsList.forEach(tripId => {
            const stopsInTrip = tripStopsMap[tripId] || [];
            const srcIdx = stopsInTrip.findIndex(s => s.stop_id === srcId);
            if (srcIdx === -1) return;
            const srcStop = stopsInTrip[srcIdx];
            const depFromSrc = timeToMinutes(srcStop.departure_time);
            
            // Time filter
            if (depTimeLimit !== null && depFromSrc < depTimeLimit) return;
            
            for (let i = srcIdx + 1; i < stopsInTrip.length; i++) {
                const transferStop = stopsInTrip[i];
                const arrAtTransfer = timeToMinutes(transferStop.arrival_time);
                const tStopId = transferStop.stop_id;
                
                if (!reachableFromSource[tStopId]) {
                    reachableFromSource[tStopId] = [];
                }
                reachableFromSource[tStopId].push({
                    tripId1: tripId,
                    depFromSrc: depFromSrc,
                    arrAtTransfer: arrAtTransfer,
                    sourceStopId: srcId,
                    startSeq: srcStop.stop_sequence,
                    transferSeq1: transferStop.stop_sequence
                });
            }
        });
    });

    const canReachDest = {};
    destIds.forEach(dstId => {
        const tripsList = stopTripsMap[dstId] || [];
        tripsList.forEach(tripId => {
            const stopsInTrip = tripStopsMap[tripId] || [];
            const dstIdx = stopsInTrip.findIndex(s => s.stop_id === dstId);
            if (dstIdx === -1) return;
            const dstStop = stopsInTrip[dstIdx];
            const arrAtDst = timeToMinutes(dstStop.arrival_time);
            
            for (let i = 0; i < dstIdx; i++) {
                const transferStop = stopsInTrip[i];
                const depFromTransfer = timeToMinutes(transferStop.departure_time);
                const tStopId = transferStop.stop_id;
                
                if (!canReachDest[tStopId]) {
                    canReachDest[tStopId] = [];
                }
                canReachDest[tStopId].push({
                    tripId2: tripId,
                    depFromTransfer: depFromTransfer,
                    arrAtDst: arrAtDst,
                    destStopId: dstId,
                    transferSeq2: transferStop.stop_sequence,
                    endSeq: dstStop.stop_sequence
                });
            }
        });
    });

    // Intersect keys
    const transferStopIds = Object.keys(reachableFromSource).filter(id => canReachDest[id]);
    const transferOptions = [];

    transferStopIds.forEach(tStopId => {
        const arrivals = reachableFromSource[tStopId];
        const departures = canReachDest[tStopId];
        
        let bestPair = null;
        let minTotalTime = Infinity;
        
        arrivals.forEach(arr => {
            departures.forEach(dep => {
                // Must be a chronologically valid transfer
                if (dep.depFromTransfer >= arr.arrAtTransfer) {
                    const waitingTime = dep.depFromTransfer - arr.arrAtTransfer;
                    const totalJourneyTime = dep.arrAtDst - arr.depFromSrc;
                    
                    if (totalJourneyTime < minTotalTime) {
                        minTotalTime = totalJourneyTime;
                        bestPair = {
                            arr: arr,
                            dep: dep,
                            waitingTime: waitingTime,
                            totalJourneyTime: totalJourneyTime
                        };
                    }
                }
            });
        });
        
        if (bestPair) {
            const routeId1 = tripRouteMap[bestPair.arr.tripId1] || '';
            const routeInfo1 = routesMap[routeId1] || { route_short_name: routeId1, route_long_name: 'APSRTC Route' };
            const routeId2 = tripRouteMap[bestPair.dep.tripId2] || '';
            const routeInfo2 = routesMap[routeId2] || { route_short_name: routeId2, route_long_name: 'APSRTC Route' };

            transferOptions.push({
                type: 'transfer',
                transferStopId: tStopId,
                transferStopName: stopMap[tStopId]?.stop_name || 'Transfer Stop',
                
                tripId1: bestPair.arr.tripId1,
                routeShortName1: routeInfo1.route_short_name,
                
                tripId2: bestPair.dep.tripId2,
                routeShortName2: routeInfo2.route_short_name,
                
                depFromSrc: bestPair.arr.depFromSrc,
                arrAtTransfer: bestPair.arr.arrAtTransfer,
                depFromTransfer: bestPair.dep.depFromTransfer,
                arrAtDst: bestPair.dep.arrAtDst,
                
                waitingTime: bestPair.waitingTime,
                totalJourneyTime: bestPair.totalJourneyTime,
                sourceStopId: bestPair.arr.sourceStopId,
                destStopId: bestPair.dep.destStopId,
                
                path1: getTripPathBetweenStops(bestPair.arr.tripId1, bestPair.arr.startSeq, bestPair.arr.transferSeq1),
                path2: getTripPathBetweenStops(bestPair.dep.tripId2, bestPair.dep.transferSeq2, bestPair.dep.endSeq)
            });
        }
    });

    // Select the best transfer routes sorted by total journey time
    transferOptions.sort((a, b) => a.totalJourneyTime - b.totalJourneyTime);
    return transferOptions;
}

// Perform Search Execution
function performSearch() {
    if (!selectedSourceStopIds) {
        alert("Please select a valid Source Stop from the suggestions.");
        return;
    }
    if (!selectedDestStopIds) {
        alert("Please select a valid Destination Stop from the suggestions.");
        return;
    }

    // Set loading state on button
    const searchBtn = document.getElementById('searchBtn');
    searchBtn.classList.add('loading');
    searchBtn.disabled = true;

    setTimeout(() => {
        let timeLimit = null;
        const anyTime = document.getElementById('anyTimeCheckbox').checked;
        if (!anyTime) {
            const val = document.getElementById('depTimeInput').value;
            if (val) {
                timeLimit = timeToMinutes(val);
            }
        }

        currentJourneys = findJourneys(selectedSourceStopIds, selectedDestStopIds, timeLimit);
        renderResults(currentJourneys);

        searchBtn.classList.remove('loading');
        searchBtn.disabled = false;
    }, 100);
}

// Render Results to UI
function renderResults(journeys) {
    const list = document.getElementById('resultsList');
    const header = document.getElementById('resultsHeader');
    const countText = document.getElementById('resultsCount');
    
    list.innerHTML = '';
    
    if (journeys.length === 0) {
        header.classList.add('hidden');
        list.innerHTML = `
            <div class="empty-state card">
                <div class="empty-icon">🔍</div>
                <h3>No Route Available</h3>
                <p>No direct or connecting buses found for the selected stops. Try changing the departure time limit or selecting different stop points.</p>
            </div>
        `;
        clearMap();
        return;
    }

    header.classList.remove('hidden');
    countText.innerText = `${journeys.length} route${journeys.length > 1 ? 's' : ''} found`;

    journeys.forEach((j, index) => {
        const card = document.createElement('div');
        card.className = `journey-card ${index === 0 ? 'selected' : ''}`;
        card.id = `journey-card-${index}`;
        card.addEventListener('click', () => selectJourney(index));

        if (j.type === 'direct') {
            card.innerHTML = `
                <div class="journey-card-header">
                    <span class="route-badge direct">Direct Bus Found</span>
                    <span class="journey-duration">${formatDuration(j.duration)}</span>
                </div>
                <div class="journey-card-body">
                    <div class="journey-summary">
                        <div class="station-time-group">
                            <span class="time-val">${minutesToTimeStr(j.depTime)}</span>
                            <span class="station-name">${stopMap[j.sourceStopId].stop_name}</span>
                        </div>
                        
                        <div class="route-arrow-flow">
                            <div class="route-flow-line"></div>
                            <div style="display: flex; gap: 40px; justify-content: center; width: 100%;">
                                <span class="route-flow-dot"></span>
                                <span class="route-flow-dot end"></span>
                            </div>
                            <span class="trip-short-info">Bus: ${j.routeShortName} (Trip ${j.tripId})</span>
                        </div>
                        
                        <div class="station-time-group end">
                            <span class="time-val">${minutesToTimeStr(j.arrTime)}</span>
                            <span class="station-name">${stopMap[j.destStopId].stop_name}</span>
                        </div>
                    </div>
                    
                    <div class="journey-stepper">
                        <div class="stepper-node">
                            <div class="stepper-icon"></div>
                            <div class="stepper-content">
                                <span class="stepper-time">${minutesToTimeStr(j.depTime)}</span>
                                <span class="stepper-title">Board Bus at ${stopMap[j.sourceStopId].stop_name}</span>
                                <p class="stepper-desc">Trip ID: ${j.tripId} | Bus Route: ${j.routeShortName}</p>
                            </div>
                        </div>
                        
                        <div class="stepper-node">
                            <div class="stepper-icon end-node"></div>
                            <div class="stepper-content">
                                <span class="stepper-time">${minutesToTimeStr(j.arrTime)}</span>
                                <span class="stepper-title">Alight at ${stopMap[j.destStopId].stop_name}</span>
                                <p class="stepper-desc">Journey distance: ${j.stopsCount} stop${j.stopsCount > 1 ? 's' : ''}</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Transfer
            card.innerHTML = `
                <div class="journey-card-header">
                    <span class="route-badge transfer">Recommended Route</span>
                    <span class="journey-duration">${formatDuration(j.totalJourneyTime)}</span>
                </div>
                <div class="journey-card-body">
                    <div class="journey-summary">
                        <div class="station-time-group">
                            <span class="time-val">${minutesToTimeStr(j.depFromSrc)}</span>
                            <span class="station-name">${stopMap[j.sourceStopId].stop_name}</span>
                        </div>
                        
                        <div class="route-arrow-flow">
                            <div class="route-flow-line transfer-route"></div>
                            <div style="display: flex; justify-content: space-between; width: 100%;">
                                <span class="route-flow-dot"></span>
                                <span class="route-flow-dot transfer-dot"></span>
                                <span class="route-flow-dot end"></span>
                            </div>
                            <span class="trip-short-info">Transfer via ${j.transferStopName}</span>
                        </div>
                        
                        <div class="station-time-group end">
                            <span class="time-val">${minutesToTimeStr(j.arrAtDst)}</span>
                            <span class="station-name">${stopMap[j.destStopId].stop_name}</span>
                        </div>
                    </div>
                    
                    <div class="journey-stepper">
                        <div class="stepper-node">
                            <div class="stepper-icon"></div>
                            <div class="stepper-content">
                                <span class="stepper-time">${minutesToTimeStr(j.depFromSrc)}</span>
                                <span class="stepper-title">Board Bus 1 (Route ${j.routeShortName1}) at ${stopMap[j.sourceStopId].stop_name}</span>
                                <p class="stepper-desc">Trip ID: ${j.tripId1}</p>
                            </div>
                        </div>
                        
                        <div class="stepper-node">
                            <div class="stepper-icon transfer-node"></div>
                            <div class="stepper-content">
                                <span class="stepper-time">${minutesToTimeStr(j.arrAtTransfer)}</span>
                                <span class="stepper-title">Arrive at Transfer: ${j.transferStopName}</span>
                                <p class="stepper-desc">Leg 1 duration: ${formatDuration(j.arrAtTransfer - j.depFromSrc)} | ${j.path1.length - 1} stops</p>
                            </div>
                        </div>
                        
                        <div class="wait-banner">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <path d="M12 6v6l4 2"/>
                            </svg>
                            <span>Wait ${formatDuration(j.waitingTime)} at transfer point</span>
                        </div>
                        
                        <div class="stepper-node">
                            <div class="stepper-icon"></div>
                            <div class="stepper-content">
                                <span class="stepper-time">${minutesToTimeStr(j.depFromTransfer)}</span>
                                <span class="stepper-title">Board Bus 2 (Route ${j.routeShortName2}) from ${j.transferStopName}</span>
                                <p class="stepper-desc">Trip ID: ${j.tripId2}</p>
                            </div>
                        </div>
                        
                        <div class="stepper-node">
                            <div class="stepper-icon end-node"></div>
                            <div class="stepper-content">
                                <span class="stepper-time">${minutesToTimeStr(j.arrAtDst)}</span>
                                <span class="stepper-title">Alight at Destination: ${stopMap[j.destStopId].stop_name}</span>
                                <p class="stepper-desc">Leg 2 duration: ${formatDuration(j.arrAtDst - j.depFromTransfer)} | ${j.path2.length - 1} stops</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        list.appendChild(card);
    });

    // Auto-select first journey
    selectJourney(0);
}

// Select a journey from results and plot it
function selectJourney(index) {
    if (index < 0 || index >= currentJourneys.length) return;
    
    // Remove previous selection states
    if (selectedJourneyIndex >= 0) {
        const oldCard = document.getElementById(`journey-card-${selectedJourneyIndex}`);
        if (oldCard) oldCard.classList.remove('selected');
    }
    
    selectedJourneyIndex = index;
    const activeCard = document.getElementById(`journey-card-${index}`);
    if (activeCard) activeCard.classList.add('selected');
    
    const journey = currentJourneys[index];
    if (journey.type === 'direct') {
        plotDirectRoute(journey);
    } else {
        plotTransferRoute(journey);
    }
}

// Leaflet Map Logic
let map = null;
let mapLayers = [];
let currentTileLayer = null;

function setMapStyle(style) {
    if (!map) return;
    if (currentTileLayer) {
        map.removeLayer(currentTileLayer);
    }
    
    let url = '';
    let attribution = '';
    
    if (style === 'google-road') {
        url = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
        attribution = '&copy; Google Maps';
    } else if (style === 'google-satellite') {
        url = 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
        attribution = '&copy; Google Maps';
    } else if (style === 'google-terrain') {
        url = 'https://mt1.google.com/vt/lyrs=t,r&x={x}&y={y}&z={z}';
        attribution = '&copy; Google Maps';
    } else {
        url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        attribution = '&copy; OpenStreetMap contributors';
    }
    
    currentTileLayer = L.tileLayer(url, {
        attribution: attribution,
        maxZoom: 20
    }).addTo(map);
}

function initMap() {
    try {
        if (typeof L === 'undefined') {
            document.getElementById('mapOfflineFallback').classList.remove('hidden');
            return;
        }
        
        // Center around Vijayawada (transit hub of AP)
        map = L.map('map').setView([16.5, 80.6], 7);
        
        // Default to Google Maps Road
        setMapStyle('google-road');

        // Style select listener
        const styleSelect = document.getElementById('mapStyleSelect');
        if (styleSelect) {
            styleSelect.addEventListener('change', (e) => {
                setMapStyle(e.target.value);
            });
        }

        document.getElementById('resetMapBtn').addEventListener('click', () => {
            if (mapLayers.length > 0) {
                const polylines = mapLayers.filter(layer => layer instanceof L.Polyline);
                if (polylines.length > 0) {
                    const bounds = L.latLngBounds(polylines.map(p => p.getBounds()));
                    map.fitBounds(bounds, { padding: [40, 40] });
                }
            } else {
                map.setView([16.5, 80.6], 7);
            }
        });
        
    } catch (e) {
        console.error("Leaflet initialization failed:", e);
        document.getElementById('mapOfflineFallback').classList.remove('hidden');
    }
}

function clearMap() {
    mapLayers.forEach(layer => {
        if (map && layer) map.removeLayer(layer);
    });
    mapLayers = [];
}

function createCustomIcon(color, text) {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="
            background-color: ${color};
            color: white;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 700;
            border: 2px solid white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">${text}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

function plotDirectRoute(journey) {
    if (!map) return;
    clearMap();
    map.invalidateSize();

    const stopCoords = [];
    journey.path.forEach(st => {
        const coords = stopMap[st.stop_id];
        if (coords) {
            stopCoords.push([coords.stop_lat, coords.stop_lon]);
        }
    });

    // Resolve shape path coordinates if available
    const tripId = journey.tripId;
    const tripObj = trips.find(t => t.trip_id === tripId);
    const shapeId = tripObj?.shape_id;
    let pathPoints = [];

    if (shapeId && shapeMap[shapeId]) {
        // Draw the shape line directly
        pathPoints = shapeMap[shapeId].map(pt => [pt.lat, pt.lon]);
    } else {
        // Fallback to stop lines
        pathPoints = stopCoords;
    }

    if (pathPoints.length > 0) {
        const polyline = L.polyline(pathPoints, {
            color: 'var(--primary)',
            weight: 5,
            opacity: 0.85
        }).addTo(map);
        mapLayers.push(polyline);
        
        map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    }

    // Add start and end pins
    const startCoords = stopMap[journey.sourceStopId];
    const endCoords = stopMap[journey.destStopId];

    if (startCoords) {
        const startMarker = L.marker([startCoords.stop_lat, startCoords.stop_lon], {
            icon: createCustomIcon('var(--primary)', 'S')
        })
        .bindPopup(`<b>Start Stop:</b><br>${stopMap[journey.sourceStopId].stop_name}`)
        .addTo(map);
        mapLayers.push(startMarker);
    }

    if (endCoords) {
        const endMarker = L.marker([endCoords.stop_lat, endCoords.stop_lon], {
            icon: createCustomIcon('var(--danger)', 'D')
        })
        .bindPopup(`<b>Destination Stop:</b><br>${stopMap[journey.destStopId].stop_name}`)
        .addTo(map);
        mapLayers.push(endMarker);
    }

    // Add intermediate stop dots
    journey.path.slice(1, -1).forEach(st => {
        const coords = stopMap[st.stop_id];
        if (coords) {
            const circle = L.circleMarker([coords.stop_lat, coords.stop_lon], {
                radius: 4,
                color: 'var(--primary-hover)',
                fillColor: '#fff',
                fillOpacity: 1,
                weight: 2
            })
            .bindPopup(`<b>Stop:</b> ${coords.stop_name}<br><b>Arrival:</b> ${st.arrival_time}`)
            .addTo(map);
            mapLayers.push(circle);
        }
    });
}

function plotTransferRoute(journey) {
    if (!map) return;
    clearMap();
    map.invalidateSize();

    const allPoints = [];

    // Path 1 (Source -> Transfer)
    const tripId1 = journey.tripId1;
    const tripObj1 = trips.find(t => t.trip_id === tripId1);
    const shapeId1 = tripObj1?.shape_id;
    let pathPoints1 = [];
    const stopCoords1 = journey.path1.map(st => stopMap[st.stop_id]).filter(Boolean).map(c => [c.stop_lat, c.stop_lon]);

    if (shapeId1 && shapeMap[shapeId1]) {
        pathPoints1 = shapeMap[shapeId1].map(pt => [pt.lat, pt.lon]);
    } else {
        pathPoints1 = stopCoords1;
    }

    // Path 2 (Transfer -> Destination)
    const tripId2 = journey.tripId2;
    const tripObj2 = trips.find(t => t.trip_id === tripId2);
    const shapeId2 = tripObj2?.shape_id;
    let pathPoints2 = [];
    const stopCoords2 = journey.path2.map(st => stopMap[st.stop_id]).filter(Boolean).map(c => [c.stop_lat, c.stop_lon]);

    if (shapeId2 && shapeMap[shapeId2]) {
        pathPoints2 = shapeMap[shapeId2].map(pt => [pt.lat, pt.lon]);
    } else {
        pathPoints2 = stopCoords2;
    }

    // Draw segment 1 (Solid Blue for Bus 1)
    if (pathPoints1.length > 0) {
        const polyline1 = L.polyline(pathPoints1, {
            color: '#3b82f6',
            weight: 5,
            opacity: 0.9
        }).addTo(map);
        mapLayers.push(polyline1);
        allPoints.push(...pathPoints1);
    }

    // Draw segment 2 (Solid Red for Bus 2)
    if (pathPoints2.length > 0) {
        const polyline2 = L.polyline(pathPoints2, {
            color: '#ef4444',
            weight: 5,
            opacity: 0.9
        }).addTo(map);
        mapLayers.push(polyline2);
        allPoints.push(...pathPoints2);
    }

    if (allPoints.length > 0) {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] });
    }

    // Start, Transfer, End pins
    const startCoords = stopMap[journey.sourceStopId];
    const transCoords = stopMap[journey.transferStopId];
    const endCoords = stopMap[journey.destStopId];

    if (startCoords) {
        const startMarker = L.marker([startCoords.stop_lat, startCoords.stop_lon], {
            icon: createCustomIcon('#3b82f6', 'S')
        })
        .bindPopup(`<b>Start Stop:</b><br>${stopMap[journey.sourceStopId].stop_name}`)
        .addTo(map);
        mapLayers.push(startMarker);
    }

    if (transCoords) {
        const transMarker = L.marker([transCoords.stop_lat, transCoords.stop_lon], {
            icon: createCustomIcon('var(--warning)', 'T')
        })
        .bindPopup(`<b>Transfer Point:</b><br>${journey.transferStopName}<br><b>Wait Time:</b> ${formatDuration(journey.waitingTime)}`)
        .addTo(map);
        mapLayers.push(transMarker);
    }

    if (endCoords) {
        const endMarker = L.marker([endCoords.stop_lat, endCoords.stop_lon], {
            icon: createCustomIcon('#ef4444', 'D')
        })
        .bindPopup(`<b>Destination Stop:</b><br>${stopMap[journey.destStopId].stop_name}`)
        .addTo(map);
        mapLayers.push(endMarker);
    }

    // intermediate circles Leg 1
    journey.path1.slice(1, -1).forEach(st => {
        const coords = stopMap[st.stop_id];
        if (coords) {
            const circle = L.circleMarker([coords.stop_lat, coords.stop_lon], {
                radius: 4,
                color: 'var(--primary-hover)',
                fillColor: '#fff',
                fillOpacity: 1,
                weight: 2
            })
            .bindPopup(`<b>Stop (Bus 1):</b> ${coords.stop_name}<br><b>Arrival:</b> ${st.arrival_time}`)
            .addTo(map);
            mapLayers.push(circle);
        }
    });

    // intermediate circles Leg 2
    journey.path2.slice(1, -1).forEach(st => {
        const coords = stopMap[st.stop_id];
        if (coords) {
            const circle = L.circleMarker([coords.stop_lat, coords.stop_lon], {
                radius: 4,
                color: 'var(--danger)',
                fillColor: '#fff',
                fillOpacity: 1,
                weight: 2
            })
            .bindPopup(`<b>Stop (Bus 2):</b> ${coords.stop_name}<br><b>Arrival:</b> ${st.arrival_time}`)
            .addTo(map);
            mapLayers.push(circle);
        }
    });
}

// Start Loading Data on script execute
initData();