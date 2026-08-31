// measurements-store.js — Хранение измерений VLBL и трека судна
// Адаптировано из tracks.js (AzimuthWebSuite)

const MeasurementsStore = (() => {

    // ========== ХРАНИЛИЩЕ ==========
    let stationTrack = [];       // [{lat, lon, ts}] — трек судна
    let measurements = {};       // { [beaconAddress]: VLBLMeasurementsClass }
    let solutions = {};          // { [beaconAddress]: { best: {...}, history: [...] } }
    let solutionsHistory = {};   // { [beaconAddress]: [{...}, {...}, ...] }

    const MAX_STATION_POINTS = 50000;
    const MAX_MEASUREMENTS_PER_BEACON = 200;
    const BASE_SIZE = 4;
    const MAX_HISTORY_PER_BEACON = 100;

    // ========== НАСТРОЙКИ ==========
    let settings = {
        maxMeasurementsPerBeacon: 200,
        baseSize: 4,
        minStationPointDistanceM: 1.0,
    };

    // ========== СТАНЦИЯ ==========

    function addStationPoint(lat, lon, ts) {
        if (isNaN(lat) || isNaN(lon)) return;

        if (stationTrack.length > 0 && settings.minStationPointDistanceM > 0) {
            const last = stationTrack[stationTrack.length - 1];
            const dist = haversineDistance(last.lat, last.lon, lat, lon);
            if (dist < settings.minStationPointDistanceM) return;
        }

        stationTrack.push({ lat, lon, ts: ts || Date.now() });
        while (stationTrack.length > MAX_STATION_POINTS) stationTrack.shift();
    }

    function clearStationTrack() {
        stationTrack = [];
    }

    function getStationTrack() {
        return stationTrack;
    }

    // ========== ИЗМЕРЕНИЯ ==========

    function addMeasurement(addr, lat, lon, antennaDepthM, beaconDepthM, rangeM, ts) {
        if (isNaN(lat) || isNaN(lon) || isNaN(rangeM) || rangeM <= 0) return;

        if (!measurements[addr]) {
            measurements[addr] = VLBLMeasurements.create(
                settings.maxMeasurementsPerBeacon,
                settings.baseSize
            );
        }

        measurements[addr].add({
            lat,
            lon,
            depth: antennaDepthM || 0,
            range: rangeM,
            beaconDepth: beaconDepthM,
            ts: ts || Date.now(),
        });
    }

    function clearMeasurements(addr) {
        if (addr !== undefined) {
            if (measurements[addr]) {
                measurements[addr].clear();
            }
        } else {
            measurements = {};
        }
    }

    function clearAll() {
        stationTrack = [];
        measurements = {};
        solutions = {};
        solutionsHistory = {};
        try {
            localStorage.removeItem('lblx_beacons_history');
        } catch (e) {}
    }

    function getMeasurements(addr) {
        return measurements[addr] || null;
    }

    function getAllMeasurements() {
        return measurements;
    }

    function getMeasurementCount(addr) {
        return measurements[addr] ? measurements[addr].count : 0;
    }

    // ========== РЕШЕНИЯ ==========
    
	/*
		1. HDOP > 50 — решение отбрасывается полностью
		2. Сортировка по качеству:
		   - Good — лучше всего
		   - Fair — хорошо
		   - Poor — приемлемо
           - Out_of_base — плохо
		3. При одинаковом качестве — по DRMS + HDOP * 0.05
           - DRMS = 2 м, HDOP = 1 → score = 2.05
           - DRMS = 3 м, HDOP = 0.5 → score = 3.025
		   - Выбирается первое (2.05)
    */
	function setSolution(addr, solution) {
		// Отбрасываем решения без HDOP или с критически плохим HDOP
		if (isNaN(solution.hdop) || solution.hdop > 50) {
			console.warn(`[Measurements] Маяк #${addr + 1}: HDOP ${isNaN(solution.hdop) ? 'NaN' : solution.hdop.toFixed(1)} — решение отброшено`);
			return;
		}

		if (!solutionsHistory[addr]) {
			solutionsHistory[addr] = [];
		}

		solution.ts = Date.now();
		solutionsHistory[addr].push(solution);

		// Обрезаем историю
		if (solutionsHistory[addr].length > MAX_HISTORY_PER_BEACON) {
			solutionsHistory[addr].shift();
		}

		// Сортируем: сначала по качеству, потом по взвешенному DRMS+HDOP
		solutionsHistory[addr].sort((a, b) => {
			const qualityOrder = { 'Good': 0, 'Fair': 1, 'Poor': 2, 'Out_of_base': 3 };
			const qa = qualityOrder[a.quality] ?? 4;
			const qb = qualityOrder[b.quality] ?? 4;
			
			if (qa !== qb) return qa - qb;
			
			const aDRMS = isNaN(a.radialError) ? Infinity : a.radialError;
			const bDRMS = isNaN(b.radialError) ? Infinity : b.radialError;
			const aHDOP = isNaN(a.hdop) ? 0 : a.hdop;
			const bHDOP = isNaN(b.hdop) ? 0 : b.hdop;
			
			// Взвешенный критерий: DRMS + 5% от HDOP
			const aScore = aDRMS + aHDOP * 0.05;
			const bScore = bDRMS + bHDOP * 0.05;
			
			return aScore - bScore;
		});

		solutions[addr] = solutionsHistory[addr][0];
	}

    function getSolution(addr) {
        return solutions[addr] || null;
    }

    function getAllSolutions() {
        return solutions;
    }

    function getSolutionsHistory(addr) {
        return solutionsHistory[addr] || [];
    }

    function getBestSolution(addr) {
        return solutions[addr] || null;
    }

    function clearSolution(addr) {
        if (addr !== undefined) {
            delete solutions[addr];
            delete solutionsHistory[addr];
        } else {
            solutions = {};
            solutionsHistory = {};
        }
    }

    function clearSolutionsHistory(addr) {
        if (addr !== undefined) {
            delete solutionsHistory[addr];
            if (solutions[addr]) delete solutions[addr];
        } else {
            solutionsHistory = {};
            solutions = {};
        }
    }

    // ========== СОХРАНЕНИЕ В STORAGE ==========

    function saveSolutionsToStorage() {
        try {
            const data = {};
            for (const addr in solutionsHistory) {
                data[addr] = solutionsHistory[addr].map(s => ({
                    latDeg: s.latDeg,
                    lonDeg: s.lonDeg,
                    depthM: s.depthM,
                    radialError: s.radialError,
                    hdop: s.hdop,
                    pdop: s.pdop,
                    gdop: s.gdop,
                    vdop: s.vdop,
                    tdop: s.tdop,
                    quality: s.quality,
                    maxAngularGap: s.maxAngularGap,
                    itCnt: s.itCnt,
                    ts: s.ts,
                }));
            }
            localStorage.setItem('lblx_beacons_history', JSON.stringify(data));
        } catch (e) {
            console.warn('Не удалось сохранить базу маяков:', e);
        }
    }

    function loadSolutionsFromStorage() {
        try {
            const saved = localStorage.getItem('lblx_beacons_history');
            if (saved) {
                const data = JSON.parse(saved);
                for (const addr in data) {
                    solutionsHistory[addr] = data[addr];
                    if (solutionsHistory[addr].length > 0) {
                        solutions[addr] = solutionsHistory[addr][0];
                    }
                }
                return true;
            }
        } catch (e) {
            console.warn('Не удалось загрузить базу маяков:', e);
        }
        return false;
    }

    // ========== НАСТРОЙКИ ==========

    function setMaxMeasurementsPerBeacon(n) {
        settings.maxMeasurementsPerBeacon = Math.max(10, Math.min(1000, n));
    }

    function setBaseSize(n) {
        settings.baseSize = Math.max(3, Math.min(20, n));
    }

    function setMinStationPointDistance(m) {
        settings.minStationPointDistanceM = Math.max(0, Math.min(100, m));
    }

    function getSettings() {
        return { ...settings };
    }

    // ========== ВСПОМОГАТЕЛЬНОЕ ==========

    function haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const phi1 = lat1 * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const dPhi = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // ========== ЭКСПОРТ ==========

    return {
        addStationPoint,
        clearStationTrack,
        getStationTrack,
        addMeasurement,
        clearMeasurements,
        clearAll,
        getMeasurements,
        getAllMeasurements,
        getMeasurementCount,
        setSolution,
        getSolution,
        getAllSolutions,
        getSolutionsHistory,
        getBestSolution,
        clearSolution,
        clearSolutionsHistory,
        setMaxMeasurementsPerBeacon,
        setBaseSize,
        setMinStationPointDistance,
        getSettings,
        get stationTrack() { return stationTrack; },
        get measurements() { return measurements; },
        get solutions() { return solutions; },
        get MAX_MEASUREMENTS_PER_BEACON() { return MAX_MEASUREMENTS_PER_BEACON; },
        get BASE_SIZE() { return BASE_SIZE; },
        saveSolutionsToStorage,
        loadSolutionsFromStorage,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MeasurementsStore;
}