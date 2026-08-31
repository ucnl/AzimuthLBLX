// vlbl-measurements.js — Управление измерениями VLBL
// Портировано с C# UCNLNav.VLBL.VLBLMeasurements
// Алгоритм выбора базы по угловому разбросу относительно референсной точки

const VLBLMeasurements = (() => {

    class VLBLMeasurementsClass {
        constructor(capacity = 100, baseSize = 4) {
            if (capacity < 3) throw new Error('capacity must be >= 3');
            if (baseSize < 3) throw new Error('baseSize must be >= 3');

            this.capacity = capacity;
            this.baseSize = baseSize;

            this.byAge = [];
            this.byBearing = [];
            this.byDistance = [];

            this.refPoint = { lat: NaN, lon: NaN };
            this.isRefPointSet = false;

            this.aRange = 0;
            this.aRangeStart = 0;
            this.aRangeEnd = 0;
            this.angularGap = 0;
            this.angularRange = 0;
        }

        get isBaseExists() {
            return this.byDistance.length >= this.baseSize + 1;
        }

        clear() {
            this.byAge = [];
            this.byBearing = [];
            this.byDistance = [];
            this.refPoint = { lat: NaN, lon: NaN };
            this.isRefPointSet = false;
            this.aRange = 0;
            this.aRangeStart = 0;
            this.aRangeEnd = 0;
            this.angularGap = 0;
            this.angularRange = 0;
        }

        setRefPoint(newRefPoint) {
            if (isNaN(newRefPoint.lat) || isNaN(newRefPoint.lon)) {
                throw new Error('RefPoint must have valid lat/lon');
            }

            this.refPoint = { lat: newRefPoint.lat, lon: newRefPoint.lon };
            this.isRefPointSet = true;

            for (const item of this.byAge) {
                this._updateItemRefPoint(item);
            }

            this._resort();
            this._updateAngularRange();
        }

		add(item) {
			// Добавляем новую точку
			this.byAge.push(item);
			this.byBearing.push(item);
			this.byDistance.push(item);

			// Удаляем самое старое, если превышен capacity
			if (this.byAge.length > this.capacity) {
				const oldest = this.byAge.shift();
				this.byBearing = this.byBearing.filter(m => m !== oldest);
				this.byDistance = this.byDistance.filter(m => m !== oldest);
			}

			// Пересчитываем центроид — всегда актуальный
			this.refPoint = this._getCentroid(this.byAge);
			this.isRefPointSet = true;

			// Пересчитываем углы и дистанции для всех точек
			for (const m of this.byAge) {
				this._updateItemRefPoint(m);
			}

			this._resort();
			this._updateAngularRange();
		}

		 getBase() {
			if (!this.isBaseExists) {
				throw new Error('Base does not exist');
			}

			// Сортируем по углу от референсной точки
			const sorted = [...this.byBearing].sort((a, b) => a.bearingFromRef - b.bearingFromRef);
			
			// Находим максимальный угловой разрыв
			let maxGap = 0;
			let maxGapIdx = 0; // индекс начала разрыва
			
			for (let i = 0; i < sorted.length; i++) {
				const j = (i + 1) % sorted.length;
				let gap = sorted[j].bearingFromRef - sorted[i].bearingFromRef;
				if (gap < 0) gap += 360;
				
				if (gap > maxGap) {
					maxGap = gap;
					maxGapIdx = j; // точка после разрыва
				}
			}
			
			// aRangeStart — точка сразу после максимального разрыва
			const aRangeStart = sorted[maxGapIdx].bearingFromRef;
			
			// Покрытый угловой диапазон
			const covered = 360 - maxGap;
			
			// Равномерно распределяем точки по покрытому диапазону
			const result = [];
			const delta = covered / this.baseSize;
			
			for (let i = 0; i < this.baseSize; i++) {
				const desiredAngle = (aRangeStart + i * delta + delta / 2) % 360;
				
				// Находим ближайшую точку к desiredAngle
				let minDiff = Infinity;
				let bestPoint = null;
				
				for (const p of sorted) {
					if (result.includes(p)) continue;
					
					let diff = Math.abs(desiredAngle - p.bearingFromRef);
					if (diff > 180) diff = 360 - diff;
					
					if (diff < minDiff) {
						minDiff = diff;
						bestPoint = p;
					}
				}
				
				if (bestPoint) {
					result.push(bestPoint);
				}
			}
			
			return result;
		}

        getAll() {
            return [...this.byAge];
        }

        get count() {
            return this.byAge.length;
        }

        // ========== PRIVATE METHODS ==========

        _getCentroid(points) {
            let cLat = 0, cLon = 0;
            for (const p of points) {
                cLat += p.lat;
                cLon += p.lon;
            }
            return { lat: cLat / points.length, lon: cLon / points.length };
        }

        _updateItemRefPoint(item) {
            item.bearingFromRef = this._calcBearing(
                this.refPoint.lat, this.refPoint.lon,
                item.lat, item.lon
            );

            item.distanceToRef = this._calcDistance(
                this.refPoint.lat, this.refPoint.lon,
                item.lat, item.lon
            );
        }

        _calcBearing(lat1, lon1, lat2, lon2) {
            const phi1 = lat1 * Math.PI / 180;
            const phi2 = lat2 * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;

            const y = Math.sin(dLon) * Math.cos(phi2);
            const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);

            let bearing = Math.atan2(y, x) * 180 / Math.PI;
            if (bearing < 0) bearing += 360;
            return bearing;
        }

        _calcDistance(lat1, lon1, lat2, lon2) {
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

        _resort() {
            this.byBearing.sort((a, b) => a.bearingFromRef - b.bearingFromRef);
            this.byDistance.sort((a, b) => a.distanceToRef - b.distanceToRef);
        }

        _updateAngularRange() {
            if (this.byAge.length < 2) return;

            let maxGapStartIdx = 0;
            let maxGapEndIdx = 1;
            let maxGap = this.byBearing[maxGapEndIdx].bearingFromRef - this.byBearing[maxGapStartIdx].bearingFromRef;
            let gap;

            let idx = 2;
            while (idx <= this.byBearing.length) {
                const lIdx = idx - 1;
                let rIdx = idx;
                if (rIdx >= this.byBearing.length) rIdx = 0;

                gap = this.byBearing[rIdx].bearingFromRef - this.byBearing[lIdx].bearingFromRef;
                if (gap < 0) gap += 360;

                if (gap > maxGap) {
                    maxGap = gap;
                    maxGapStartIdx = lIdx;    // ← ИСПРАВЛЕНО: было lIdx - 1
                    maxGapEndIdx = rIdx;
                }
                idx++;
            }

            this.aRangeStart = this.byBearing[maxGapEndIdx].bearingFromRef;
            this.aRangeEnd = this.byBearing[maxGapStartIdx].bearingFromRef;
            this.aRange = this.aRangeEnd - this.aRangeStart;
            if (this.aRange < 0) this.aRange += 360;

            this.angularRange = 360 - maxGap;
            this.angularGap = maxGap;
        }
    }

    return {
        VLBLMeasurementsClass,
        create: (capacity, baseSize) => new VLBLMeasurementsClass(capacity, baseSize),
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VLBLMeasurements;
}