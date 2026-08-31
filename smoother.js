// smoother.js — TrackMovingAverageSmoother (взвешенное скользящее среднее)
// Портировано с C# UCNLNav.TrackFilters.TrackMovingAverageSmoother

const SmoothModule = (() => {

    class MPoint {
        constructor(x, y) {
            this.x = x;
            this.y = y;
        }
    }

    class TrackMovingAverageSmoother {
        constructor(filterSize = 4, resetDeltaM = 3000) {
            if (resetDeltaM <= 0) throw new Error('resetDeltaM must be > 0');
            if (filterSize <= 0) throw new Error('filterSize must be > 0');

            this.filterSize = filterSize;
            this.maxDistToReset = resetDeltaM;

            this.points = [];
            this.anchorLat = NaN;
            this.anchorLon = NaN;
            this.prevLat = NaN;
            this.prevLon = NaN;
        }

        process(lat, lon, dpt, ts) {
            if (this.points.length === 0) {
                this.anchorLat = lat;
                this.anchorLon = lon;
                this.points.push(new MPoint(0, 0));
                this.prevLat = lat;
                this.prevLon = lon;
                return { lat, lon, dpt, ts };
            }

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

            if (this.points.length >= this.filterSize) {
                this.points.shift();
            }

            const deltas = GeoUtils.getDeltasByGeopoints_WGS84(this.anchorLat, this.anchorLon, lat, lon);
            this.points.push(new MPoint(deltas.deltaLonM, deltas.deltaLatM));

            let meanX = 0, meanY = 0;
            for (let i = 0; i < this.points.length; i++) {
                const weight = i + 1;
                meanX += this.points[i].x * weight;
                meanY += this.points[i].y * weight;
            }

            const fWeight = (this.points.length + this.points.length * this.points.length) / 2.0;
            meanX /= fWeight;
            meanY /= fWeight;

            const result = GeoUtils.geopointOffsetByDeltas_WGS84(this.anchorLat, this.anchorLon, meanY, meanX);
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
    }

    // Экспорт в глобальную область
    window.TrackMovingAverageSmoother = TrackMovingAverageSmoother;

    return TrackMovingAverageSmoother;

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TrackMovingAverageSmoother;
}