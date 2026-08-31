// geo-utils.js — Геодезические вычисления WGS84 (общие функции)

const GeoUtils = (() => {

    const WGS84_A = 6378137.0;
    const WGS84_B = 6356752.314245; // малая полуось
    const E2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_A * WGS84_A); // эксцентриситет

    /**
     * Вычисляет разницу в метрах между двумя географическими точками
     * @param {number} lat1 — широта первой точки, радианы
     * @param {number} lon1 — долгота первой точки, радианы
     * @param {number} lat2 — широта второй точки, радианы
     * @param {number} lon2 — долгота второй точки, радианы
     * @returns {{ deltaLatM: number, deltaLonM: number }}
     */
    function getDeltasByGeopoints_WGS84(lat1, lon1, lat2, lon2) {
        const mlat = (lat1 + lat2) / 2.0;
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2.0 * mlat) + 1.175 * Math.cos(4.0 * mlat);
        const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3.0 * mlat);
        const deltaLatM = (lat1 - lat2) * mPerDegLat * (180.0 / Math.PI);
        const deltaLonM = (lon1 - lon2) * mPerDegLon * (180.0 / Math.PI);
        return { deltaLatM, deltaLonM };
    }

    /**
     * Вычисляет новую географическую точку, смещённую на deltaLatM, deltaLonM
     * @param {number} lat — исходная широта, радианы
     * @param {number} lon — исходная долгота, радианы
     * @param {number} deltaLatM — смещение по широте, метры
     * @param {number} deltaLonM — смещение по долготе, метры
     * @returns {{ lat: number, lon: number }} — радианы
     */
    function geopointOffsetByDeltas_WGS84(lat, lon, deltaLatM, deltaLonM) {
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2.0 * lat) + 1.175 * Math.cos(4.0 * lat);
        const mPerDegLon = 111412.84 * Math.cos(lat) - 93.5 * Math.cos(3.0 * lat);
        const newLat = lat - (Math.PI / 180.0) * deltaLatM / mPerDegLat;
        const newLon = lon - (Math.PI / 180.0) * deltaLonM / mPerDegLon;
        return { lat: newLat, lon: newLon };
    }

    /**
     * Метры на градус широты и долготы для заданной точки
     * @param {number} latRad — широта, радианы
     * @returns {{ mPerDegLat: number, mPerDegLon: number }}
     */
    function metersPerDegree(latRad) {
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2.0 * latRad) + 1.175 * Math.cos(4.0 * latRad);
        const mPerDegLon = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3.0 * latRad);
        return { mPerDegLat, mPerDegLon };
    }

    /**
     * Расстояние между двумя точками (гаверсинус)
     * @param {number} lat1 — градусы
     * @param {number} lon1 — градусы
     * @param {number} lat2 — градусы
     * @param {number} lon2 — градусы
     * @returns {number} расстояние в метрах
     */
    function haversineDistance(lat1, lon1, lat2, lon2) {
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const sinDLat2 = Math.sin(dLat / 2);
        const sinDLon2 = Math.sin(dLon / 2);
        const cosLat1 = Math.cos(lat1 * Math.PI / 180);
        const cosLat2 = Math.cos(lat2 * Math.PI / 180);
        const chord = sinDLat2 * sinDLat2 + cosLat1 * cosLat2 * sinDLon2 * sinDLon2;
        return 2 * WGS84_A * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
    }

    /**
     * Дельты в метрах между двумя точками (градусы на входе)
     * @returns {{ deltaLatM: number, deltaLonM: number }}
     */
    function deltasByDegrees(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
        const mlat = (lat1Deg + lat2Deg) / 2 * Math.PI / 180;
        const mpd = metersPerDegree(mlat);
        return {
            deltaLatM: (lat2Deg - lat1Deg) * mpd.mPerDegLat,
            deltaLonM: (lon2Deg - lon1Deg) * mpd.mPerDegLon
        };
    }

    /**
     * Преобразует географические координаты в экранные (пиксели)
     * @param {number} latDeg — широта точки в градусах
     * @param {number} lonDeg — долгота точки в градусах
     * @param {number} anchorLatDeg — широта якоря (центра карты) в градусах
     * @param {number} anchorLonDeg — долгота якоря в градусах
     * @param {number} offsetX — смещение canvas по X
     * @param {number} offsetY — смещение canvas по Y
     * @param {number} scale — масштаб (пикселей на метр)
     * @returns {{ x: number, y: number }} — координаты в пикселях
     */
    function geoToScreen(latDeg, lonDeg, anchorLatDeg, anchorLonDeg, offsetX, offsetY, scale) {
        const deltas = deltasByDegrees(anchorLatDeg, anchorLonDeg, latDeg, lonDeg);
        return {
            x: offsetX + deltas.deltaLonM * scale,
            y: offsetY - deltas.deltaLatM * scale
        };
    }

    /**
     * Преобразует экранные координаты (пиксели) в географические
     * @param {number} screenX — X в пикселях
     * @param {number} screenY — Y в пикселях
     * @param {number} anchorLatDeg — широта якоря в градусах
     * @param {number} anchorLonDeg — долгота якоря в градусах
     * @param {number} offsetX — смещение canvas по X
     * @param {number} offsetY — смещение canvas по Y
     * @param {number} scale — масштаб (пикселей на метр)
     * @returns {{ lat: number, lon: number }} — координаты в градусах
     */
    function screenToGeo(screenX, screenY, anchorLatDeg, anchorLonDeg, offsetX, offsetY, scale) {
        const deltaLonM = (screenX - offsetX) / scale;
        const deltaLatM = (offsetY - screenY) / scale;
        
        const anchorLatRad = anchorLatDeg * Math.PI / 180;
        const mpd = metersPerDegree(anchorLatRad);
        
        const lat = anchorLatDeg + deltaLatM / mpd.mPerDegLat;
        const lon = anchorLonDeg + deltaLonM / mpd.mPerDegLon;
        
        return { lat, lon };
    }

    /**
     * Радиус кривизны меридиана (для точных расчётов)
     * @param {number} latRad — широта в радианах
     * @returns {number}
     */
    function meridianRadius(latRad) {
        const sinLat = Math.sin(latRad);
        return WGS84_A * (1 - E2) / Math.pow(1 - E2 * sinLat * sinLat, 1.5);
    }

    /**
     * Радиус кривизны первого вертикала (для точных расчётов)
     * @param {number} latRad — широта в радианах
     * @returns {number}
     */
    function primeVerticalRadius(latRad) {
        const sinLat = Math.sin(latRad);
        return WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
    }

	/**
	 * Вычисляет DRMS и связанные статистики для массива точек в локальной системе координат
	 * @param {Array<{x: number, y: number}>} points — массив точек {x, y} в метрах
	 * @returns {{ drms: number, drms2: number, drms3: number, sigmaX: number, sigmaY: number, centroid: {x: number, y: number}, count: number } | null}
	 */
	function calcDRMS(points) {
		if (!points || points.length < 3) return null;
		
		const n = points.length;
		
		// Центроид (среднее арифметическое)
		let cx = 0, cy = 0;
		for (const p of points) {
			cx += p.x;
			cy += p.y;
		}
		cx /= n;
		cy /= n;
		
		// Стандартные отклонения
		let sx2 = 0, sy2 = 0;
		for (const p of points) {
			sx2 += (p.x - cx) ** 2;
			sy2 += (p.y - cy) ** 2;
		}
		
		const sigmaX = Math.sqrt(sx2 / n);
		const sigmaY = Math.sqrt(sy2 / n);
		
		// DRMS = sqrt(σx² + σy²)
		const drms = Math.sqrt(sigmaX * sigmaX + sigmaY * sigmaY);
		
		return {
			drms: drms,
			drms2: 2 * drms,
			drms3: 3 * drms,
			sigmaX: sigmaX,
			sigmaY: sigmaY,
			centroid: { x: cx, y: cy },
			count: n
		};
	}



    return {
        WGS84_A,
        getDeltasByGeopoints_WGS84,
        geopointOffsetByDeltas_WGS84,
        metersPerDegree,
        haversineDistance,
        deltasByDegrees,
        geoToScreen,
        screenToGeo,
        meridianRadius,
        primeVerticalRadius,
		calcDRMS
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeoUtils;
}