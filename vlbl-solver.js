// vlbl-solver.js — Решатели навигационной задачи VLBL
// TOA (Time of Arrival) — по измерениям дальности
// Портировано с C# UCNLNav.Algorithms и UCNLNav.Navigation

const VLBLsolver = (() => {

    // ========== КОНСТАНТЫ NELDER-MEAD ==========
    const NLM_A = 1.0;
    const NLM_B = 0.5;
    const NLM_R = 0.5;
    const NLM_Q = 0.5;
    const NLM_G = 2.0;

    const NLM_DEF_IT_LIMIT = 600;
    const NLM_DEF_PREC_THRLD = 1E-12;

    const WGS84_A = 6378137.0;
    const WGS84_B = 6356752.314245;

    const DEG2RAD = Math.PI / 180.0;
    const RAD2DEG = 180.0 / Math.PI;
    const PI2 = Math.PI * 2;

    // ========== ГЕОДЕЗИЧЕСКИЕ ФУНКЦИИ ==========

    function getDeltasByGeopoints_WGS84(lat1_rad, lon1_rad, lat2_rad, lon2_rad) {
        const mlat = (lat1_rad + lat2_rad) / 2.0;
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2.0 * mlat) + 1.175 * Math.cos(4.0 * mlat);
        const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3.0 * mlat);
        return {
            deltaLatM: (lat1_rad - lat2_rad) * mPerDegLat * RAD2DEG,
            deltaLonM: (lon1_rad - lon2_rad) * mPerDegLon * RAD2DEG,
        };
    }

    function geopointOffsetByDeltas_WGS84(lat_rad, lon_rad, lat_offset_m, lon_offset_m) {
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2.0 * lat_rad) + 1.175 * Math.cos(4.0 * lat_rad);
        const mPerDegLon = 111412.84 * Math.cos(lat_rad) - 93.5 * Math.cos(3.0 * lat_rad);
        return {
            lat: lat_rad - DEG2RAD * lat_offset_m / mPerDegLat,
            lon: lon_rad - DEG2RAD * lon_offset_m / mPerDegLon,
        };
    }

    function haversineInitialBearing(lat1_rad, lon1_rad, lat2_rad, lon2_rad) {
        const y = Math.sin(lon2_rad - lon1_rad) * Math.cos(lat2_rad);
        const x = Math.cos(lat1_rad) * Math.sin(lat2_rad) - Math.sin(lat1_rad) * Math.cos(lat2_rad) * Math.cos(lon2_rad - lon1_rad);
        return ((Math.PI + Math.atan2(y, x)) % PI2 + PI2) % PI2;
    }

    function dist3D(x1, y1, z1, x2, y2, z2) {
        return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2 + (z1 - z2) ** 2);
    }

    function wrap2PI(angleRad) {
        let a = angleRad % PI2;
        if (a < 0) a += PI2;
        return a;
    }

    function wrap360(angleDeg) {
        let a = angleDeg % 360;
        if (a < 0) a += 360;
        return a;
    }

    // ========== ФУНКЦИЯ НЕВЯЗКИ TOA 3D ==========

    /**
     * TOA residual function
     * @param {Array<{x,y,z,d}>} basePoints — базовые точки
     * @param {number} x — x координата
     * @param {number} y — y координата
     * @param {number} z — z координата (глубина)
     * @returns {number} — сумма квадратов невязок
     */
    function epsTOA3D(basePoints, x, y, z) {
        let result = 0;
        for (let i = 0; i < basePoints.length; i++) {
            const eps = dist3D(basePoints[i].x, basePoints[i].y, basePoints[i].z, x, y, z) - basePoints[i].d;
            result += eps * eps;
        }
        return result;
    }

    // ========== NELDER-MEAD 2D ==========

    /**
     * Поиск минимума методом Нелдера-Мида (2D: x,y; z фиксирована)
     * @param {Array<{x,y,z,d}>} basePoints
     * @param {number} xPrev — начальное приближение x
     * @param {number} yPrev — начальное приближение y
     * @param {number} z — фиксированная глубина
     * @param {number} maxIterations
     * @param {number} precisionThreshold
     * @param {number} simplexSize
     * @returns {{xBest, yBest, radialError, itCnt}}
     */
    function nelderMead2D(basePoints, xPrev, yPrev, z, maxIterations, precisionThreshold, simplexSize) {
        maxIterations = maxIterations || NLM_DEF_IT_LIMIT;
        precisionThreshold = precisionThreshold || NLM_DEF_PREC_THRLD;
        simplexSize = simplexSize || 1.0;

        let isFinished = false;
        let tmp, tmp1;
        const xix = [xPrev, xPrev + simplexSize, xPrev - simplexSize / 2];
        const xiy = [yPrev, yPrev + simplexSize, yPrev + simplexSize / 2];
        const fxi = [0, 0, 0];

        let itCnt = 0;

        while (!isFinished) {
            fxi[0] = epsTOA3D(basePoints, xix[0], xiy[0], z);
            fxi[1] = epsTOA3D(basePoints, xix[1], xiy[1], z);
            fxi[2] = epsTOA3D(basePoints, xix[2], xiy[2], z);

            // Сортировка вершин
            if (fxi[0] > fxi[1]) {
                tmp = fxi[0]; fxi[0] = fxi[1]; fxi[1] = tmp;
                tmp = xix[0]; xix[0] = xix[1]; xix[1] = tmp;
                tmp = xiy[0]; xiy[0] = xiy[1]; xiy[1] = tmp;
            }
            if (fxi[0] > fxi[2]) {
                tmp = fxi[0]; fxi[0] = fxi[2]; fxi[2] = tmp;
                tmp = xix[0]; xix[0] = xix[2]; xix[2] = tmp;
                tmp = xiy[0]; xiy[0] = xiy[2]; xiy[2] = tmp;
            }
            if (fxi[1] > fxi[2]) {
                tmp = fxi[1]; fxi[1] = fxi[2]; fxi[2] = tmp;
                tmp = xix[1]; xix[1] = xix[2]; xix[2] = tmp;
                tmp = xiy[1]; xiy[1] = xiy[2]; xiy[2] = tmp;
            }

            const fl = fxi[0], fg = fxi[1], fh = fxi[2];
            const xcx = (xix[0] + xix[1]) / 2;
            const xcy = (xiy[0] + xiy[1]) / 2;
            const xrx = (1 + NLM_A) * xcx - NLM_A * xix[2];
            const xry = (1 + NLM_A) * xcy - NLM_A * xiy[2];
            const fr = epsTOA3D(basePoints, xrx, xry, z);

            if (fr < fl) {
                const xex = (1 - NLM_G) * xcx + NLM_G * xrx;
                const xey = (1 - NLM_G) * xcy + NLM_G * xry;
                const fe = epsTOA3D(basePoints, xex, xey, z);
                if (fe < fr) {
                    xix[2] = xex; xiy[2] = xey;
                } else {
                    xix[2] = xrx; xiy[2] = xry;
                }
            } else if ((fr > fl) && (fr < fg)) {
                xix[2] = xrx; xiy[2] = xry;
            } else {
                const xsx = NLM_B * xix[2] + (1 - NLM_B) * xcx;
                const xsy = NLM_B * xiy[2] + (1 - NLM_B) * xcy;
                const fs = epsTOA3D(basePoints, xsx, xsy, z);
                if (fs < fh) {
                    xix[2] = xsx; xiy[2] = xsy;
                } else {
                    xix[1] = xix[0] + (xix[1] - xix[0]) / 2;
                    xiy[1] = xiy[0] + (xiy[1] - xiy[0]) / 2;
                    xix[2] = xix[0] + (xix[2] - xix[0]) / 2;
                    xiy[2] = xiy[0] + (xiy[2] - xiy[0]) / 2;
                }
            }

            tmp = (fxi[0] + fxi[1] + fxi[2]) / 3;
            tmp1 = ((fxi[0] - tmp) ** 2 + (fxi[1] - tmp) ** 2 + (fxi[2] - tmp) ** 2) / 3;

            isFinished = (++itCnt > maxIterations) || (Math.sqrt(tmp1) <= precisionThreshold);
        }

        return {
            xBest: xix[0],
            yBest: xiy[0],
            radialError: Math.sqrt(epsTOA3D(basePoints, xix[0], xiy[0], z)),
            itCnt,
        };
    }

    // ========== CIRCLES 1D (первое приближение) ==========

    function circlesIntersection_Solve(basePoints, anchorX, anchorY, radius, z, arcMidRad, arcAngleRad, steps) {
        let a = arcMidRad - arcAngleRad / 2;
        const aEnd = arcMidRad + arcAngleRad / 2;
        const stepRad = arcAngleRad / steps;
        let aBest = a;
        let epsBest = Infinity;

        while (a < aEnd) {
            const x = anchorX + radius * Math.cos(a);
            const y = anchorY + radius * Math.sin(a);
            const eps = epsTOA3D(basePoints, x, y, z);
            if (eps < epsBest) {
                epsBest = eps;
                aBest = a;
            }
            a += stepRad;
        }
        return aBest;
    }

    function getNearestItemIndex(basePoints) {
        let nrstIdx = 0;
        let minDst = Infinity;
        for (let i = 0; i < basePoints.length; i++) {
            if (basePoints[i].d < minDst) {
                minDst = basePoints[i].d;
                nrstIdx = i;
            }
        }
        return nrstIdx;
    }

    function circles1DSolve(basePoints, z, endArcAngleRad, steps, arcAngleDecreaseFactor) {
        const nrstIdx = getNearestItemIndex(basePoints);
        const dZ = Math.abs(basePoints[nrstIdx].z - z);
        const radius = basePoints[nrstIdx].d < dZ ? 0 : Math.sqrt(basePoints[nrstIdx].d ** 2 - dZ ** 2);
        const anchorX = basePoints[nrstIdx].x;
        const anchorY = basePoints[nrstIdx].y;
        let arcAngle = PI2;
        let alpha = 0;

        while (arcAngle > endArcAngleRad) {
            alpha = circlesIntersection_Solve(basePoints, anchorX, anchorY, radius, z, alpha, arcAngle, steps);
            arcAngle *= arcAngleDecreaseFactor;
        }

        return {
            x: anchorX + radius * Math.cos(alpha),
            y: anchorY + radius * Math.sin(alpha),
            radialError: Math.sqrt(epsTOA3D(basePoints, anchorX + radius * Math.cos(alpha), anchorY + radius * Math.sin(alpha), z)),
        };
    }

    // ========== КОНВЕРТАЦИЯ КООРДИНАТ ==========

    function getPointsCentroid2D(points) {
        let cLat = 0, cLon = 0;
        for (const p of points) {
            cLat += p.lat;
            cLon += p.lon;
        }
        return { lat: cLat / points.length, lon: cLon / points.length };
    }

    function convertToLCS(bases, centroid) {
        const cLat = centroid.lat * DEG2RAD;
        const cLon = centroid.lon * DEG2RAD;
        const result = [];
        for (const base of bases) {
            const d = getDeltasByGeopoints_WGS84(cLat, cLon, base.lat * DEG2RAD, base.lon * DEG2RAD);
            result.push({
                x: d.deltaLonM,
                y: d.deltaLatM,
                z: base.depth || 0,
                d: base.range,
            });
        }
        return result;
    }

    // ========== DOP ==========

    function getDOPs(basePoints, targetLoc, z) {
        const n = basePoints.length;
        if (n < 4) return null;

        // Строим матрицу H
        const H = [];
        for (let i = 0; i < n; i++) {
            const r = dist3D(basePoints[i].x, basePoints[i].y, basePoints[i].z, targetLoc.x, targetLoc.y, z);
            H.push([
                (targetLoc.x - basePoints[i].x) / r,
                (targetLoc.y - basePoints[i].y) / r,
                (z - basePoints[i].z) / r,
                1,
            ]);
        }

        // H^T * H
        const HtH = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                for (let k = 0; k < n; k++) {
                    HtH[i][j] += H[k][i] * H[k][j];
                }
            }
        }

        // Обратная матрица (4x4) методом Гаусса-Жордана
        const D = invert4x4(HtH);
        if (!D) return null;

        const GDOP = Math.sqrt(D[0][0] + D[1][1] + D[2][2] + D[3][3]);
        const PDOP = Math.sqrt(D[0][0] + D[1][1] + D[2][2]);
        const HDOP = Math.sqrt(D[0][0] + D[1][1]);
        const VDOP = Math.sqrt(D[2][2]);
        const TDOP = Math.sqrt(D[3][3]);

        return { GDOP, PDOP, HDOP, VDOP, TDOP };
    }

    function invert4x4(m) {
        const n = 4;
        const A = m.map(row => [...row]);
        const I = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];

        for (let col = 0; col < n; col++) {
            // Находим максимум в столбце
            let maxRow = col;
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
            }
            if (Math.abs(A[maxRow][col]) < 1e-12) return null;

            // Меняем строки
            [A[col], A[maxRow]] = [A[maxRow], A[col]];
            [I[col], I[maxRow]] = [I[maxRow], I[col]];

            // Нормализуем
            const div = A[col][col];
            for (let j = 0; j < n; j++) {
                A[col][j] /= div;
                I[col][j] /= div;
            }

            // Зануляем остальные
            for (let row = 0; row < n; row++) {
                if (row !== col) {
                    const factor = A[row][col];
                    for (let j = 0; j < n; j++) {
                        A[row][j] -= factor * A[col][j];
                        I[row][j] -= factor * I[col][j];
                    }
                }
            }
        }
        return I;
    }

    // ========== УГЛОВОЙ РАЗРЫВ ==========

	function getBasesMaxAngularGapDeg(basePoints, targetLatDeg, targetLonDeg) {
		// Считаем центроид базовых точек
		const centroid = getPointsCentroid2D(basePoints);
		
		const angles = [];
		const centroidLat = centroid.lat * DEG2RAD;
		const centroidLon = centroid.lon * DEG2RAD;

		// Углы от центроида к базовым точкам
		for (const bp of basePoints) {
			angles.push(
				haversineInitialBearing(centroidLat, centroidLon, bp.lat * DEG2RAD, bp.lon * DEG2RAD) * RAD2DEG
			);
		}

		angles.sort((a, b) => a - b);

		let maxGap = 0;
		for (let i = 1; i <= angles.length; i++) {
			let gap = angles[i % angles.length] - angles[i - 1];
			if (gap < 0) gap += 360;
			if (gap > maxGap) maxGap = gap;
		}
		return maxGap;
	}

    function getTBAState(maxAngularGap) {
        if (maxAngularGap >= 180) return 'Out_of_base';
        if (maxAngularGap > 160) return 'Poor';
        if (maxAngularGap > 140) return 'Fair';
        return 'Good';
    }

    // ========== ГЛАВНАЯ ФУНКЦИЯ: TOA LOCATE 2D ==========

    /**
     * Решает задачу определения координат маяка методом TOA 2D
     * @param {Array<{lat, lon, depth, range}>} bases — базовые точки (широта, долгота, глубина, дальность)
     * @param {number} prevLatDeg — предыдущая оценка широты (NaN если нет)
     * @param {number} prevLonDeg — предыдущая оценка долготы (NaN если нет)
     * @param {number} beaconDepthM — глубина маяка (измерена)
     * @param {Object} options — параметры решателя
     * @returns {{latDeg, lonDeg, radialError, itCnt, hdop, maxAngularGap, quality}}
     */
    function locate2D(bases, prevLatDeg, prevLonDeg, beaconDepthM, options = {}) {
        const maxIterations = options.maxIterations || NLM_DEF_IT_LIMIT;
        const precisionThreshold = options.precisionThreshold || NLM_DEF_PREC_THRLD;
        const simplexSize = options.simplexSize || 1.0;
        const endArcAngleRad = options.endArcAngleRad || DEG2RAD;
        const arcSteps = options.arcSteps || 10;
        const arcDecreaseFactor = options.arcDecreaseFactor || 0.1;

        const basesCentroid = getPointsCentroid2D(bases);
        const basePoints = convertToLCS(bases, basesCentroid);

        let xPrev, yPrev;

        if (isNaN(prevLatDeg) || isNaN(prevLonDeg)) {
            const prelim = circles1DSolve(basePoints, beaconDepthM, endArcAngleRad, arcSteps, arcDecreaseFactor);
            xPrev = prelim.x;
            yPrev = prelim.y;
        } else {
            const d = getDeltasByGeopoints_WGS84(
                basesCentroid.lat * DEG2RAD,
                basesCentroid.lon * DEG2RAD,
                prevLatDeg * DEG2RAD,
                prevLonDeg * DEG2RAD
            );
            xPrev = d.deltaLonM;
            yPrev = d.deltaLatM;
        }

        const result = nelderMead2D(basePoints, xPrev, yPrev, beaconDepthM, maxIterations, precisionThreshold, simplexSize);

        const geo = geopointOffsetByDeltas_WGS84(
            basesCentroid.lat * DEG2RAD,
            basesCentroid.lon * DEG2RAD,
            result.yBest,
            result.xBest
        );

        const latDeg = geo.lat * RAD2DEG;
        const lonDeg = geo.lon * RAD2DEG;

        // DOP
        const dop = getDOPs(basePoints, { x: result.xBest, y: result.yBest }, beaconDepthM);

        // Угловой разрыв
        const maxAngularGap = getBasesMaxAngularGapDeg(bases, latDeg, lonDeg);
        const quality = getTBAState(maxAngularGap);

        return {
            latDeg,
            lonDeg,
            radialError: result.radialError,
            itCnt: result.itCnt,
            hdop: dop ? dop.HDOP : NaN,
            pdop: dop ? dop.PDOP : NaN,
            gdop: dop ? dop.GDOP : NaN,
            vdop: dop ? dop.VDOP : NaN,
            tdop: dop ? dop.TDOP : NaN,
            maxAngularGap,
            quality,
        };
    }

    // ========== ЭКСПОРТ ==========

    return {
        locate2D,
        epsTOA3D,
        getDOPs,
        getBasesMaxAngularGapDeg,
        getTBAState,
        convertToLCS,
        getPointsCentroid2D,
        circles1DSolve,
        nelderMead2D,
        deg2rad: (d) => d * DEG2RAD,
        rad2deg: (r) => r * RAD2DEG,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VLBLsolver;
}