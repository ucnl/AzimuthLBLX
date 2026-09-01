// vlbl-manager.js — Конвейер обработки данных Zima2 для VLBL
// Адаптировано из azm-manager.js (AzimuthWebSuite)
// Без углов, без компаса, без DH-фильтрации — только дальности и глубины

const VLBLManager = (() => {

    // ========== КОНСТАНТЫ ==========
    const DEFAULT_SOUND_SPEED_MPS = 1480.0;
    const DEFAULT_SALINITY_PSU = 0.0;
    const DEFAULT_MAX_DIST_M = 1000.0;
    const DEFAULT_ADDRESS_MASK = 1;

    // ========== СОСТОЯНИЕ ==========
    let state = {
        salinityPSU: DEFAULT_SALINITY_PSU,
        soundSpeedMps: NaN,
        soundSpeedAuto: true,
        maxDistM: DEFAULT_MAX_DIST_M,
        addressMask: DEFAULT_ADDRESS_MASK,
        antennaDepthM: NaN,
        waterTempC: NaN,
        pressureMBar: NaN,
		antennaHeadingDeg: NaN,
        isInterrogationActive: false,
        isDeviceInfoValid: false,
        deviceType: 0,
        serialNumber: '',
        beacons: {},        // { [addr]: { address, depthM, vccV, waterTempC, msrDB, propTimeS } }
        lastUpdateTime: 0,
    };

    let timeProvider = () => new Date();

    // ========== СОСТОЯНИЕ МАЯКА ==========
    function getOrCreateBeacon(address) {
        if (!state.beacons[address]) {
            state.beacons[address] = {
                address,
                userAddress: address + 1,
                slantRangeM: NaN,
                slantRangeProjectionM: NaN,
                depthM: NaN,
                msrDB: NaN,
                propTimeS: NaN,
                vccV: NaN,
                waterTempC: NaN,
                isTimeout: false,
                dataAge: 0,
                succeededRequests: 0,
                timeouts: 0,
                lastNDTA: null,
            };
        }
        return state.beacons[address];
    }

    // ========== ОБРАБОТКА СТАНЦИИ ==========
    function processStationData(ndata) {
        if (!isNaN(ndata.locTempC)) state.waterTempC = ndata.locTempC;
        if (!isNaN(ndata.locPressureMBar)) {
            state.pressureMBar = ndata.locPressureMBar;
            if (!isNaN(state.waterTempC)) {
                const pAtm = 1013.25, rho = 1000.0, g = 9.81;
                state.antennaDepthM = (state.pressureMBar - pAtm) * 100 / (rho * g);
                if (state.antennaDepthM < 0) state.antennaDepthM = 0;
            }
        }

        // Вычисление скорости звука
        if (state.soundSpeedAuto && !isNaN(state.waterTempC) && !isNaN(state.salinityPSU) && state.salinityPSU > 0) {
            state.soundSpeedMps = SoundSpeed.calc(
                state.waterTempC,
                state.salinityPSU,
                state.antennaDepthM || 0
            );
        }

        state.lastUpdateTime = Date.now();
    }

    // ========== ОБРАБОТКА ДАННЫХ МАЯКА ==========
    function processBeaconData(ndata) {
        try {
            // Игнорируем измерения без времени распространения
            if (isNaN(ndata.propTimeS) || ndata.propTimeS <= 0) {
                return null;
            }

            const beacon = getOrCreateBeacon(ndata.address);
            beacon.lastNDTA = ndata;

            if (!isNaN(ndata.msrDB)) beacon.msrDB = ndata.msrDB;
            if (!isNaN(ndata.remoteDepthM)) beacon.depthM = ndata.remoteDepthM;
            if (!isNaN(ndata.propTimeS)) beacon.propTimeS = ndata.propTimeS;
            if (!isNaN(ndata.slantRangeM) && ndata.slantRangeM > 0.001) beacon.slantRangeM = ndata.slantRangeM;
            if (!isNaN(ndata.slantRangeProjectionM) && ndata.slantRangeProjectionM > 0.001) beacon.slantRangeProjectionM = ndata.slantRangeProjectionM;

            // VCC и температура
            if (!isNaN(ndata.reqCode) && !isNaN(ndata.resCode)) {
                const ABS_MAX_VCC_V = 30.0;
                const ABS_MIN_VCC_V = 0.0;
                const ABS_MAX_TEMP_C = 80.0;
                const ABS_MIN_TEMP_C = -10.0;
                const CRANGE = 499;

                if (ndata.reqCode === 1) {
                    beacon.waterTempC = ndata.resCode * (ABS_MAX_TEMP_C - ABS_MIN_TEMP_C) / CRANGE + ABS_MIN_TEMP_C;
                } else if (ndata.reqCode === 2) {
                    beacon.vccV = ndata.resCode * (ABS_MAX_VCC_V - ABS_MIN_VCC_V) / CRANGE + ABS_MIN_VCC_V;
                }
            }

            // Служебный ответ (resCode >= 500) — игнорируем дальность
            if (!isNaN(ndata.resCode) && ndata.resCode >= 500) {
                return beacon;
            }

            beacon.isTimeout = false;
            beacon.succeededRequests++;
            beacon.dataAge = 0;

            // Вычисляем slant range
            const sos = (state.soundSpeedMps > 0) ? state.soundSpeedMps : DEFAULT_SOUND_SPEED_MPS;
            beacon.slantRangeM = beacon.propTimeS * sos;

            // Вычисляем горизонтальную проекцию
            if (!isNaN(state.antennaDepthM) && !isNaN(beacon.depthM)) {
                beacon.slantRangeProjectionM = slantRangeProjection(
                    state.antennaDepthM,
                    beacon.depthM,
                    beacon.slantRangeM
                );
            } else {
                beacon.slantRangeProjectionM = beacon.slantRangeM;
            }

            return beacon;
        } catch (e) {
            console.error('[VLBL Manager] Ошибка:', e.message);
            return null;
        }
    }

    function processBeaconTimeout(address) {
        const beacon = getOrCreateBeacon(address);
        beacon.isTimeout = true;
        beacon.timeouts++;
        return beacon;
    }

    function processNDTA(ndata) {        
		processStationData(ndata);		
        let beacon = null;
        if (ndata.status === 1) {
            beacon = processBeaconData(ndata);
        } else if (ndata.status === 2) {
            beacon = processBeaconTimeout(ndata.address);
        }
        return { stationUpdated: true, beacon };
    }

    // ========== МАТЕМАТИКА ==========
    function slantRangeProjection(dAnt, dBcn, sRange) {
        const dd = Math.abs(dAnt - dBcn);
        return dd < sRange ? Math.sqrt(sRange * sRange - dd * dd) : sRange;
    }

    // ========== ВХОДНЫЕ ДАННЫЕ ==========
    function processParsedMessage(parsed) {
        if (!parsed) return null;
        switch (parsed.type) {
            case 'ndta': {
                const r = processNDTA(parsed);
                return { type: 'ndta_result', stationUpdated: true, beacon: r.beacon, raw: parsed };
            }
            case 'dinfo':
                state.deviceType = parsed.deviceType;
                state.serialNumber = parsed.serialNumber;
                state.isDeviceInfoValid = true;
                return { type: 'dinfo', data: parsed };
            case 'strstp':
                state.isInterrogationActive = (parsed.addrMask !== 0);
                return { type: 'strstp', data: parsed };
            case 'rsts':
                return { type: 'rsts', data: parsed };
            case 'ack':
                return { type: 'ack', data: parsed };
            default:
                return null;
        }
    }

    function processRawLine(rawLine) {
        const parsed = AZMParser.parse(rawLine);		
        return processParsedMessage(parsed);
    }

    // ========== КОМАНДЫ ==========
    function getDINFOCommand() { return AZMParser.buildDINFO_GET(); }
    function getStartCommand() { return AZMParser.buildSTRSTP(state.addressMask, state.salinityPSU, state.soundSpeedMps, state.maxDistM); }
    function getStopCommand() { return AZMParser.buildBaseStop(); }

    // ========== НАСТРОЙКИ ==========
    function setSalinity(psu) { state.salinityPSU = psu; }
    function setMaxDistance(m) { state.maxDistM = m; }
    function setSoundSpeed(mps) { state.soundSpeedMps = mps; }
    function setSoundSpeedAuto(auto) { state.soundSpeedAuto = !!auto; }
    function setAddressMask(mask) { state.addressMask = mask; }

    function recalcAllBeacons() {
        for (const addr in state.beacons) {
            if (state.beacons[addr].lastNDTA) processBeaconData(state.beacons[addr].lastNDTA);
        }
    }

    function tickAge() {
        for (const addr in state.beacons) state.beacons[addr].dataAge++;
    }

    function getState() { return state; }
    function getBeacons() { return state.beacons; }
    function getBeaconsArray() { return Object.values(state.beacons); }

    function reset() {
        for (const addr in state.beacons) delete state.beacons[addr];
        state.lastUpdateTime = 0;
    }

    // ========== ЭКСПОРТ ==========
    return {
        processRawLine,
        processParsedMessage,
        processNDTA,
        getDINFOCommand,
        getStartCommand,
        getStopCommand,
        setSalinity,
        setMaxDistance,
        setSoundSpeed,
        setSoundSpeedAuto,
        setAddressMask,
        recalcAllBeacons,
        getState,
        getBeacons,
        getBeaconsArray,
        tickAge,
        reset,
        DEFAULT_SOUND_SPEED_MPS,
        setTimeProvider: (fn) => { timeProvider = fn; },
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VLBLManager;