// Configuration
const CONFIG = {
    center: [40.4168, -3.7038], // Madrid
    zoom: 6,
    dataFile: 'datos.geojson',
    execFile: 'exec.csv',
    spainFile: 'Spain.geojson',
    rfigFile: 'RFIG.json',
    dateProperty: 'fecha',
    markerColor: '#C4D600' // Lime green color requested
};

// Initialize Map with locked interaction
const map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    touchZoom: false,
    keyboard: false,
    boxZoom: false
});

// Set bounds (South, West), (North, East)
// User specified N: 44.669, S: 35.115
// We estimate W/E to cover the peninsula roughly (-10, 4.5) to ensure fit
const mapBounds = [
    [34.400, -10.0], // South-West
    [45.000, 4.5]    // North-East
];
map.fitBounds(mapBounds);

// Create Panes to control z-index ordering
// Basemap at bottom
map.createPane('basemapPane');
map.getPane('basemapPane').style.zIndex = 200;

// Marker Panes (Ordered so smaller markers are on top of larger ones)
// Large (>1M) at bottom, Small (<10k) at top
map.createPane('markerPaneXL'); // > 1M
map.getPane('markerPaneXL').style.zIndex = 500;

map.createPane('markerPaneL'); // 100k - 1M
map.getPane('markerPaneL').style.zIndex = 501;

map.createPane('markerPaneM'); // 10k - 100k
map.getPane('markerPaneM').style.zIndex = 502;

map.createPane('markerPaneS'); // < 10k
map.getPane('markerPaneS').style.zIndex = 503;

// removed CARTO tiles as requested

L.control.zoom({ position: 'topright' }).addTo(map);

// Global variables
let geoJsonData = null;
let markersLayer = L.layerGroup().addTo(map);
let monthlySteps = [];
let isPlaying = false;
let playInterval = null;
const PLAY_SPEED_MS = 500;
let hasInteracted = false; // Flag to control initial marker visibility

// Map to track active markers: { featureId: markerInstance }
const activeMarkers = new Map();

// Marker Style
const markerOptions = {
    radius: 4,
    fillColor: CONFIG.markerColor,
    color: '#00292E', // Dark Teal Outline
    weight: 1.5,      // Visible stroke
    opacity: 1,
    fillOpacity: 0.8
};

function createMarker(feature) {
    const props = feature.properties;

    // Formatear datos
    const fechaRaw = props['fecha'];
    const fecha = fechaRaw ? fechaRaw : 'Sin fecha';
    const obra = props['obra'] || 'Obra sin nombre';
    // Mapping 'localizacion' from data to what was 'MUNICIPIO' in legacy script
    const municipio = props['localizacion'] || props['MUNICIPIO'] || 'Desconocido';

    // Diseño del Popup
    const popupContent = `
        <div style="font-family: 'Open Sans', sans-serif; color: #0f172a; min-width: 200px;">
            <h3 style="margin: 0 0 4px 0; color: #0284c7; font-size: 1.1rem; font-weight: 600;">${obra}</h3>
            <div style="font-size: 0.9rem; color: #64748b; margin-bottom: 8px;">
                <span style="font-weight: 500;">📍 ${municipio}</span>
            </div>
            <div style="font-size: 0.85rem; border-top: 1px solid #e2e8f0; padding-top: 6px; display: flex; justify-content: space-between;">
                <span style="color: #94a3b8;">Fecha de registro:</span>
                <span style="font-weight: 600; color: #334155;">${fecha}</span>
            </div>
        </div>
    `;

    // Determine radius & pane based on 'importe'
    const importe = props['importe'] || 0;
    let radius = 3;
    let paneName = 'markerPaneS';

    if (importe >= 1000000) {
        radius = 12;
        paneName = 'markerPaneXL';
    } else if (importe >= 100000) {
        radius = 9;
        paneName = 'markerPaneL';
    } else if (importe >= 10000) {
        radius = 6;
        paneName = 'markerPaneM';
    }

    const finalOptions = {
        ...markerOptions,
        radius: radius,
        pane: paneName
    };

    return L.circleMarker([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], finalOptions)
        .bindPopup(popupContent);
}

// UI Elements
// UI Elements
const slider = document.getElementById('time-slider');
const dateDisplay = document.getElementById('current-date');
const startDateLabel = document.getElementById('start-date-label');
const endDateLabel = document.getElementById('end-date-label');
const playBtn = document.getElementById('play-pause-btn');

