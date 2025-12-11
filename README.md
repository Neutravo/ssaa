# Visor Cartográfico Diacrónico - SSAA
Evolución de expedientes de gasto

Este proyecto es un visor de mapas web diseñado para visualizar la evolución temporal de datos espaciales (puntos).

## Características

- **Mapa Base**: CartoDB Dark Matter (vía Leaflet).
- **Datos**: Generación automática de puntos aleatorios en España con fechas asignadas (simulando un SHP/GeoJSON).
- **Interactividad**: Slider temporal para filtrar los puntos acumulativamente.
- **Diseño**: Interfaz moderna con modo oscuro y efectos de vidrio (Glassmorphism).

## Cómo usar

1. Simplemente abre el archivo `index.html` en tu navegador web moderno favorito (Chrome, Firefox, Edge).
2. Usa el slider en la parte inferior para ver cómo aparecen los puntos en el mapa según avanza el tiempo.

## Personalización

- Para usar tus propios datos, reemplaza la función `generateData()` en `script.js` para cargar tu archivo GeoJSON o SHP convertido.
- Puedes ajustar el rango de fechas en la configuración `CONFIG` dentro de `script.js`.
