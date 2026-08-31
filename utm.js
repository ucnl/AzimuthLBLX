// utm.js — Конвертация WGS84 в UTM

const UTM = (() => {
    
    const WGS84_A = 6378137.0;          // большая полуось
    const WGS84_E = 0.081819190842622;  // эксцентриситет
    const WGS84_E2 = WGS84_E * WGS84_E;
    const WGS84_E4 = WGS84_E2 * WGS84_E2;
    const WGS84_E6 = WGS84_E4 * WGS84_E2;
    
    function getZone(lonDeg) {
        return Math.floor((lonDeg + 180) / 6) + 1;
    }
    
    function getUtmLetter(latDeg) {
        if (latDeg >= 72 && latDeg < 84) return 'X';
        if (latDeg >= 64 && latDeg < 72) return 'W';
        if (latDeg >= 56 && latDeg < 64) return 'V';
        if (latDeg >= 48 && latDeg < 56) return 'U';
        if (latDeg >= 40 && latDeg < 48) return 'T';
        if (latDeg >= 32 && latDeg < 40) return 'S';
        if (latDeg >= 24 && latDeg < 32) return 'R';
        if (latDeg >= 16 && latDeg < 24) return 'Q';
        if (latDeg >= 8 && latDeg < 16) return 'P';
        if (latDeg >= 0 && latDeg < 8) return 'N';
        if (latDeg >= -8 && latDeg < 0) return 'M';
        if (latDeg >= -16 && latDeg < -8) return 'L';
        if (latDeg >= -24 && latDeg < -16) return 'K';
        if (latDeg >= -32 && latDeg < -24) return 'J';
        if (latDeg >= -40 && latDeg < -32) return 'H';
        if (latDeg >= -48 && latDeg < -40) return 'G';
        if (latDeg >= -56 && latDeg < -48) return 'F';
        if (latDeg >= -64 && latDeg < -56) return 'E';
        if (latDeg >= -72 && latDeg < -64) return 'D';
        if (latDeg >= -80 && latDeg < -72) return 'C';
        return 'Z';
    }
    
    /**
     * Конвертирует WGS84 lat/lon в UTM Easting/Northing
     * @returns {{ easting: number, northing: number, zone: number, letter: string }}
     */
    function fromLatLon(latDeg, lonDeg) {
        const zone = getZone(lonDeg);
        const letter = getUtmLetter(latDeg);
        
        const latRad = latDeg * Math.PI / 180;
        const lonRad = lonDeg * Math.PI / 180;
        
        const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180; // центральный меридиан
        
        const sinLat = Math.sin(latRad);
        const cosLat = Math.cos(latRad);
        const tanLat = Math.tan(latRad);
        
        const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
        const T = tanLat * tanLat;
        const C = WGS84_E2 * cosLat * cosLat / (1 - WGS84_E2);
        const A = (lonRad - lon0) * cosLat;
        
        const M = WGS84_A * (
            (1 - WGS84_E2/4 - 3*WGS84_E4/64 - 5*WGS84_E6/256) * latRad
            - (3*WGS84_E2/8 + 3*WGS84_E4/32 + 45*WGS84_E6/1024) * Math.sin(2*latRad)
            + (15*WGS84_E4/256 + 45*WGS84_E6/1024) * Math.sin(4*latRad)
            - (35*WGS84_E6/3072) * Math.sin(6*latRad)
        );
        
        const easting = 500000 + N * (
            A
            + (1 - T + C) * A*A*A / 6
            + (5 - 18*T + T*T + 72*C - 58*WGS84_E2) * A*A*A*A*A / 120
        );
        
        let northing = M + N * tanLat * (
            A*A / 2
            + (5 - T + 9*C + 4*C*C) * A*A*A*A / 24
            + (61 - 58*T + T*T + 600*C - 330*WGS84_E2) * A*A*A*A*A*A / 720
        );
        
        // Южное полушарие
        if (latDeg < 0) {
            northing += 10000000;
        }
        
        return {
            easting: Math.round(easting * 100) / 100,
            northing: Math.round(northing * 100) / 100,
            zone,
            letter
        };
    }
    
    return { fromLatLon, getZone, getUtmLetter };
})();