// Helper to parse dates (handles both DD/MM/YYYY and YYYY-MM-DD from clean data)
function parseDate(dateStr) {
    if (!dateStr) return null;

    // Check for YYYY-MM-DD (ISO format from easy fix)
    if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        // Create local date: new Date(year, monthIndex, day)
        if (parts.length === 3) {
            return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        }
    }

    // Fallback for DD/MM/YYYY
    const parts = dateStr.split('/');
    if (parts.length !== 3) return new Date(dateStr);
    return new Date(parts[2], parts[1] - 1, parts[0]);
}

// Generate monthly steps from min to max date
function generateMonthlySteps(minTimestamp, maxTimestamp) {
    const steps = [];
    let currentDate = new Date(minTimestamp);
    currentDate.setDate(1);
    currentDate.setHours(0, 0, 0, 0);

    const endDate = new Date(maxTimestamp);
    endDate.setDate(1);
    endDate.setMonth(endDate.getMonth() + 1);

    while (currentDate <= endDate) {
        steps.push(currentDate.getTime());
        currentDate.setMonth(currentDate.getMonth() + 1);
    }
    return steps;
}

function initApp(geoData, execData) {
    geoJsonData = geoData;

    // 1. Parse dates and sort data
    let idCounter = 0;
    const featuresWithTime = geoJsonData.features.map(f => {
        const dateStr = f.properties[CONFIG.dateProperty];
        const d = parseDate(dateStr);

        if (d && !isNaN(d.getTime())) {
            f.properties._timestamp = d.getTime();
        } else {
            f.properties._timestamp = NaN;
        }

        // Ensure unique ID for diffing
        if (!f.properties.id) {
            f.properties._uniqueId = 'gen_' + idCounter++;
        }

        return f;
    }).filter(f => !isNaN(f.properties._timestamp));

    // Sort by date
    featuresWithTime.sort((a, b) => a.properties._timestamp - b.properties._timestamp);
    geoJsonData.features = featuresWithTime;

    if (featuresWithTime.length === 0) {
        alert("No se encontraron fechas válidas.");
        return;
    }

    // 2. Determine Time Range & Steps
    // Forced start date: June 2017 (Month 5 is June)
    const minTime = new Date(2017, 5, 1).getTime();
    let maxTime = featuresWithTime[featuresWithTime.length - 1].properties._timestamp;

    // Ensure maxTime is at least minTime to avoid errors if data is old
    if (maxTime < minTime) maxTime = minTime;

    monthlySteps = generateMonthlySteps(minTime, maxTime);

    // 3. Setup Slider
    slider.min = 0;
    slider.max = monthlySteps.length - 1;
    slider.value = 0;
    slider.step = 1;

    startDateLabel.textContent = new Date(monthlySteps[0]).toLocaleDateString();
    endDateLabel.textContent = new Date(monthlySteps[monthlySteps.length - 1]).toLocaleDateString();

    // 4. Per-step Budget Calculation
    // Initialize array with 0s
    cumulativeBudgetSteps = monthlySteps.map(stepTimestamp => {
        return { date: stepTimestamp, total: 0 };
    });

    if (execData && execData.length > 0) {
        let runningTotal = 0;
        let execIndex = 0;

        // Iterate through each timeline step
        for (let i = 0; i < monthlySteps.length; i++) {
            const stepDate = monthlySteps[i];

            // Add all execution amounts that happened before or on this step's date
            while (execIndex < execData.length && execData[execIndex].date <= stepDate) {
                runningTotal += execData[execIndex].amount;
                execIndex++;
            }

            cumulativeBudgetSteps[i].total = runningTotal;
        }
        console.log("Budget Steps Calculation Complete. Total Steps:", cumulativeBudgetSteps.length, "Final Cumulative Value:", runningTotal);
    } else {
        console.warn("No execution data found or merged.");
    }

    // 5. Initial Render
    updateMap(0);

    // 5. Event Listeners
    slider.addEventListener('input', (e) => {
        if (!hasInteracted) hasInteracted = true;
        const val = parseInt(e.target.value, 10);
        updateMap(val);
    });

    playBtn.addEventListener('click', togglePlay);

    // 6. Initialize Charts
    initChart();
    initBudgetChart();
    window.addEventListener('resize', () => {
        const newTitleSize = getTitleFontSize();
        const newLabelSize = getLabelFontSize();

        if (chartInstance) {
            chartInstance.resize();
            chartInstance.setOption({
                title: { textStyle: { fontSize: newTitleSize } },
                series: [
                    { label: { fontSize: newLabelSize } },
                    { label: { fontSize: newLabelSize } }
                ]
            });
        }
        if (budgetChartInstance) {
            budgetChartInstance.resize();
            budgetChartInstance.setOption({
                title: { textStyle: { fontSize: newTitleSize } },
                yAxis: { axisLabel: { fontSize: newLabelSize } }
            });
        }
    });
}

