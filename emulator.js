// modules/emulator.js — Эмулятор движения судна и измерений VLBL
// Генерирует синтетические данные для отладки без реального оборудования

const Emulator = (() => {
    let isActive = false;
    let timerId = null;
    let angle = 0;

    // Параметры эмуляции
	const config = {
		centerLat: 54.700000,
		centerLon: 20.300000,
		semiMajorAxis: 200,   // было 120 — увеличь
		semiMinorAxis: 120,   // было 60 — увеличь
		angularSpeed: 0.25,
		antennaDepth: 0.5,
		noiseRange: 0.5,
		noiseDepth: 0.05,
		noiseGNSS: 2.5,
		noiseBeaconDepth: 0.3,
		noiseCorrelation: 0.7,
		intervalMs: 500,
		beacons: [
			{ addr: 0, lat: 54.700200, lon: 20.300300, depth: 25 },  // внутри
			{ addr: 1, lat: 54.699800, lon: 20.299700, depth: 18 },  // внутри
		],
	};

    // Колбэки
    let onUpdate = null;      // вызывается после каждого шага

    function init(callbacks) {
        if (callbacks) {
            onUpdate = callbacks.onUpdate;
        }
    }

    function start() {
        if (timerId) return;
        isActive = true;
        angle = 0;

        // Добавляем виртуальные маяки в VLBLManager
        for (const beaconConfig of config.beacons) {
            const existing = VLBLManager.getBeacons()[beaconConfig.addr];
            if (!existing) {
                VLBLManager.getBeacons()[beaconConfig.addr] = {
                    address: beaconConfig.addr,
                    userAddress: beaconConfig.addr + 1,
                    depthM: beaconConfig.depth,
                    msrDB: 25 + Math.random() * 5,
                    vccV: 12.5,
                    waterTempC: 10 + Math.random() * 5,
                    isTimeout: false,
                    dataAge: 0,
                    slantRangeM: NaN,
                    slantRangeProjectionM: NaN,
                    propTimeS: NaN,
                    succeededRequests: 0,
                    timeouts: 0,
                    lastNDTA: null,
                };
            }
        }

        timerId = setInterval(step, config.intervalMs);
    }

    function stop() {
        isActive = false;
        if (timerId) {
            clearInterval(timerId);
            timerId = null;
        }
    }

    function toggle() {
        if (isActive) stop(); else start();
        return isActive;
    }

    function isRunning() {
        return isActive;
    }

    function step() {
        if (!isActive) return;

        angle += config.angularSpeed;

        // Позиция судна на эллипсе
        // Угол поворота эллипса (30°) для более реалистичной траектории
        const ellipseAngle = 30 * Math.PI / 180;
        const cosE = Math.cos(ellipseAngle);
        const sinE = Math.sin(ellipseAngle);
        
        // Координаты на эллипсе (до поворота)
        const ex = config.semiMajorAxis * Math.cos(angle);
        const ey = config.semiMinorAxis * Math.sin(angle);
        
        // Поворот эллипса
        const rotatedX = ex * cosE - ey * sinE;
        const rotatedY = ex * sinE + ey * cosE;
        
        // Переводим метры в градусы
        const baseLat = config.centerLat + (rotatedY / 111320);
        const baseLon = config.centerLon + (rotatedX / (111320 * Math.cos(config.centerLat * Math.PI / 180)));

        // Добавляем шум GNSS (2-4 метра)
        const gnssLatOffset = (Math.random() - 0.5) * config.noiseGNSS * 2 / 111320;
        const gnssLonOffset = (Math.random() - 0.5) * config.noiseGNSS * 2 / (111320 * Math.cos(baseLat * Math.PI / 180));
        const lat = baseLat + gnssLatOffset;
        const lon = baseLon + gnssLonOffset;

        // Обновляем состояние VLBLManager
        const st = VLBLManager.getState();
        st.currentLat = lat;
        st.currentLon = lon;
        st.antennaDepthM = config.antennaDepth + (Math.random() - 0.5) * config.noiseDepth;
        st.waterTempC = 12 + Math.random();

        // Добавляем точку в трек судна
        MeasurementsStore.addStationPoint(lat, lon, new Date());

        // Генерируем измерения для каждого маяка
        for (const beaconConfig of config.beacons) {
            const dist = haversineDistance(lat, lon, beaconConfig.lat, beaconConfig.lon);
            const noisyBeaconDepth = beaconConfig.depth + (Math.random() - 0.5) * config.noiseBeaconDepth * 2;
            const depthDiff = Math.abs(noisyBeaconDepth - st.antennaDepthM);
            const slantRange = Math.sqrt(dist * dist + depthDiff * depthDiff);
            const noisyRange = slantRange + (Math.random() - 0.5) * config.noiseRange * 2;

            MeasurementsStore.addMeasurement(
                beaconConfig.addr,
                lat, lon,
                st.antennaDepthM,
                noisyBeaconDepth,
                noisyRange,
                new Date()
            );

            // Обновляем маяк
            const beacon = VLBLManager.getBeacons()[beaconConfig.addr];
            if (beacon) {
                beacon.slantRangeM = noisyRange;
                beacon.slantRangeProjectionM = dist;
                beacon.propTimeS = noisyRange / 1480;
                beacon.isTimeout = false;
                beacon.dataAge = 0;
                beacon.succeededRequests++;
            }
        }

        // Вызываем колбек
        if (onUpdate) {
            onUpdate({
                lat,
                lon,
                antennaDepthM: st.antennaDepthM,
                beacons: config.beacons.map(b => {
                    const beacon = VLBLManager.getBeacons()[b.addr];
                    return {
                        addr: b.addr,
                        range: beacon ? beacon.slantRangeM : NaN,
                    };
                }),
            });
        }
    }

    function haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const phi1 = lat1 * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const dPhi = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dPhi/2) * Math.sin(dPhi/2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    return {
        init,
        start,
        stop,
        toggle,
        isRunning,
        getConfig: () => ({ ...config }),
        setConfig: (newConfig) => {
            Object.assign(config, newConfig);
        },
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Emulator;
}