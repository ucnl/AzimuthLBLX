// modules/ui-canvas.js — Отрисовка карты: трек судна, точки измерений, базовые точки, решения

const UICanvas = (() => {
    let canvas, ctx;
    let mapContainer;

    // Состояние карты
    let scale = 100;  // пикселей на метр
    let offsetX = 0, offsetY = 0;
    let isDragging = false;
    let autoScaleEnabled = true;

    // Слежение
    let followTarget = null;
    let lastUserActionTime = 0;

    // Колбэки
    let getThemes = null;
    let setStatus = null;
	
	let lastAutoScaleTime = 0;

    function init(canvasEl, containerEl, callbacks) {
        canvas = canvasEl;
        ctx = canvas.getContext('2d');
        mapContainer = containerEl;

        if (callbacks) {
            getThemes = callbacks.getThemes;
            setStatus = callbacks.setStatus;
        }

        resizeCanvas();
        window.addEventListener('resize', () => resizeCanvas());
    }

	function resizeCanvas() {
		const w = mapContainer.clientWidth;
		const h = mapContainer.clientHeight;
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
			
			if (offsetX === 0 && offsetY === 0) {
				offsetX = w / 2;
				offsetY = h / 2;
			}
		}
	}

    function getScale() { return scale; }
    function setScale(newScale) { scale = Math.min(Math.max(newScale, 0.01), 10000); }
    function getOffset() { return { x: offsetX, y: offsetY }; }
    function setOffset(x, y) { offsetX = x; offsetY = y; }
    function isAutoScaleEnabled() { return autoScaleEnabled; }
    function setAutoScaleEnabled(enabled) { autoScaleEnabled = enabled; }
    function isDraggingEnabled() { return isDragging; }
    function setDraggingEnabled(enabled) { isDragging = enabled; }

    function getCanvasColors() {
        const Themes = getThemes ? getThemes() : null;
        if (Themes) return Themes.getCanvasColors();

        const rootStyles = getComputedStyle(document.documentElement);
        return {
            text: rootStyles.getPropertyValue('--map-text').trim() || '#ffffff',
            textSecondary: rootStyles.getPropertyValue('--map-text-secondary').trim() || 'rgba(255,255,255,0.8)',
            stroke: rootStyles.getPropertyValue('--map-stroke').trim() || '#ffffff'
        };
    }

    // ========== КОНВЕРТАЦИЯ КООРДИНАТ ==========

    function geoToScreen(latDeg, lonDeg, anchorLatDeg, anchorLonDeg) {
        const deltas = GeoUtils.deltasByDegrees(anchorLatDeg, anchorLonDeg, latDeg, lonDeg);
        return {
            x: offsetX + deltas.deltaLonM * scale,
            y: offsetY - deltas.deltaLatM * scale
        };
    }

    // ========== ОТРИСОВКА СЕТКИ ==========

    function drawGrid() {
        const rootStyles = getComputedStyle(document.documentElement);
        let gridColor = rootStyles.getPropertyValue('--map-grid').trim();
        let axisColor = rootStyles.getPropertyValue('--map-axis').trim();

        if (!gridColor) gridColor = 'rgba(255, 255, 255, 0.06)';
        if (!axisColor) axisColor = 'rgba(255, 255, 255, 0.2)';

        const gridSizePx = 50;
        const gridSizeM = gridSizePx / scale;

        let cx = offsetX, cy = offsetY;

        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;

        const startX = ((cx % gridSizePx) + gridSizePx) % gridSizePx;
        for (let x = startX; x < canvas.width; x += gridSizePx) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        }
        const startY = ((cy % gridSizePx) + gridSizePx) % gridSizePx;
        for (let y = startY; y < canvas.height; y += gridSizePx) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
        }

        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy); ctx.stroke();
    }

    // ========== ОТРИСОВКА ТРЕКА СУДНА ==========

    function drawStationTrack() {
        const track = MeasurementsStore.stationTrack;
        if (track.length < 2) return;

        const cc = getCanvasColors();
        const anchor = track[0];

        ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();

        let first = true;
        for (const p of track) {
            const s = geoToScreen(p.lat, p.lon, anchor.lat, anchor.lon);
            if (first) { ctx.moveTo(s.x, s.y); first = false; }
            else { ctx.lineTo(s.x, s.y); }
        }
        ctx.stroke();

        // Конечная точка судна
        const last = track[track.length - 1];
        const ls = geoToScreen(last.lat, last.lon, anchor.lat, anchor.lon);
        ctx.fillStyle = '#00ffff';
        ctx.beginPath();
        ctx.arc(ls.x, ls.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = cc.stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // ========== ОТРИСОВКА ИЗМЕРЕНИЙ ==========

    function drawMeasurements() {
        const allMeasurements = MeasurementsStore.getAllMeasurements();
        const anchor = MeasurementsStore.stationTrack.length > 0 ? MeasurementsStore.stationTrack[0] : { lat: NaN, lon: NaN };

        for (const addr in allMeasurements) {
            const hue = (parseInt(addr) * 60) % 360;
            const items = allMeasurements[addr].getAll();

            for (const m of items) {
                if (isNaN(anchor.lat)) continue;
                const s = geoToScreen(m.lat, m.lon, anchor.lat, anchor.lon);

                // Кружок измерения
                ctx.fillStyle = `hsla(${hue}, 80%, 55%, 0.5)`;
                ctx.beginPath();
                ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }

            // Базовые точки (если есть)
            try {
                if (allMeasurements[addr].isBaseExists) {
                    const base = allMeasurements[addr].getBase();
                    for (const bp of base) {
                        const s = geoToScreen(bp.lat, bp.lon, anchor.lat, anchor.lon);
                        // Звезда (квадрат) для базовых точек
                        ctx.strokeStyle = `hsla(${hue}, 100%, 65%, 0.9)`;
                        ctx.lineWidth = 2;
                        const size = 5;
                        ctx.beginPath();
                        ctx.moveTo(s.x - size, s.y - size);
                        ctx.lineTo(s.x + size, s.y - size);
                        ctx.lineTo(s.x + size, s.y + size);
                        ctx.lineTo(s.x - size, s.y + size);
                        ctx.closePath();
                        ctx.stroke();
                    }
                }
            } catch (e) {
                // База не существует
            }
        }
    }

    // ========== ОТРИСОВКА РЕШЕНИЙ ==========

    function drawSolutions() {
        const solutions = MeasurementsStore.getAllSolutions();
        const anchor = MeasurementsStore.stationTrack.length > 0 ? MeasurementsStore.stationTrack[0] : { lat: NaN, lon: NaN };
        const cc = getCanvasColors();

        for (const addr in solutions) {
            const s = solutions[addr];
            if (isNaN(anchor.lat)) continue;
            const screen = geoToScreen(s.latDeg, s.lonDeg, anchor.lat, anchor.lon);

            // Кружок DRMS
            if (!isNaN(s.radialError) && s.radialError > 0) {
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, s.radialError * scale, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Маркер решения (красный круг)
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Подпись: номер маяка
            const userAddr = parseInt(addr) + 1;
            ctx.fillStyle = cc.text;
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('#' + userAddr, screen.x, screen.y - 14);
        }

		// Отрисовка истинных позиций маяков (если эмуляция активна)
		if (typeof Emulator !== 'undefined' && Emulator.isRunning()) {
			const emuConfig = Emulator.getConfig();
			const anchor = MeasurementsStore.stationTrack.length > 0 ? MeasurementsStore.stationTrack[0] : { lat: NaN, lon: NaN };
			
			for (const b of emuConfig.beacons) {
				if (isNaN(anchor.lat)) continue;
				const screen = geoToScreen(b.lat, b.lon, anchor.lat, anchor.lon);
				
				// Зелёный крестик — истинная позиция
				ctx.strokeStyle = 'rgba(0, 255, 0, 0.7)';
				ctx.lineWidth = 2;
				const size = 7;
				ctx.beginPath();
				ctx.moveTo(screen.x - size, screen.y - size);
				ctx.lineTo(screen.x + size, screen.y + size);
				ctx.moveTo(screen.x + size, screen.y - size);
				ctx.lineTo(screen.x - size, screen.y + size);
				ctx.stroke();
				
				// Подпись
				ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
				ctx.font = '10px Arial';
				ctx.textAlign = 'left';
				ctx.fillText('true #' + (b.addr + 1), screen.x + 10, screen.y - 10);
			}
		}
    }

    // ========== ЛИНЕЙКА МАСШТАБА ==========

	function drawPOI() {
		if (typeof POIManager === 'undefined') return; 
		const points = POIManager.getAll();
		if (points.length === 0) return;
		
		let anchor;
		if (MeasurementsStore.stationTrack.length > 0) {
			anchor = MeasurementsStore.stationTrack[0];
		} else if (points.length > 0) {
			anchor = { lat: points[0].lat, lon: points[0].lon };
		} else {
			return;
		}
		
		for (const poi of points) {
			if (isNaN(anchor.lat)) continue;
			const screen = geoToScreen(poi.lat, poi.lon, anchor.lat, anchor.lon);
			
			// Оранжевый треугольник для POI
			ctx.fillStyle = '#ff8800';
			ctx.beginPath();
			ctx.moveTo(screen.x, screen.y - 8);
			ctx.lineTo(screen.x + 7, screen.y + 5);
			ctx.lineTo(screen.x - 7, screen.y + 5);
			ctx.closePath();
			ctx.fill();
			ctx.strokeStyle = '#ffffff';
			ctx.lineWidth = 1.5;
			ctx.stroke();
			
			// Подпись
			ctx.fillStyle = '#ffffff';
			ctx.font = '10px Arial';
			ctx.textAlign = 'center';
			ctx.fillText(poi.name, screen.x, screen.y + 18);
		}
	}

    function drawScaleBar() {
        const rawM = 100 / scale;
        const nice = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
        let dm = nice.find(n => n >= rawM) || Math.round(rawM / 1000) * 1000;
        let dp = dm * scale;
        const maxW = canvas.width - 60;
        if (dp > maxW) { dp = maxW; dm = Math.round(dp / scale); }

        const bx = canvas.width - dp - 30;
        const by = canvas.height - 25;
        const cc = getCanvasColors();

        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + dp, by);
        ctx.strokeStyle = cc.stroke; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx, by - 6); ctx.lineTo(bx, by + 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx + dp, by - 6); ctx.lineTo(bx + dp, by + 6); ctx.stroke();

        ctx.font = 'bold 11px Arial';
        ctx.fillStyle = cc.text;
        ctx.textAlign = 'center';
        ctx.fillText(dm >= 1000 ? `${(dm / 1000).toFixed(1)} км` : `${Math.round(dm)} м`, bx + dp / 2, by - 12);
    }

    // ========== АВТОМАСШТАБ ==========

	function autoScale() {
		const track = MeasurementsStore.stationTrack;
		const solutions = MeasurementsStore.getAllSolutions();

		let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
		let found = false;

		for (const p of track) {
			minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
			minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
			found = true;
		}

		for (const addr in solutions) {
			const s = solutions[addr];
			minLat = Math.min(minLat, s.latDeg); maxLat = Math.max(maxLat, s.latDeg);
			minLon = Math.min(minLon, s.lonDeg); maxLon = Math.max(maxLon, s.lonDeg);
			found = true;
		}
		
		if (typeof POIManager !== 'undefined') {
			const poiPoints = POIManager.getAll();
			for (const poi of poiPoints) {
				minLat = Math.min(minLat, poi.lat); maxLat = Math.max(maxLat, poi.lat);
				minLon = Math.min(minLon, poi.lon); maxLon = Math.max(maxLon, poi.lon);
				found = true;
			}
		}

		if (!found) return;

		const anchor = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
		const deltas = GeoUtils.deltasByDegrees(anchor.lat, anchor.lon, maxLat, maxLon);
		const rangeX = Math.abs(deltas.deltaLonM) * 2.5;
		const rangeY = Math.abs(deltas.deltaLatM) * 2.5;
		const rangeM = Math.max(rangeX, rangeY, 100);  // минимум 100 метров

		const newScale = Math.min(canvas.width, canvas.height) / rangeM;
		scale = Math.min(Math.max(newScale, 0.01), 10000);
		
		// Центрируем по центру трека
		const centerLat = (minLat + maxLat) / 2;
		const centerLon = (minLon + maxLon) / 2;
		const trackAnchor = track.length > 0 ? track[0] : { lat: centerLat, lon: centerLon };
		const centerDeltas = GeoUtils.deltasByDegrees(trackAnchor.lat, trackAnchor.lon, centerLat, centerLon);
		
		offsetX = canvas.width / 2 - centerDeltas.deltaLonM * scale;
		offsetY = canvas.height / 2 + centerDeltas.deltaLatM * scale;
		
		lastAutoScaleTime = Date.now();
	}

    function centerOnWorldPoint(worldX, worldY) {
        offsetX = canvas.width / 2 - worldX * scale;
        offsetY = canvas.height / 2 + worldY * scale;
        autoScaleEnabled = false;
    }

    function resetView() {
        autoScale();
        autoScaleEnabled = true;
    }

    // ========== ГЛАВНАЯ ОТРИСОВКА ==========

    function drawAll() {
        if (!ctx || canvas.width === 0) return;
		
		resizeCanvas();

		// Автомасштаб не чаще раза в секунду
		if (autoScaleEnabled && (MeasurementsStore.stationTrack.length > 0 || 
				(typeof POIManager !== 'undefined' && POIManager.getCount() > 0))) {
				autoScale();
			}

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawGrid();
        drawStationTrack();
        drawMeasurements();
        drawSolutions();
		drawPOI();
        drawScaleBar();
		if (typeof UIRuler !== 'undefined') UIRuler.draw();
    }

    // ========== ВЗАИМОДЕЙСТВИЕ ==========

    function updateFromInteraction(dx, dy) {
        offsetX += dx;
        offsetY += dy;
        autoScaleEnabled = false;
        lastUserActionTime = Date.now();
    }

    function zoom(wheelDelta, mouseX, mouseY, rect) {
        const mx = mouseX - rect.left;
        const my = mouseY - rect.top;
        const worldX = (mx - offsetX) / scale;
        const worldY = (offsetY - my) / scale;

        scale *= wheelDelta > 0 ? 0.85 : 1.18;
        scale = Math.min(Math.max(scale, 0.01), 10000);

        offsetX = mx - worldX * scale;
        offsetY = my + worldY * scale;
        autoScaleEnabled = false;
        lastUserActionTime = Date.now();
    }

    // ========== ЭКСПОРТ ==========

    return {
        init,
        drawAll,
        autoScale,
        resetView,
        centerOnWorldPoint,
        getScale, setScale,
        getOffset, setOffset,
        isAutoScaleEnabled, setAutoScaleEnabled,
        isDraggingEnabled, setDraggingEnabled,
        updateFromInteraction,
		toggleRuler: () => UIRuler.toggle(),
        zoom,
        resizeCanvas,
        getCanvasColors,
        getCanvasWidth: () => canvas.width,
        getCanvasHeight: () => canvas.height,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UICanvas;
}