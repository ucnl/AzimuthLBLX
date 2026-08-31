// haversine.js — Реализация Haversine (прямая и обратная геодезические задачи)
// Портировано с C# Algorithms.HaversineDirect / HaversineInverse

const Haversine = (() => {

    const WGS84_A = 6378137.0;

    function deg2rad(deg) { return deg * Math.PI / 180.0; }
    function rad2deg(rad) { return rad * 180.0 / Math.PI; }

    function wrap2PI(angleRad) {
        let a = angleRad % (2 * Math.PI);
        if (a < 0) a += 2 * Math.PI;
        return a;
    }

    function haversineInverse(lat1, lon1, lat2, lon2, radius) {
        radius = radius || WGS84_A;

        const dLat = lat2 - lat1;
        const dLon = lon2 - lon1;

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1) * Math.cos(lat2) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return radius * c;
    }

    function haversineDirect(latRad, lonRad, distM, azmRad, radius) {
        radius = radius || WGS84_A;

        const delta = distM / radius;

        const ep_lat = Math.asin(
            Math.sin(latRad) * Math.cos(delta) +
            Math.cos(latRad) * Math.sin(delta) * Math.cos(azmRad)
        );

        const ep_lon = wrap2PI(
            3 * Math.PI + (
                lonRad + Math.atan2(
                    Math.sin(azmRad) * Math.sin(delta) * Math.cos(latRad),
                    Math.cos(delta) - Math.sin(latRad) * Math.sin(ep_lat)
                )
            )
        ) - Math.PI;

        return {
            lat: ep_lat,
            lon: ep_lon,
        };
    }

    function haversineInitialBearing(lat1, lon1, lat2, lon2) {
        const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) -
                  Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
        return wrap2PI(Math.PI + Math.atan2(y, x));
    }

    // Экспорт в глобальную область
    window.haversineInverse = haversineInverse;
    window.haversineDirect = haversineDirect;
    window.haversineInitialBearing = haversineInitialBearing;

    return {
        WGS84_A,
        haversineInverse,
        haversineDirect,
        haversineInitialBearing,
        deg2rad,
        rad2deg,
        wrap2PI,
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Haversine;
}