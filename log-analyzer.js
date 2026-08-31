// log-analyzer.js — Анализ лога: маяки, компас, статистика

const LogAnalyzer = (() => {

    function analyze(entries) {
        if (!entries || entries.length === 0) return null;

        const report = {
            duration: '',
            totalEntries: entries.length,
            beacons: {},
            compass: { jumps: [], maxJump: null, gaps: [] },
            summary: {},
        };

        let firstTime = null;
        let lastTime = null;
        let prevHdg = NaN, prevHdgTime = 0;
        let prevRmcTime = 0;
        let ndtaCount = 0, gnssCount = 0, cmdCount = 0;

        for (const e of entries) {
            if (e.type === 'header') continue;

            // Временные границы
            if (e.timestamp && !firstTime) firstTime = e.timestamp;
            if (e.timestamp) lastTime = e.timestamp;

            const port = e.port || '';

            // Типы записей
            if (e.type === 'incoming' && (port === 'AZM' || port.includes('AZM'))) {
                ndtaCount++;
                if (e.data) parseNDTAForReport(e.data, report);
            } else if (e.type === 'incoming' && isPositionPort(port)) {
                gnssCount++;
                if (e.data) parseGNSSForReport(e.data, e.timestamp, report);
            } else if (e.type === 'outgoing') {
                cmdCount++;
            }
        }

        // Длительность
        if (firstTime && lastTime) {
            const durSec = (lastTime - firstTime) / 1000;
            const m = Math.floor(durSec / 60);
            const s = Math.floor(durSec % 60);
            report.duration = `${m}м ${s}с`;
        }

        report.summary = { ndtaCount, gnssCount, cmdCount };

        // Найти скачки и потери GNSS
        report.compass.jumps = findHeadingJumps(entries, 30);
        report.compass.gaps = findGNSSGaps(entries, 5);
        
        if (report.compass.jumps.length > 0) {
            report.compass.maxJump = report.compass.jumps.reduce((a, b) => a.rate > b.rate ? a : b);
        }

        report.compass.maxHeadingRate = findMaxHeadingRate(entries);

        return report;
    }
    
    // Проверка портов
    function isHeadingPort(port) {
        return port === 'GNSS' || port.includes('GNSS') || 
               port === 'HDM' || port.includes('HDM');
    }

    function isPositionPort(port) {
        return port === 'GNSS' || port.includes('GNSS');
    }

    // Проверка типа heading-записи
    function isHeadingRecord(gnss) {
        return gnss && (gnss.type === 'hdt' || gnss.type === 'hdm' || gnss.type === 'hdg') && !isNaN(gnss.heading);
    }

    function parseNDTAForReport(data, report) {
        const parsed = AZMParser.parse(data);
        if (!parsed || parsed.type !== 'ndta') return;

        const addr = parsed.address;
        if (!report.beacons[addr]) {
            report.beacons[addr] = {
                address: addr,
                userAddress: addr + 1,
                total: 0,
                succeeded: 0,
                timeouts: 0,
                sumRange: 0,
                sumMsr: 0,
                countRange: 0,
                countMsr: 0,
            };
        }

        const b = report.beacons[addr];
        b.total++;

        if (parsed.status === 1) {
            b.succeeded++;
            if (!isNaN(parsed.slantRangeM)) {
                b.sumRange += parsed.slantRangeM;
                b.countRange++;
            }
            if (!isNaN(parsed.msrDB)) {
                b.sumMsr += parsed.msrDB;
                b.countMsr++;
            }
        } else if (parsed.status === 2) {
            b.timeouts++;
        }
    }

    function parseGNSSForReport(data, timestamp, report) {
        // Данные GNSS учитываются в других функциях отдельно
    }

    function findHeadingJumps(entries, thresholdDegPerSec = 30) {
        let prevHdg = NaN, prevTime = 0;
        const jumps = [];

        for (const e of entries) {
            const port = e.port || '';
            if (e.type === 'incoming' && isHeadingPort(port)) {
                const gnss = GNSSParser.parse(e.data || '');
                if (isHeadingRecord(gnss)) {
                    if (!isNaN(prevHdg) && prevTime > 0) {
                        const dt = (e.timestamp - prevTime) / 1000;
                        let dHdg = Math.abs(gnss.heading - prevHdg);
                        if (dHdg > 180) dHdg = 360 - dHdg;
                        if (dt > 0 && dHdg / dt > thresholdDegPerSec) {
                            jumps.push({
                                from: prevHdg,
                                to: gnss.heading,
                                dt: dt,
                                rate: dHdg / dt,
                                timestamp: e.timestamp,
                            });
                        }
                    }
                    prevHdg = gnss.heading;
                    prevTime = e.timestamp;
                }
            }
        }

        return jumps;
    }

    function findGNSSGaps(entries, maxGapSec = 5) {
        let prevTime = 0;
        const gaps = [];

        for (const e of entries) {
            const port = e.port || '';
            if (e.type === 'incoming' && isPositionPort(port)) {
                const gnss = GNSSParser.parse(e.data || '');
                if (gnss && gnss.type === 'rmc') {
                    if (prevTime > 0) {
                        const gap = (e.timestamp - prevTime) / 1000;
                        if (gap > maxGapSec) {
                            gaps.push({ gapSec: gap, timestamp: e.timestamp });
                        }
                    }
                    prevTime = e.timestamp;
                }
            }
        }

        return gaps;
    }

	function findMaxHeadingRate(entries) {
		let prevHdg = NaN, prevTime = 0;
		let maxRate = 0;
		let maxRateEntry = null;

		for (const e of entries) {
			const port = e.port || '';
			if (e.type === 'incoming' && isHeadingPort(port)) {
				const gnss = GNSSParser.parse(e.data || '');
				if (isHeadingRecord(gnss)) {
					if (!isNaN(prevHdg) && prevTime > 0 && e.timestamp) {
						const dt = (e.timestamp - prevTime) / 1000;
						if (dt > 0) {
							let dHdg = Math.abs(gnss.heading - prevHdg);
							if (dHdg > 180) dHdg = 360 - dHdg;
							
							// Мгновенная скорость (°/с)
							const instantRate = dHdg / dt;
							// Нормализованная скорость за 1 секунду
							const ratePerSec = dHdg * (1.0 / dt);
							
							if (instantRate > maxRate) {
								maxRate = instantRate;
								maxRateEntry = {
									from: prevHdg,
									to: gnss.heading,
									dt: dt,
									dHdg: dHdg,
									instantRate: instantRate,
									ratePerSec: ratePerSec,
									timestamp: e.timestamp,
								};
							}
						}
					}
					prevHdg = gnss.heading;
					prevTime = e.timestamp || 0;
				}
			}
		}

		return maxRateEntry;
	}

    function calcHeadingRMS(entries) {
        let sum = 0, count = 0;
        let prev = NaN;

        for (const e of entries) {
            const port = e.port || '';
            if (e.type === 'incoming' && isHeadingPort(port)) {
                const gnss = GNSSParser.parse(e.data || '');
                if (isHeadingRecord(gnss)) {
                    if (!isNaN(prev)) {
                        let diff = Math.abs(gnss.heading - prev);
                        if (diff > 180) diff = 360 - diff;
                        sum += diff * diff;
                        count++;
                    }
                    prev = gnss.heading;
                }
            }
        }

        if (count === 0) return null;
        return { rms: Math.sqrt(sum / count), count };
    }

    function calcGNSSStatic(entries) {
        const points = [];
        let totalSpeed = 0, speedCount = 0;

        for (const e of entries) {
            const port = e.port || '';
            if (e.type === 'incoming' && isPositionPort(port)) {
                const gnss = GNSSParser.parse(e.data || '');
                if (gnss?.type === 'rmc' && !isNaN(gnss.latitude) && !isNaN(gnss.longitude)) {
                    points.push({ lat: gnss.latitude, lon: gnss.longitude });
                    if (!isNaN(gnss.speedMps)) {
                        totalSpeed += gnss.speedMps;
                        speedCount++;
                    }
                }
            }
        }

        if (points.length < 5) return null;

        const avgSpeed = speedCount > 0 ? totalSpeed / speedCount : 0;

        let cLat = 0, cLon = 0;
        points.forEach(p => { cLat += p.lat; cLon += p.lon; });
        cLat /= points.length;
        cLon /= points.length;

        const cLatRad = cLat * Math.PI / 180;
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * cLatRad) + 1.175 * Math.cos(4 * cLatRad);
        const mPerDegLon = 111412.84 * Math.cos(cLatRad) - 93.5 * Math.cos(3 * cLatRad);

        let sx = 0, sy = 0;
        points.forEach(p => {
            const dx = (p.lon - cLon) * mPerDegLon;
            const dy = (p.lat - cLat) * mPerDegLat;
            sx += dx * dx;
            sy += dy * dy;
        });

        return {
            stdX: Math.sqrt(sx / points.length),
            stdY: Math.sqrt(sy / points.length),
            drms: Math.sqrt(sx / points.length + sy / points.length),
            avgSpeed,
            points: points.length,
        };
    }

    function calcBeaconSTD(track) {
        const valid = track.filter(p => !p.isTimeout && p.lat != null && p.lon != null && !isNaN(p.lat) && !isNaN(p.lon));
        if (valid.length < 5) return null;

        let cLat = 0, cLon = 0;
        valid.forEach(p => { cLat += p.lat; cLon += p.lon; });
        cLat /= valid.length;
        cLon /= valid.length;

        const cLatRad = cLat * Math.PI / 180;
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * cLatRad) + 1.175 * Math.cos(4 * cLatRad);
        const mPerDegLon = 111412.84 * Math.cos(cLatRad) - 93.5 * Math.cos(3 * cLatRad);

        let sx = 0, sy = 0;
        valid.forEach(p => {
            const dx = (p.lon - cLon) * mPerDegLon;
            const dy = (p.lat - cLat) * mPerDegLat;
            sx += dx * dx;
            sy += dy * dy;
        });

        const stdX = Math.sqrt(sx / valid.length);
        const stdY = Math.sqrt(sy / valid.length);
        const drms = Math.sqrt(stdX * stdX + stdY * stdY);

        return { stdX, stdY, drms, points: valid.length };
    }

    function formatReport(report) {
        if (!report) return 'Нет данных для анализа.';

        let html = '';

        html += `<h3>📊 Общая статистика</h3>`;
        html += `<div>Длительность: <b>${report.duration}</b></div>`;
        html += `<div>Всего записей: <b>${report.totalEntries}</b></div>`;
        html += `<div>NDTA: <b>${report.summary.ndtaCount}</b> | GNSS: <b>${report.summary.gnssCount}</b> | Команд: <b>${report.summary.cmdCount}</b></div>`;

        html += `<h3 style="margin-top:16px;">📡 Маяки</h3>`;
        if (Object.keys(report.beacons).length === 0) {
            html += `<div style="color:#888;">Нет данных маяков в логе</div>`;
        } else {
            for (const addr in report.beacons) {
                const b = report.beacons[addr];
                const pct = b.total > 0 ? (b.succeeded / b.total * 100).toFixed(1) : '0';
                const avgRange = b.countRange > 0 ? (b.sumRange / b.countRange).toFixed(1) : '--';
                const avgMsr = b.countMsr > 0 ? (b.sumMsr / b.countMsr).toFixed(1) : '--';

                html += `<div style="margin:4px 0;">`;
                html += `<b>#${b.userAddress}</b>: `;
                html += `Успешно: <b>${pct}%</b> (${b.succeeded}/${b.total}) | `;
                html += `Ср.дальность: <b>${avgRange}м</b> | `;
                html += `Ср.MSR: <b>${avgMsr}dB</b>`;
                const allTracks = TrackManager.getAll();
                const beaconTrack = allTracks[addr];
                if (beaconTrack) {
                    const std = calcBeaconSTD(beaconTrack);
                    if (std) {
                        html += ` | DRMS: <b>${std.drms.toFixed(2)}м</b>`;
                    }
                }
                html += `</div>`;
            }
        }

        html += `<h3 style="margin-top:16px;">🧭 Компас</h3>`;
        
        const jumps = report.compass.jumps || [];
        const gaps = report.compass.gaps || [];

        html += `<div>Скачков heading (>30°/с): <b>${jumps.length}</b></div>`;
        
        const entries = Logger.getEntries();
        const headingRMS = calcHeadingRMS(entries);
        if (headingRMS) {
            html += `<div style="margin-top:4px;">Heading RMS: <b>${headingRMS.rms.toFixed(2)}°</b> (n=${headingRMS.count})</div>`;
        }
        
		const maxRate = report.compass.maxHeadingRate;
		if (maxRate) {
			const rateColor = maxRate.instantRate > 10 ? '#e74c3c' : maxRate.instantRate > 3 ? '#f39c12' : '#27ae60';
			html += `<div style="margin-top:4px;">`;
			html += `Макс. скорость изменения курса: <b style="color:${rateColor};">${maxRate.ratePerSec.toFixed(1)}°/с</b>`;
			html += ` (Δ${maxRate.dHdg.toFixed(1)}° за ${maxRate.dt.toFixed(2)}с, мгновенная: ${maxRate.instantRate.toFixed(1)}°/с)`;
			html += `</div>`;
			
			let qualityNote = '';
			if (maxRate.instantRate > 10) {
				qualityNote = '⚠️ Очень высокий шум';
			} else if (maxRate.instantRate > 6) {
				qualityNote = '⚠️ Повышенный шум';
			} else if (maxRate.instantRate > 3) {
				qualityNote = 'Приемлемый уровень шума';
			} else {
				qualityNote = '✅ Отличное качество данных';
			}
			html += `<div style="margin-left:10px; color:#888; font-size:0.9em;">${qualityNote}</div>`;
		}
        
        if (jumps.length > 0) {
            const max = jumps.reduce((a, b) => a.rate > b.rate ? a : b);
            html += `<div style="margin-top:4px;">Макс. скачок: <b>${max.from.toFixed(1)}° → ${max.to.toFixed(1)}° за ${max.dt.toFixed(2)}с (${max.rate.toFixed(0)}°/с)</b></div>`;
        }

        html += `<div style="margin-top:4px;">Потерь GNSS (>5с): <b>${gaps.length}</b></div>`;
        
        const gnssStatic = calcGNSSStatic(entries);
        if (gnssStatic) {
            html += `<div style="margin-top:4px;">GNSS DRMS: <b>${gnssStatic.drms.toFixed(2)}м</b> | Ср. скорость: <b>${gnssStatic.avgSpeed.toFixed(2)} м/с</b> (n=${gnssStatic.points})</div>`;
        }

        return html;
    }

    return {
        analyze,
        findHeadingJumps,
        findGNSSGaps,
        findMaxHeadingRate,
        formatReport,
        calcBeaconSTD,
        calcHeadingRMS,
        calcGNSSStatic,
    };

})();