function getTitleFontSize() {
    return window.innerWidth < 1600 ? 16 : 24;
}

function getLabelFontSize() {
    return window.innerWidth < 1600 ? 10 : 14;
}

// Chart Variables
let chartInstance = null;
let budgetChartInstance = null;
let cumulativeBudgetSteps = []; // Stores { date: timestamp, total: number } for each step

function initBudgetChart() {
    const chartDom = document.getElementById('budget-chart-container');
    if (!chartDom) return;

    budgetChartInstance = echarts.init(chartDom);
    const option = {
        title: {
            text: 'Evolución de importes reconocidos',
            textStyle: {
                color: '#FFFFFF',
                fontFamily: 'Open Sans, sans-serif',
                fontSize: getTitleFontSize(),
                fontWeight: 600
            },
            left: 'center',
            top: 10
        },
        grid: {
            top: 40,
            bottom: 20,
            left: 50,
            right: 20
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'line' },
            formatter: function (params) {
                const val = params[0].value;
                const formatted = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(val);
                return `${params[0].axisValue}<br/>${formatted}`;
            }
        },
        xAxis: {
            type: 'category',
            boundaryGap: false,
            data: [],
            axisLabel: { show: false },
            axisLine: { show: false },
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            splitLine: {
                show: true,
                lineStyle: { color: 'rgba(255, 255, 255, 0.3)', type: 'dashed', opacity: 0.3 }
            },
            axisLabel: {
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: 'Open Sans, sans-serif',
                fontSize: getLabelFontSize(),
                formatter: (value) => {
                    return value >= 1000000 ? (value / 1000000).toFixed(0) + 'M€' : (value / 1000).toFixed(0) + 'k€';
                }
            }
        },
        series: [{
            name: 'Ejecutado',
            type: 'line',
            smooth: true,
            symbol: 'none',
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(255, 255, 255, 0.5)' },
                    { offset: 1, color: 'rgba(255, 255, 255, 0.0)' }
                ])
            },
            itemStyle: { color: '#FFFFFF' },
            data: []
        }],
        backgroundColor: 'transparent'
    };
    budgetChartInstance.setOption(option);
}

function updateBudgetChart(stepIndex) {
    if (!budgetChartInstance || cumulativeBudgetSteps.length === 0) return;

    if (stepIndex < 0 || stepIndex >= cumulativeBudgetSteps.length) {
        console.warn("Invalid stepIndex for budget chart:", stepIndex);
        return;
    }

    // Get data up to current step
    // We want the chart to show the history up to this point
    const currentHistory = cumulativeBudgetSteps.slice(0, stepIndex + 1);

    // Extract X and Y for chart
    const dates = currentHistory.map(d => new Date(d.date).toLocaleDateString());
    const values = currentHistory.map(d => d.total);

    // Update Chart
    budgetChartInstance.setOption({
        xAxis: { data: dates },
        series: [{ data: values }]
    });

    // Update KPI (Current Total) with Animation
    const currentTotal = values[values.length - 1] || 0;
    const kpiEl = document.getElementById('kpi-value');
    if (kpiEl) {
        animateValue(kpiEl, currentKpiValue, currentTotal, 500);
        currentKpiValue = currentTotal; // Update global tracker
    }
}

