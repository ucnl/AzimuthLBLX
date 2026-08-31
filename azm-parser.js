// azm-parser.js — Парсер протокола Zima2 USBL ($PAZM...)
// Портирован с C# AZMPort.ProcessIncoming() + Parse_*
// Принимает NMEA-строки от SerialBridge, возвращает структурированные объекты

const AZMParser = (() => {

    // ========== КОНСТАНТЫ ==========

    const ManufacturerCode = 'AZM';  // $PAZM...

    // Типы предложений и их ID (как в C# switch)
    const SentenceType = {
        ACK:     '0',   // $PAZM0 — подтверждение команды
        STRSTP:  '1',   // $PAZM1 — старт/стоп опроса
        RSTS:    '2',   // $PAZM2 — установка адреса/периода ответчика
        NDTA:    '3',   // $PAZM3 — данные измерений (САМОЕ ВАЖНОЕ)
        DPTOVR:  '4',   // $PAZM4 — переопределение глубины
        RUCMD:   '5',   // $PAZM5 — ответ на команду от ответчика
        RBCAST:  '6',   // $PAZM6 — широковещательное сообщение
        CREQ:    '7',   // $PAZM7 — запрос конфигурации ответчика
        CSET:    '8',   // $PAZM8 — запись/чтение параметров ответчика
        DINFO_GET: '?', // $PAZM? — запрос информации об устройстве
        DINFO:   '!',   // $PAZM! — информация об устройстве
    };

    // Статусы NDTA (исправлено под C#)
    const NDTAStatus = {
        NDTA_LOC_ONLY: 0,  // только локальные данные станции
        NDTA_REMR: 1,      // ответ от ответчика (данные измерений)
        NDTA_REMT: 2,      // таймаут ответчика
        NDTA_REMB: 3,      // broadcast
    };

    // Типы устройств (исправлено под C#)
    const DeviceType = {
        DT_USBL_TSV:  0,   // USBL приёмник
        DT_REMOTE:    1,   // Ответчик
        DT_LBL_TSV:   2,   // LBL приёмник
        DT_INVALID:   3,   // Неизвестно
    };

    // Адреса ответчиков (0-based, как в C# REMOTE_ADDR_Enum)
    const RemoteAddr = {
        REM_ADDR_1:  0,
        REM_ADDR_2:  1,
        REM_ADDR_3:  2,
        REM_ADDR_4:  3,
        REM_ADDR_5:  4,
        REM_ADDR_6:  5,
        REM_ADDR_7:  6,
        REM_ADDR_8:  7,
        REM_ADDR_9:  8,
        REM_ADDR_10: 9,
        REM_ADDR_11: 10,
        REM_ADDR_12: 11,
        REM_ADDR_13: 12,
        REM_ADDR_14: 13,
        REM_ADDR_15: 14,
        REM_ADDR_16: 15,
        REM_ADDR_INVALID: 16,
    };

    // ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

    function parseNMEALine(rawLine) {
        if (typeof rawLine !== 'string') return null;
        let line = rawLine.trim();
        if (!line) return null;
        line = line.replace(/\r$/, '');
        if (!line.startsWith('$P')) return null;

        const content = line.substring(2);
        if (content.length < 4) return null;
        const manufacturer = content.substring(0, 3);
        const rest = content.substring(3);

        let body, checksumStr;
        const starIdx = rest.indexOf('*');
        if (starIdx >= 0) {
            body = rest.substring(0, starIdx);
            checksumStr = rest.substring(starIdx + 1);
        } else {
            body = rest;
            checksumStr = null;
        }

        const firstComma = body.indexOf(',');
        let sentenceId, fieldsPart;
        if (firstComma >= 0) {
            sentenceId = body.substring(0, firstComma);
            fieldsPart = body.substring(firstComma + 1);
        } else {
            sentenceId = body;
            fieldsPart = '';
        }

        const fields = fieldsPart ? fieldsPart.split(',') : [];
        return { manufacturer, sentenceId, fields, raw: line };
    }

    function nmeaChecksum(data) {
        let checksum = 0;
        for (let i = 1; i < data.length; i++) {
            if (data[i] === '*') break;
            checksum ^= data.charCodeAt(i);
        }
        return checksum.toString(16).toUpperCase().padStart(2, '0');
    }

    function safeFloat(str) {
        if (str === undefined || str === null || str === '') return NaN;
        const val = parseFloat(str);
        return isNaN(val) ? NaN : val;
    }

    function safeInt(str) {
        if (str === undefined || str === null || str === '') return NaN;
        const val = parseInt(str, 10);
        return isNaN(val) ? NaN : val;
    }

    // ========== ПАРСЕРЫ ПРЕДЛОЖЕНИЙ ==========

    function parseACK(fields) {
        return {
            type: 'ack',
            commandId: fields[0] || '',
            result: safeInt(fields[1]) || 0,
        };
    }

    function parseSTRSTP(fields) {
        return {
            type: 'strstp',
            addrMask: safeInt(fields[0]) || 0,
            salinityPSU: safeFloat(fields[1]),
            soundSpeedMps: safeFloat(fields[2]),
            maxDistM: safeFloat(fields[3]),
        };
    }

    function parseRSTS(fields) {
        return {
            type: 'rsts',
            remoteAddr: safeInt(fields[0]) || 0,
            styPSU: safeFloat(fields[1]),
        };
    }

    function parseNDTA(fields) {
        const status = safeInt(fields[0]) || 0;
        const addr = safeInt(fields[1]) || 0;

        return {
            type: 'ndta',
            status: status,
            address: addr,
            reqCode: safeInt(fields[2]) || 0,
            resCode: safeInt(fields[3]) || 0,
            msrDB: safeFloat(fields[4]),
            propTimeS: safeFloat(fields[5]),
            slantRangeM: safeFloat(fields[6]),
            slantRangeProjectionM: safeFloat(fields[7]),
            remoteDepthM: safeFloat(fields[8]),
            hAngleDeg: safeFloat(fields[9]),
            vAngleDeg: safeFloat(fields[10]),
            locPressureMBar: safeFloat(fields[11]),
            locTempC: safeFloat(fields[12]),
            locHeadingDeg: safeFloat(fields[13]),
            locPitchDeg: safeFloat(fields[14]),
            locRollDeg: safeFloat(fields[15]),
        };
    }

    function parseRUCMD(fields) {
        return { type: 'rucmd', commandId: safeInt(fields[0]) || 0 };
    }

    function parseRBCAST(fields) {
        return { type: 'rbcast', commandId: safeInt(fields[0]) || 0 };
    }

    function parseCSET(fields) {
        return {
            type: 'cset',
            dataId: safeInt(fields[0]) || 0,
            dataValue: safeInt(fields[1]) || 0,
        };
    }

	function parseDINFO(fields) {
		const deviceType = safeInt(fields[0]) || 0;
		let addrMask = 0;
		let remoteAddr = RemoteAddr.REM_ADDR_INVALID;

		if (deviceType === DeviceType.DT_USBL_TSV || deviceType === DeviceType.DT_LBL_TSV) {
			addrMask = safeInt(fields[1]);
			if (isNaN(addrMask)) addrMask = 0;
		} else if (deviceType === DeviceType.DT_REMOTE) {
			remoteAddr = safeInt(fields[1]);
			if (isNaN(remoteAddr)) remoteAddr = RemoteAddr.REM_ADDR_INVALID;
		}

		return {
			type: 'dinfo',
			deviceType: deviceType,
			addressMask: addrMask,
			remoteAddress: remoteAddr,
			serialNumber: fields[2] || '',
			systemInfo: fields[3] || '',
			systemVersion: fields[4] || '',
			ptsType: safeInt(fields[5]) || 0,
			channelId: safeInt(fields[6]) || 0,
		};
	}

    // ========== ГЛАВНАЯ ФУНКЦИЯ ПАРСИНГА ==========

    function parse(rawLine) {
        const parsed = parseNMEALine(rawLine);
        if (!parsed) return null;
        if (parsed.manufacturer !== ManufacturerCode) return null;

        const { sentenceId, fields } = parsed;

        switch (sentenceId) {
            case SentenceType.ACK:     return parseACK(fields);
            case SentenceType.STRSTP:  return parseSTRSTP(fields);
            case SentenceType.RSTS:    return parseRSTS(fields);
            case SentenceType.NDTA:    return parseNDTA(fields);
            case SentenceType.RUCMD:   return parseRUCMD(fields);
            case SentenceType.RBCAST:  return parseRBCAST(fields);
            case SentenceType.CSET:    return parseCSET(fields);
            case SentenceType.DINFO:   return parseDINFO(fields);
            default: return null;
        }
    }

    // ========== ПОСТРОЕНИЕ ИСХОДЯЩИХ ПРЕДЛОЖЕНИЙ ==========

    function buildSentence(sentenceId, params = []) {
        let body = `PAZM${sentenceId}`;
        while (params.length > 0 && (params[params.length - 1] === null || params[params.length - 1] === undefined)) {
            params.pop();
        }
        if (params.length > 0) {
            body += ',' + params.map(p => (p !== null && p !== undefined) ? String(p) : '').join(',');
        }
        const checksum = nmeaChecksum('$' + body);
        return `$${body}*${checksum}\r\n`;
    }

    function buildDINFO_GET() {
        return buildSentence(SentenceType.DINFO_GET, [0]);
    }

    function buildSTRSTP(addrMask, salinityPSU, soundSpeedMps, maxDistM) {
        return buildSentence(SentenceType.STRSTP, [
            addrMask || 0,
            isNaN(salinityPSU) ? null : salinityPSU,
            isNaN(soundSpeedMps) ? null : soundSpeedMps,
            isNaN(maxDistM) ? null : maxDistM,
        ]);
    }

    function buildBaseStop() {
        return buildSTRSTP(0, NaN, NaN, NaN);
    }

	function buildRSTS(addr, salinityPSU) {
		return buildSentence(SentenceType.RSTS, [
			(addr !== null && addr !== undefined) ? addr : '',
			(!isNaN(salinityPSU) && salinityPSU !== null) ? salinityPSU : ''
		]);
	}

    // ========== ПУБЛИЧНЫЙ API ==========

    return {
        SentenceType,
        NDTAStatus,
        DeviceType,
        RemoteAddr,
        parse,
        buildSentence,
        buildDINFO_GET,
        buildSTRSTP,
        buildBaseStop,
		buildRSTS,
        safeFloat,
        safeInt,
        nmeaChecksum,
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AZMParser;
}