// sound-speed.js — Расчёт скорости звука в воде по UNESCO (Chen & Millero, 1977)

const SoundSpeed = (() => {

    /**
     * Скорость звука по UNESCO
     * @param {number} t - температура, °C
     * @param {number} s - солёность, PSU
     * @param {number} depthM - глубина, метры
     * @returns {number} скорость звука, м/с
     */
    function calc(t, s, depthM = 0) {
        if (isNaN(t) || isNaN(s)) return NaN;
        const p = depthM; // децибары ≈ метры
        const sr = Math.sqrt(Math.abs(s));

        const c0 = ((((3.1464e-9  * t - 1.47800e-6) * t + 3.3420e-4) * t - 5.80852e-2) * t + 5.03711) * t + 1402.388;
        const c1 = (((-6.1185e-10 * t + 1.3621e-7)  * t - 8.1788e-6) * t + 6.8982e-4)  * t + 0.153563;
        const c2 = (((1.0405e-12 * t - 2.5335e-10) * t + 2.5974e-8) * t - 1.7107e-6)  * t + 3.1260e-5;
        const c3 = (-2.3643e-12 * t + 3.8504e-10) * t - 9.7729e-9;
        const c = ((c3 * p + c2) * p + c1) * p + c0;

        const a0 = (((-3.21e-8 * t + 2.006e-6) * t + 7.164e-5) * t - 1.262e-2) * t + 1.389;
        const a1 = (((-2.0122e-10 * t + 1.0507e-8) * t - 6.4885e-8) * t - 1.2580e-5) * t + 9.4742e-5;
        const a2 = ((7.988e-12 * t - 1.6002e-10) * t + 9.1041e-9) * t - 3.9064e-7;
        const a3 = (-3.389e-13 * t + 6.649e-12) * t + 1.100e-10;
        const a = ((a3 * p + a2) * p + a1) * p + a0;

        const b0 = -1.922e-2 - 4.42e-5 * t;
        const b1 = 7.3637e-5 + 1.7945e-7 * t;
        const b = b0 + b1 * p;

        const d = 1.727e-3 - 7.9836e-6 * p;

        return c + (a + b * sr + d * s) * s;
    }

    return { calc };
})();