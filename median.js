// median.js — TrackMedianFilter (медианный фильтр для географических координат)
// Аналог TrackMovingAverageSmoother, но с медианой вместо взвешенного среднего

const MedianFilterModule = (() => {

    class MPoint {
        constructor(x, y) {
            this.x = x;
            this.y = y;
        }
    }

    class TrackMedianFilter {
        /**
         * @param {number} filterSize — размер окна медианы (нечётное, минимум 3)
         * @param {number} resetDeltaM — порог сброса, метры (если скачок больше — сбрасываем фильтр)
         */
        constructor(filterSize = 5, resetDeltaM = 3000) {
            if (resetDeltaM <= 0) throw new Error('resetDeltaM must be > 0');
            if (filterSize < 3) throw new Error('filterSize must be >= 3');

            // Приводим к нечётному для медианы
            this.filterSize = (filterSize % 2 === 0) ? filterSize + 1 : filterSize;
            this.maxDistToReset = resetDeltaM;

            this.points = [];
            this.anchorLat = NaN;
            this.anchorLon = NaN;
            this.prevLat = NaN;
            this.prevLon = NaN;
        }

        process(lat, lon, dpt, ts) {
            // Первая точка — инициализация
            if (this.points.length === 0) {
                this.anchorLat = lat;
                this.anchorLon = lon;
                this.points.push(new MPoint(0, 0));
                this.prevLat = lat;
                this.prevLon = lon;
                return { lat, lon, dpt, ts };
            }

            // Проверка на большой скачок (сброс фильтра)
            const distToPrev = GeoUtils.haversineDistance(this.prevLat, this.prevLon, lat, lon);

            if (distToPrev >= this.maxDistToReset) {
                this.reset();
                this.anchorLat = lat;
                this.anchorLon = lon;
                this.points.push(new MPoint(0, 0));
                this.prevLat = lat;
                this.prevLon = lon;
                return { lat, lon, dpt, ts };
            }

            // Добавляем новую точку (переводим в метры от якоря)
            if (this.points.length >= this.filterSize) {
                this.points.shift();
            }

            const deltas = GeoUtils.getDeltasByGeopoints_WGS84(
                this.anchorLat, this.anchorLon, lat, lon
            );
            this.points.push(new MPoint(deltas.deltaLonM, deltas.deltaLatM));

            // Вычисляем медиану по X и Y
            const sortedX = this.points.map(p => p.x).sort((a, b) => a - b);
            const sortedY = this.points.map(p => p.y).sort((a, b) => a - b);

            const mid = Math.floor(sortedX.length / 2);
            const medianX = sortedX[mid];
            const medianY = sortedY[mid];

            // Обратно в географические координаты
            const result = GeoUtils.geopointOffsetByDeltas_WGS84(
                this.anchorLat, this.anchorLon, medianY, medianX
            );

            this.prevLat = result.lat;
            this.prevLon = result.lon;

            return { lat: result.lat, lon: result.lon, dpt, ts };
        }

        reset() {
            this.points = [];
            this.anchorLat = NaN;
            this.anchorLon = NaN;
            this.prevLat = NaN;
            this.prevLon = NaN;
        }

        get size() {
            return this.points.length;
        }
    }

    // Экспорт в глобальную область
    window.TrackMedianFilter = TrackMedianFilter;

    return TrackMedianFilter;

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TrackMedianFilter;
}