// Global to track last KPI value
let currentKpiValue = 0;

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const currentVal = start + progress * (end - start);

        // Dynamic Font Size Scaling
        // Min: 0 € -> 2.2rem
        // Max: 100M € -> 5.3rem
        const minSize = 2.2;
        const maxSize = 5.3;
        const maxBudget = 100000000; // 100 Million

        // Calculate scale factor (0 to 1)
        let scale = Math.min(currentVal / maxBudget, 1);
        let newSize = minSize + (scale * (maxSize - minSize));

        obj.style.fontSize = `${newSize.toFixed(2)}rem`;

        // Format value
        if (currentVal >= 1000000) {
            obj.textContent = (currentVal / 1000000).toFixed(2) + ' M€';
        } else if (currentVal >= 1000) {
            obj.textContent = (currentVal / 1000).toFixed(1) + ' k€';
        } else {
            obj.textContent = currentVal.toFixed(0) + ' €';
        }

        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function initChart() {
    const chartDom = document.getElementById('chart-container');
    if (!chartDom) return;

    chartInstance = echarts.init(chartDom);
    const option = {
        title: {
            text: 'Expedientes por titular',
            textStyle: {
                color: '#FFFFFF',
                fontFamily: 'Open Sans, sans-serif',
                fontSize: getTitleFontSize(),
                fontWeight: 600
            },
            left: 'center',
            top: 10
        },
        grid: {
            top: 50,
            bottom: 20,
            left: 170, // Space for names on left
            right: 80, // Space for values on right
            containLabel: true
        },
        xAxis: {
            type: 'value',
            splitLine: { show: false },
            axisLabel: { show: false }
        },
        yAxis: {
            type: 'category',
            inverse: true,
            max: 9, // Top 10
            axisLabel: { show: false },
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
            animationDuration: 300,
            animationDurationUpdate: 300
        },
        series: [
            // Series 1: The Visible Bar + Name Label (Left)
            {
                realtimeSort: true,
                name: 'Titulares',
                type: 'bar',
                data: [],
                encode: { x: 'value', y: 'name' },
                label: {
                    show: true,
                    position: 'left',
                    formatter: '{b}', // Name
                    color: '#FFFFFF', // White labels
                    fontFamily: 'Open Sans, sans-serif',
                    fontWeight: 500,
                    fontSize: getLabelFontSize(),
                    align: 'right',
                    offset: [-10, 0],
                    valueAnimation: true
                },
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                        { offset: 0, color: 'rgba(255, 255, 255, 0.8)' },
                        { offset: 1, color: '#FFFFFF' }
                    ]),
                    borderRadius: [0, 4, 4, 0]
                },
                barWidth: '65%',
                animationDuration: 0,
                animationDurationUpdate: CONFIG.animationSpeed || 500,
                animationEasing: 'linear',
                animationEasingUpdate: 'linear'
            },
            // Series 2: Phantom Bar + Value Label (Right)
            {
                realtimeSort: true,
                name: 'Values',
                type: 'bar',
                data: [],
                encode: { x: 'value', y: 'name' },
                barGap: '-100%', // Overlap perfectly
                label: {
                    show: true,
                    position: 'right',
                    formatter: '{c}', // Value
                    color: '#FFFFFF', // White value label
                    fontFamily: 'Open Sans, sans-serif',
                    fontWeight: 600,
                    fontSize: getLabelFontSize(),
                    offset: [10, 0],
                    valueAnimation: true
                },
                itemStyle: {
                    color: 'transparent' // Invisible bar
                },
                barWidth: '65%',
                z: 10, // On top
                animationDuration: 0,
                animationDurationUpdate: CONFIG.animationSpeed || 500,
                animationEasing: 'linear',
                animationEasingUpdate: 'linear'
            }
        ],
        backgroundColor: 'transparent'
    };
    chartInstance.setOption(option);
}

function updateChart(visibleFeatures) {
    if (!chartInstance) return;

    // 1. Count occurrences by TITULAR
    const counts = {};
    visibleFeatures.forEach(f => {
        const rawTitular = f.properties['titular'] || f.properties['TITULAR'];
        if (!rawTitular) return;

        const titular = rawTitular.trim().toUpperCase();
        counts[titular] = (counts[titular] || 0) + 1;
    });

    // 2. Convert to array
    let data = Object.keys(counts).map(key => {
        return {
            name: key,
            value: counts[key]
        };
    });

    // 3. Update Chart (Both series get the same data to sync)
    chartInstance.setOption({
        series: [
            { data: data },
            { data: data }
        ]
    });
}

