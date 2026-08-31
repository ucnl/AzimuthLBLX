// modules/ui-vlbl.js — Панель управления VLBL
// Отображение маяков, измерений и решений

const UIVLBL = (() => {
    let beaconsBar = null;
    let setStatusCallback = null;

    function init(containerId, callbacks) {
        beaconsBar = document.getElementById(containerId);
        if (callbacks) {
            setStatusCallback = callbacks.setStatus;
        }
    }

    function setStatus(msg) {
        if (setStatusCallback) setStatusCallback(msg);
    }

    // ========== ОБНОВЛЕНИЕ ПАНЕЛИ ==========

    function updateBeaconsBar() {
        if (!beaconsBar) return;

        const beacons = VLBLManager.getBeaconsArray();
        if (!beacons || beacons.length === 0) {
            beaconsBar.classList.add('empty');
            beaconsBar.innerHTML = '';
            return;
        }
        beaconsBar.classList.remove('empty');

        let html = '';
        beacons.forEach(b => {
            const age = b.dataAge || 0;
            const ageClass = age > 20 ? 'stale' : age > 10 ? 'old' : 'fresh';
            const cardClass = b.isTimeout ? 'timeout' : '';

            const userAddr = b.userAddress || b.address + 1;
            const range = !isNaN(b.slantRangeProjectionM) && b.slantRangeProjectionM > 0
                ? b.slantRangeProjectionM.toFixed(1) + ' м'
                : !isNaN(b.slantRangeM) && b.slantRangeM > 0
                    ? b.slantRangeM.toFixed(1) + ' м'
                    : '--';
            const depth = !isNaN(b.depthM) ? b.depthM.toFixed(1) + ' м' : '--';
            const msr = !isNaN(b.msrDB) ? b.msrDB.toFixed(1) + ' dB' : '--';
            const vcc = !isNaN(b.vccV) ? b.vccV.toFixed(1) + ' V' : '--';
            const temp = !isNaN(b.waterTempC) ? b.waterTempC.toFixed(1) + ' °C' : '--';

            // Количество измерений
            const measCount = MeasurementsStore.getMeasurementCount(b.address);

            // Решение
            const solution = MeasurementsStore.getBestSolution(b.address);
			const historyCount = MeasurementsStore.getSolutionsHistory(b.address).length;

            html += `
            <div class="beacon-card ${cardClass}">
                <div class="bc-addr" onclick="App.onBeaconCardClick(${b.address})">#${userAddr}</div>
                <div class="bc-range">📏 ${range} 🌊 ${depth}</div>
                <div class="bc-msr">📶 ${msr}</div>
                <div class="bc-vcc">🔋 ${vcc} 🌡 ${temp}</div>
                <div class="bc-measurements">📊 Измерений: ${measCount}</div>
                ${solution ? `
				<div class="bc-solution" style="color:var(--text-accent);font-size:10px;">
					✓ Решение: ${solution.latDeg.toFixed(6)}, ${solution.lonDeg.toFixed(6)}
					<br>DRMS: ${solution.radialError?.toFixed(2) || '--'} м
					<br>Решений: ${historyCount}
					<br>HDOP: ${solution.hdop?.toFixed(2) || '--'}
					<br>Quality: ${solution.quality || '--'}
				</div>` : ''}
                <div class="bc-age ${ageClass}">⏱ ${age.toFixed(0)}с${b.isTimeout ? ' ⌛' : ''}</div>
            </div>`;
        });
        beaconsBar.innerHTML = html;
    }

    // ========== ПРОГРЕСС ИЗМЕРЕНИЙ ==========

    function getBeaconProgress(addr) {
        const count = MeasurementsStore.getMeasurementCount(addr);
        const minRequired = MeasurementsStore.BASE_SIZE + 1;
        const percent = Math.min(100, (count / minRequired) * 100);
        return { count, minRequired, percent };
    }

    function isReadyToSolve(addr) {
        const measurements = MeasurementsStore.getMeasurements(addr);
        if (!measurements) return false;
        return measurements.isBaseExists;
    }

    // ========== ЭКСПОРТ ==========

    return {
        init,
        updateBeaconsBar,
        getBeaconProgress,
        isReadyToSolve,
        setStatus,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIVLBL;
}