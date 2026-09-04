// azm-parser.js — Парсер протокола Zima2 USBL ($PAZM...)
// Портирован с C# AZMPort.ProcessIncoming() + Parse_*
// Принимает NMEA-строки от SerialBridge, возвращает структурированные объекты

const AZMParser = (() => {

    // ========== КОНСТАНТЫ ==========

    const ManufacturerCode = 'AZM';  // $PAZM...

    // Типы предложений и их ID (как в C# switch)
    const SentenceType = {
        ACK:       '0',   // $PAZM0 — подтверждение команды
        STRSTP:    '1',   // $PAZM1 — старт/стоп опроса
        RSTS:      '2',   // $PAZM2 — установка адреса/периода ответчика
        NDTA:      '3',   // $PAZM3 — данные измерений (САМОЕ ВАЖНОЕ)
        DPTOVR:    '4',   // $PAZM4 — переопределение глубины
        RUCMD:     '5',   // $PAZM5 — ответ на команду от ответчика
        RBCAST:    '6',   // $PAZM6 — широковещательное сообщение
        CREQ:      '7',   // $PAZM7 — запрос конфигурации ответчика
        CSET:      '8',   // $PAZM8 — запись/чтение параметров ответчика
		LBP_SETA:  'A',   // $PAZMA — конфигурация LBL решателя
        DINFO_GET: '?',   // $PAZM? — запрос информации об устройстве
        DINFO:     '!',   // $PAZM! — информация об устройстве
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

	function parseLBP_SETA(fields) {
		const result = {
			type: 'lbp_seta',
			valid: true,
			auto_output_present: false,
			autostart_on_poweron_present: false,
			sty_present: false,
			sos_present: false,
			sos_auto_present: false,
			smflt_present: false,
			achod_present: false,
			rerr_thld_present: false,
			a1_present: false,
			a2_present: false,
			a3_present: false,
			a4_present: false,
		};

		if (fields.length > 0 && fields[0] !== '') {
			result.auto_output_present = true;
			result.auto_output = safeInt(fields[0]);
		}

		if (fields.length > 1 && fields[1] !== '') {
			result.autostart_on_poweron_present = true;
			result.autostart_on_poweron = safeInt(fields[1]);
		}

		if (fields.length > 2 && fields[2] !== '') {
			result.sty_present = true;
			result.sty_psu = safeFloat(fields[2]);
		}

		if (fields.length > 3 && fields[3] !== '') {
			result.sos_present = true;
			result.sos = safeFloat(fields[3]);
		}

		if (fields.length > 4 && fields[4] !== '') {
			result.sos_auto_present = true;
			result.sos_auto = safeInt(fields[4]) === 1;
		}

		if (fields.length > 5 && fields[5] !== '' && 
			fields.length > 6 && fields[6] !== '') {
			result.smflt_present = true;
			result.smflt_size = safeInt(fields[5]);
			result.smflt_thld = safeFloat(fields[6]);
		}

		if (fields.length > 7 && fields[7] !== '' && 
			fields.length > 8 && fields[8] !== '' && 
			fields.length > 9 && fields[9] !== '') {
			result.achod_present = true;
			result.achod_size = safeInt(fields[7]);
			result.achod_mspd = safeFloat(fields[8]);
			result.achod_thld = safeFloat(fields[9]);
		}

		if (fields.length > 10 && fields[10] !== '') {
			result.rerr_thld_present = true;
			result.rerr_thld = safeFloat(fields[10]);
		}

		// Маяк 1
		if (fields.length > 11 && fields[11] !== '' && 
			fields.length > 12 && fields[12] !== '' && 
			fields.length > 13 && fields[13] !== '') {
			result.a1_present = true;
			result.a1 = safeInt(fields[11]);
			result.ln1 = safeFloat(fields[12]);
			result.lt1 = safeFloat(fields[13]);
		}

		// Маяк 2
		if (fields.length > 14 && fields[14] !== '' && 
			fields.length > 15 && fields[15] !== '' && 
			fields.length > 16 && fields[16] !== '') {
			result.a2_present = true;
			result.a2 = safeInt(fields[14]);
			result.ln2 = safeFloat(fields[15]);
			result.lt2 = safeFloat(fields[16]);
		}

		// Маяк 3
		if (fields.length > 17 && fields[17] !== '' && 
			fields.length > 18 && fields[18] !== '' && 
			fields.length > 19 && fields[19] !== '') {
			result.a3_present = true;
			result.a3 = safeInt(fields[17]);
			result.ln3 = safeFloat(fields[18]);
			result.lt3 = safeFloat(fields[19]);
		}

		// Маяк 4
		if (fields.length > 20 && fields[20] !== '' && 
			fields.length > 21 && fields[21] !== '' && 
			fields.length > 22 && fields[22] !== '') {
			result.a4_present = true;
			result.a4 = safeInt(fields[20]);
			result.ln4 = safeFloat(fields[21]);
			result.lt4 = safeFloat(fields[22]);
		}

		return result;
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
            case SentenceType.ACK:      return parseACK(fields);
            case SentenceType.STRSTP:   return parseSTRSTP(fields);
            case SentenceType.RSTS:     return parseRSTS(fields);
            case SentenceType.NDTA:     return parseNDTA(fields);
            case SentenceType.RUCMD:    return parseRUCMD(fields);
            case SentenceType.RBCAST:   return parseRBCAST(fields);
            case SentenceType.CSET:     return parseCSET(fields);
			case SentenceType.LBP_SETA: return parseLBP_SETA(fields);
            case SentenceType.DINFO:    return parseDINFO(fields);
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

	function buildLBP_SETA(config) {
		// config: { autoOutput, autostart, salinity, sos, sosAuto, 
		//           smfltSize, smfltThld, achodSize, achodMspd, achodThld, rerr,
		//           a1, ln1, lt1, a2, ln2, lt2, a3, ln3, lt3, a4, ln4, lt4 }
		
		const params = [
			config.autoOutput ?? '',
			config.autostart ?? '',
			config.salinity ?? '',
			config.sos ?? '',
			config.sosAuto ?? '',
			config.smfltSize ?? '',
			config.smfltThld ?? '',
			config.achodSize ?? '',
			config.achodMspd ?? '',
			config.achodThld ?? '',
			config.rerr ?? '',
			config.a1 ?? '',
			config.ln1 ?? '',
			config.lt1 ?? '',
			config.a2 ?? '',
			config.ln2 ?? '',
			config.lt2 ?? '',
			config.a3 ?? '',
			config.ln3 ?? '',
			config.lt3 ?? '',
		];
		
		// Маяк 4 — только если задан
		if (config.a4 !== undefined && config.ln4 !== undefined && config.lt4 !== undefined) {
			params.push(config.a4, config.ln4, config.lt4);
		}
		
		return buildSentence(SentenceType.LBP_SETA, params);
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
		parseLBP_SETA,
		buildLBP_SETA,
        safeFloat,
        safeInt,
        nmeaChecksum,
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AZMParser;
}