function updateMap(stepIndex) {
    if (!geoJsonData || monthlySteps.length === 0) return;

    const currentSliderDate = monthlySteps[stepIndex];
    const visibleFeatures = geoJsonData.features.filter(f => f.properties._timestamp <= currentSliderDate);

    // Update Chart
    updateChart(visibleFeatures);

    // Update Budget Chart & KPI
    updateBudgetChart(stepIndex);

    const visibleIds = new Set();

    // Only show markers if user has interacted (Play or Slider)
    if (hasInteracted) {
        visibleFeatures.forEach(feature => {
            const id = feature.properties.id || feature.properties._uniqueId;
            visibleIds.add(id);

            // If not currently active, add it (New Marker)
            if (!activeMarkers.has(id)) {
                const marker = createMarker(feature);

                // Add animation class to the path element
                marker.options.className = 'marker-pop-in';

                markersLayer.addLayer(marker);
                activeMarkers.set(id, marker);
            }
        });
    }

    // Remove markers that are no longer visible (User scrolled back)
    for (const [id, marker] of activeMarkers) {
        if (!visibleIds.has(id)) {
            markersLayer.removeLayer(marker);
            activeMarkers.delete(id);
        }
    }

    // Update Date Display
    const dateObj = new Date(currentSliderDate);
    const options = { year: 'numeric', month: 'long' };
    let dateStr = dateObj.toLocaleDateString('es-ES', options);
    dateDisplay.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
}

function togglePlay() {
    isPlaying = !isPlaying;

    if (isPlaying) {
        // First play interaction: Show initial markers immediately
        if (!hasInteracted) {
            hasInteracted = true;
            updateMap(parseInt(slider.value));
        }

        // Change icon to Pause (Filled)
        playBtn.innerHTML = `
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="6" y="4" width="4" height="16" fill="currentColor"></rect>
                <rect x="14" y="4" width="4" height="16" fill="currentColor"></rect>
            </svg>
        `;

        playInterval = setInterval(() => {
            let currentValue = parseInt(slider.value);
            if (currentValue < monthlySteps.length - 1) {
                currentValue++;
                slider.value = currentValue;
                updateMap(currentValue);
            } else {
                // Stop at end
                togglePlay();
            }
        }, PLAY_SPEED_MS);

    } else {
        // Change icon to Play (Filled)
        playBtn.innerHTML = `
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="none" xmlns="http://www.w3.org/2000/svg">
                <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"></polygon>
            </svg>
        `;
        clearInterval(playInterval);
    }
}

// Helper to parse exec.csv dates "DD/MM/YYYY HH:mm"
function parseExecDate(dateStr) {
    if (!dateStr) return null;
    const [d, t] = dateStr.split(' ');
    const parts = d.split('/');
    if (parts.length !== 3) return null;
    return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
}

// Convert "123.456,78" to 123456.78
function parseEuroAmount(amountStr) {
    if (!amountStr) return 0;
    // Remove thousand separators (.) and replace decimal comma (,) with dot (.)
    const clean = amountStr.replace(/\./g, '').replace(',', '.');
    return parseFloat(clean);
}

// Load Data (Parallel)
// Load Data (Parallel) - Now including Basemap files
Promise.all([
    fetch(CONFIG.dataFile).then(r => r.json()),
    fetch(CONFIG.execFile).then(r => r.text()),
    fetch(CONFIG.spainFile).then(r => r.json())
]).then(([geoData, execCsvObj, spainData]) => {
    console.log("Datos y Mapa Base cargados.");

    // 1. Setup Basemap Layers

    // Spain Silhouette (Polygon)
    // Fill: Transparent, Border: White
    L.geoJSON(spainData, {
        style: {
            color: '#FFFFFF',
            weight: 3, // Increased thickness
            fillColor: 'transparent',
            fillOpacity: 0,
            className: 'map-animate-enter' // Add entrance animation
        },
        pane: 'basemapPane',
        interactive: false // No popups/clicks on bg
    }).addTo(map);

    // RFIG Layer Removed as per user request

    // 2. Process Execution Data
    const execRows = execCsvObj.trim().split('\n');
    const execData = []; // [{ date: timestamp, amount: number }]

    // Skip header (i=1)
    for (let i = 1; i < execRows.length; i++) {
        const row = execRows[i].trim();
        if (!row) continue;
        const [dateRaw, amountRaw] = row.split(';');
        const ms = parseExecDate(dateRaw);
        const amt = parseEuroAmount(amountRaw);

        if (ms && !isNaN(amt)) {
            execData.push({ date: ms, amount: amt });
        }
    }
    // Sort execution data by date
    execData.sort((a, b) => a.date - b.date);

    initApp(geoData, execData);

}).catch(error => {
    console.error("Error cargando datos:", error);
    alert("Error cargando datos. Revisa la consola.");
});
