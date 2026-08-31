// vincenty.js — Реализация Vincenty Direct (прямая геодезическая задача)
// Портировано с C# Algorithms.VincentyDirect
// Использует эллипсоид WGS84

const Vincenty = (() => {

    const WGS84 = {
        a: 6378137.0,
        f: 1 / 298.257223563,
        b: 6356752.314245,
    };

    const DEFAULT_EPSILON = 1e-12;
    const DEFAULT_IT_LIMIT = 2000;

    function deg2rad(deg) { return deg * Math.PI / 180.0; }
    function rad2deg(rad) { return rad * 180.0 / Math.PI; }

    function wrap2PI(angleRad) {
        let a = angleRad % (2 * Math.PI);
        if (a < 0) a += 2 * Math.PI;
        return a;
    }

    function vincentyDirect(latRad, lonRad, azmRad, distM, epsilon, itLimit) {
        epsilon = epsilon || DEFAULT_EPSILON;
        itLimit = itLimit || DEFAULT_IT_LIMIT;

        const a = WGS84.a;
        const f = WGS84.f;
        const b = WGS84.b;

        const sin_alpha1 = Math.sin(azmRad);
        const cos_alpha1 = Math.cos(azmRad);

        const tan_u1 = (1.0 - f) * Math.tan(latRad);
        const cos_u1 = 1.0 / Math.sqrt(1.0 + tan_u1 * tan_u1);
        const sin_u1 = tan_u1 * cos_u1;

        const sigma1 = Math.atan2(tan_u1, cos_alpha1);
        const sin_alpha = cos_u1 * sin_alpha1;
        const cos_sq_alpha = 1.0 - sin_alpha * sin_alpha;

        const u_sq = cos_sq_alpha * (a * a - b * b) / (b * b);
        const A = 1.0 + u_sq / 16384.0 * (4096.0 + u_sq * (-768.0 + u_sq * (320.0 - 175.0 * u_sq)));
        const B = u_sq / 1024.0 * (256.0 + u_sq * (-128.0 + u_sq * (74.0 - 47.0 * u_sq)));

        let sigma = distM / (b * A);
        let sigma_prev;
        let iterations = 0;
        let converged = false;

        do {
            const cos_2sigma_m = Math.cos(2.0 * sigma1 + sigma);
            const sin_sigma = Math.sin(sigma);
            const cos_sigma = Math.cos(sigma);

            const delta_sigma = B * sin_sigma * (
                cos_2sigma_m + B / 4.0 * (
                    cos_sigma * (-1.0 + 2.0 * cos_2sigma_m * cos_2sigma_m) -
                    B / 6.0 * cos_2sigma_m * (-3.0 + 4.0 * sin_sigma * sin_sigma) * (-3.0 + 4.0 * cos_2sigma_m * cos_2sigma_m)
                )
            );

            sigma_prev = sigma;
            sigma = distM / (b * A) + delta_sigma;
            iterations++;

        } while (Math.abs(sigma - sigma_prev) > epsilon && iterations < itLimit);

        converged = iterations < itLimit;

        const sin_sigma = Math.sin(sigma);
        const cos_sigma = Math.cos(sigma);
        const cos_2sigma_m = Math.cos(2.0 * sigma1 + sigma);

        const x = sin_u1 * sin_sigma - cos_u1 * cos_sigma * cos_alpha1;
        const ep_lat = Math.atan2(
            sin_u1 * cos_sigma + cos_u1 * sin_sigma * cos_alpha1,
            (1.0 - f) * Math.sqrt(sin_alpha * sin_alpha + x * x)
        );

        const lambda = Math.atan2(
            sin_sigma * sin_alpha1,
            cos_u1 * cos_sigma - sin_u1 * sin_sigma * cos_alpha1
        );

        const C = f / 16.0 * cos_sq_alpha * (4.0 + f * (4.0 - 3.0 * cos_sq_alpha));
        const L = lambda - (1.0 - C) * f * sin_alpha * (
            sigma + C * sin_sigma * (
                cos_2sigma_m + C * cos_sigma * (-1.0 + 2.0 * cos_2sigma_m * cos_2sigma_m)
            )
        );

        const ep_lon = lonRad + L;
        const rev_azm = Math.atan2(sin_alpha, -x);

        return {
            lat: ep_lat,
            lon: wrap2PI(ep_lon),
            revAzm: wrap2PI(rev_azm),
            converged: converged,
            iterations: iterations,
        };
    }

    // Экспорт в глобальную область
    window.vincentyDirect = vincentyDirect;
    window.deg2rad = deg2rad;
    window.rad2deg = rad2deg;
    window.wrap2PI = wrap2PI;

    return {
        WGS84,
        vincentyDirect,
        deg2rad,
        rad2deg,
        wrap2PI,
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Vincenty;
}