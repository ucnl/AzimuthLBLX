// export.js — Экспорт данных VLBL в CSV и KML

const ExportManager = (() => {

    // ========== ВСПОМОГАТЕЛЬНЫЕ ==========
    function getTimestamp() {
        return new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    }

    function downloadBlob(content, mimeType, filename) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== CSV: ТРЕК СУДНА ==========
    function exportStationTrackCSV() {
        const track = MeasurementsStore.stationTrack;
        if (track.length === 0) {
            alert('Нет данных трека судна');
            return;
        }

        const lines = ['time,latitude,longitude'];
        for (const p of track) {
            const ts = new Date(p.ts).toISOString();
            lines.push(`${ts},${p.lat.toFixed(8)},${p.lon.toFixed(8)}`);
        }

        downloadBlob(lines.join('\n'), 'text/csv', `station_track_${getTimestamp()}.csv`);
    }

    // ========== CSV: ИЗМЕРЕНИЯ ==========
    function exportMeasurementsCSV() {
        const allMeasurements = MeasurementsStore.getAllMeasurements();
        const addrs = Object.keys(allMeasurements);

        if (addrs.length === 0) {
            alert('Нет данных измерений');
            return;
        }

        const lines = ['time,beacon_address,latitude,longitude,antenna_depth_m,beacon_depth_m,range_m'];
        
        for (const addr of addrs) {
            const measurements = allMeasurements[addr];
            const items = measurements.getAll();
            for (const m of items) {
                const ts = new Date(m.ts).toISOString();
                const userAddr = parseInt(addr) + 1;
                lines.push(`${ts},${userAddr},${m.lat.toFixed(8)},${m.lon.toFixed(8)},${m.depth.toFixed(2)},${m.beaconDepth.toFixed(2)},${m.range.toFixed(2)}`);
            }
        }

        downloadBlob(lines.join('\n'), 'text/csv', `measurements_${getTimestamp()}.csv`);
    }

    // ========== CSV: РЕШЕНИЯ ==========
    function exportSolutionsCSV() {
        const solutionsHistory = {};
		const allSolutions = MeasurementsStore.getAllSolutions();
		const addrs = Object.keys(allSolutions);

        if (addrs.length === 0) {
            alert('Нет данных решений');
            return;
        }

        const lines = ['beacon_address,latitude,longitude,depth_m,radial_error_m,hdop,pdop,gdop,vdop,tdop,max_angular_gap_deg,quality,time'];

        for (const addr of addrs) {
			const history = MeasurementsStore.getSolutionsHistory(parseInt(addr));
			const userAddr = parseInt(addr) + 1;
			
			if (history.length > 0) {
				for (let i = 0; i < history.length; i++) {
					const s = history[i];
					const ts = new Date(s.ts).toISOString();
					const isBest = (i === 0) ? 'BEST' : '';
					lines.push(`${userAddr},${s.latDeg.toFixed(8)},${s.lonDeg.toFixed(8)},${s.depthM?.toFixed(2) || ''},${s.radialError?.toFixed(2) || ''},${s.hdop?.toFixed(2) || ''},${s.pdop?.toFixed(2) || ''},${s.gdop?.toFixed(2) || ''},${s.vdop?.toFixed(2) || ''},${s.tdop?.toFixed(2) || ''},${s.maxAngularGap?.toFixed(1) || ''},${s.quality || ''},${isBest},${ts}`);
				}
			}
		}

        downloadBlob(lines.join('\n'), 'text/csv', `solutions_${getTimestamp()}.csv`);
    }

    // ========== KML: ВСЁ ВМЕСТЕ ==========
	function exportKML() {
		const track = MeasurementsStore.stationTrack;
		const allMeasurements = MeasurementsStore.getAllMeasurements();
		const solutions = MeasurementsStore.getAllSolutions();

		if (track.length === 0 && Object.keys(allMeasurements).length === 0 && Object.keys(solutions).length === 0) {
			alert('Нет данных для экспорта');
			return;
		}

		let kml = `<?xml version="1.0" encoding="UTF-8"?>
	<kml xmlns="http://www.opengis.net/kml/2.2">
	  <Document>
		<name>VLBL Survey</name>
		<Style id="stationStyle">
		  <LineStyle><color>ff00ffff</color><width>3</width></LineStyle>
		</Style>
		<Style id="measurementStyle">
		  <IconStyle>
			<color>ff00ff00</color>
			<scale>0.6</scale>
			<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
		  </IconStyle>
		</Style>
		<Style id="basePointStyle">
		  <IconStyle>
			<color>ffff00ff</color>
			<scale>0.8</scale>
			<Icon><href>http://maps.google.com/mapfiles/kml/shapes/star.png</href></Icon>
		  </IconStyle>
		</Style>
		<Style id="solutionStyle">
		  <IconStyle>
			<color>ff0000ff</color>
			<scale>1.0</scale>
			<Icon><href>http://maps.google.com/mapfiles/kml/pushpin/red-pushpin.png</href></Icon>
		  </IconStyle>
		</Style>
		<Style id="poiStyle">
		  <IconStyle>
			<color>ff0080ff</color>
			<scale>1.0</scale>
			<Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon>
		  </IconStyle>
		</Style>
	`;

		// Трек судна
		if (track.length >= 2) {
			let coords = '';
			for (const p of track) {
				coords += `${p.lon.toFixed(8)},${p.lat.toFixed(8)},0 `;
			}
			kml += `
		<Placemark>
		  <name>Station Track</name>
		  <styleUrl>#stationStyle</styleUrl>
		  <LineString>
			<tessellate>1</tessellate>
			<coordinates>${coords.trim()}</coordinates>
		  </LineString>
		</Placemark>`;
		}

			// Измерения (LineString для каждого маяка)
			for (const addr in allMeasurements) {
				const userAddr = parseInt(addr) + 1;
				const items = allMeasurements[addr].getAll();
				
				if (items.length >= 2) {
					let coords = '';
					for (const m of items) {
						coords += `${m.lon.toFixed(8)},${m.lat.toFixed(8)},0 `;
					}
					kml += `
			<Placemark>
			  <name>Measurements #${userAddr} (${items.length} точек)</name>
			  <styleUrl>#measurementStyle</styleUrl>
			  <LineString>
				<tessellate>1</tessellate>
				<coordinates>${coords.trim()}</coordinates>
			  </LineString>
			</Placemark>`;
				}

				// Базовые точки
				try {
					const base = allMeasurements[addr].getBase();
					for (const bp of base) {
						kml += `
			<Placemark>
			  <name>B#${userAddr}</name>
			  <styleUrl>#basePointStyle</styleUrl>
			  <Point>
				<coordinates>${bp.lon.toFixed(8)},${bp.lat.toFixed(8)},0</coordinates>
			  </Point>
			</Placemark>`;
					}
				} catch (e) {
					// База не существует
				}
			}

		// Решения
		for (const addr in solutions) {
			const s = solutions[addr];
			const userAddr = parseInt(addr) + 1;
			kml += `
		<Placemark>
		  <name>SOLUTION #${userAddr}</name>
		  <description>
			DRMS: ${s.radialError?.toFixed(2) || '--'} m
			HDOP: ${s.hdop?.toFixed(2) || '--'}
			Quality: ${s.quality || '--'}
			Depth: ${s.depthM?.toFixed(1) || '--'} m
		  </description>
		  <styleUrl>#solutionStyle</styleUrl>
		  <Point>
			<coordinates>${s.lonDeg.toFixed(8)},${s.latDeg.toFixed(8)},${s.depthM ? -s.depthM.toFixed(1) : 0}</coordinates>
		  </Point>
		</Placemark>`;
		}

		// POI
		if (typeof POIManager !== 'undefined') {
			const poiPoints = POIManager.getAll();
			for (const poi of poiPoints) {
				const alt = (poi.depth != null && !isNaN(poi.depth)) ? -poi.depth : 0;
				kml += `
		<Placemark>
		  <name>${poi.name}</name>
		  <description>Тип: ${poi.type === 'marked' ? 'Отмечена оператором' : 'Загружена из CSV'}
	Глубина: ${poi.depth != null ? poi.depth.toFixed(1) + ' м' : '--'}</description>
		  <styleUrl>#poiStyle</styleUrl>
		  <Point>
			<coordinates>${poi.lon.toFixed(8)},${poi.lat.toFixed(8)},${alt}</coordinates>
		  </Point>
		</Placemark>`;
			}
		}

		kml += `
	  </Document>
	</kml>`;

		downloadBlob(kml, 'application/vnd.google-earth.kml+xml', `vlbl_survey_${getTimestamp()}.kml`);
	}

    // ========== ЭКСПОРТ ==========
    return {
        exportStationTrackCSV,
        exportMeasurementsCSV,
        exportSolutionsCSV,
        exportKML,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportManager;
}