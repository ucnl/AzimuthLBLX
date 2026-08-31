// gnss-parser.js — Парсер NMEA для GNSS-компаса
// $HEHDT (True Heading), $HCHDG/$HCHDM (Magnetic Heading), $GPRMC (Position)

const GNSSParser = (() => {

    function safeFloat(str) {
        if (!str || str === '') return NaN;
        const v = parseFloat(str);
        return isNaN(v) ? NaN : v;
    }
	
	function safeInt(str) {
		if (!str || str === '') return NaN;
		const v = parseInt(str, 10);
		return isNaN(v) ? NaN : v;
	}

    function parseRMC(fields) {
        // $GPRMC,time,status,lat,N,lon,E,speed,course,date,mode*CS
        const status = fields[1] || '';
        if (status === 'V' || status === 'Invalid') return null;

        let lat = safeFloat(fields[2]);
        let lon = safeFloat(fields[4]);
        if (isNaN(lat) || isNaN(lon)) return null;

        // Конвертация из ddmm.mmmm в градусы
        if (lat > 0) {
            const latDeg = Math.floor(lat / 100);
            const latMin = lat - latDeg * 100;
            lat = latDeg + latMin / 60;
        }
        if (lon > 0) {
            const lonDeg = Math.floor(lon / 100);
            const lonMin = lon - lonDeg * 100;
            lon = lonDeg + lonMin / 60;
        }

        const latHemi = fields[3] || '';
        const lonHemi = fields[5] || '';
        if (latHemi === 'S') lat = -lat;
        if (lonHemi === 'W') lon = -lon;

        const mode = fields[11] || '';
        if (mode === 'N') return null;

        const speedKnots = safeFloat(fields[6]);
        const course = safeFloat(fields[7]);

        return {
            type: 'rmc',
            latitude: lat,
            longitude: lon,
            speedMps: !isNaN(speedKnots) ? speedKnots * 0.514444 : NaN,
            course: !isNaN(course) ? course : NaN,
        };
    }
	
	function parseGGA(fields) {
		const quality = parseInt(fields[5]) || 0;
		if (quality === 0) return null;

		let lat = safeFloat(fields[1]);
		let lon = safeFloat(fields[3]);
		if (isNaN(lat) || isNaN(lon)) return null;

		if (lat > 0) {
			const latDeg = Math.floor(lat / 100);
			const latMin = lat - latDeg * 100;
			lat = latDeg + latMin / 60;
		}
		if (lon > 0) {
			const lonDeg = Math.floor(lon / 100);
			const lonMin = lon - lonDeg * 100;
			lon = lonDeg + lonMin / 60;
		}

		const latHemi = fields[2] || '';
		const lonHemi = fields[4] || '';
		if (latHemi === 'S') lat = -lat;
		if (lonHemi === 'W') lon = -lon;

		const alt = safeFloat(fields[8]);

		return {
			type: 'gga',
			latitude: lat,
			longitude: lon,
			altitude: !isNaN(alt) ? alt : NaN,
			speedMps: NaN,
			course: NaN,
		};
	}

    function parseHDT(fields) {
        // $HEHDT,heading,T*CS
        const heading = safeFloat(fields[0]);
        if (isNaN(heading)) return null;

        return {
            type: 'hdt',
            heading: heading,
            isTrue: true,
        };
    }

	function parseHDG(fields) {
		// $HCHDG,heading,deviation,dev_dir,variation,var_dir*CS
		// Пример: $GNHDG,148.7,,,7.9,E*2F
		const magneticHeading = safeFloat(fields[0]);
		if (isNaN(magneticHeading)) return null;

		const deviation = safeFloat(fields[1]);      // девиация (может быть "")
		const devDir = (fields[2] || '').trim();      // направление девиации (E/W)
		const variation = safeFloat(fields[3]);        // магнитное склонение
		const varDir = (fields[4] || '').trim();       // направление склонения (E/W)

		// Вычисляем истинный курс
		let trueHeading = magneticHeading;
		
		// Учитываем девиацию (если есть)
		if (!isNaN(deviation) && devDir) {
			if (devDir === 'E' || devDir === 'e') {
				trueHeading += deviation;
			} else if (devDir === 'W' || devDir === 'w') {
				trueHeading -= deviation;
			}
		}
		
		// Учитываем магнитное склонение
		if (!isNaN(variation) && varDir) {
			if (varDir === 'E' || varDir === 'e') {
				trueHeading += variation;
			} else if (varDir === 'W' || varDir === 'w') {
				trueHeading -= variation;
			}
		}
		
		// Нормализуем в диапазон 0-360°
		trueHeading = ((trueHeading % 360) + 360) % 360;

		return {
			type: 'hdg',
			heading: trueHeading,        // истинный курс (True Heading)
			magneticHeading: magneticHeading,
			deviation: !isNaN(deviation) ? deviation : null,
			devDir: devDir || null,
			variation: !isNaN(variation) ? variation : null,
			varDir: varDir || null,
			isTrue: true,                // теперь это истинный курс
		};
	}

    function parseHDM(fields) {
        // $HCHDM,heading,M*CS
        const heading = safeFloat(fields[0]);
        if (isNaN(heading)) return null;

        return {
            type: 'hdm',
            heading: heading,
            isTrue: false,
        };
    }

	function parse(rawLine) {
		if (typeof rawLine !== 'string') return null;
		const line = rawLine.trim();
		if (!line.startsWith('$')) return null;

		// Проверка контрольной суммы
		const starIdx = line.indexOf('*');
		if (starIdx === -1) return null; // нет контрольной суммы — битая строка

		// Вычисляем контрольную сумму
		let calcChecksum = 0;
		for (let i = 1; i < starIdx; i++) {
			calcChecksum ^= line.charCodeAt(i);
		}

		// Читаем заявленную контрольную сумму
		const expectedChecksum = parseInt(line.substring(starIdx + 1), 16);
		if (isNaN(expectedChecksum) || calcChecksum !== expectedChecksum) {
			return null; // контрольная сумма не совпала — битая строка
		}

		const body = line.substring(1, starIdx);
		const parts = body.split(',');
		const talker = parts[0];

		// Минимальная длина: хотя бы talker + 1 поле
		if (parts.length < 2) return null;

		const sentenceType = talker.slice(-3).toUpperCase();

		if (sentenceType === 'HDT') return parseHDT(parts.slice(1));
		if (sentenceType === 'HDG') return parseHDG(parts.slice(1));
		if (sentenceType === 'HDM') return parseHDM(parts.slice(1));
		if (sentenceType === 'RMC') return parseRMC(parts.slice(1));
		if (sentenceType === 'GGA') return parseGGA(parts.slice(1));

		return null;
	}

    return { parse, safeFloat };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GNSSParser;
}