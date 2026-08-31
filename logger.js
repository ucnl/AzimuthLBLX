// logger.js — Запись и воспроизведение логов обмена с устройством
// v3: с ускорением и пропуском пустого времени

const Logger = (() => {

    // ========== СОСТОЯНИЕ ==========
    let entries = [];            // кольцевой буфер в памяти
    let isRecording = false;
    let startTime = null;
    const MAX_MEMORY_ENTRIES = 10000;

    // Playback
    let playbackTimer = null;
    let playbackIndex = 0;
    let isPlaying = false;
    let playbackSpeed = 1.0;
    let playbackRealtime = true;
    let playbackStartReal = 0;
    let playbackStartLog = 0;
    let playbackLastProcessedTime = 0;
    
    // Скорости воспроизведения (preset)
    const SPEEDS = [1.0, 2.0, 4.0, 8.0];
    let currentSpeedIndex = 0;

    // Callbacks
    let onEntry = null;
    let onPlaybackStart = null;
    let onPlaybackEnd = null;
    let onPlaybackProgress = null;
    let onPlaybackSpeedChange = null;

    // ========== ФОРМАТИРОВАНИЕ ==========

    function formatTimestamp(date) {
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        const ms = String(date.getMilliseconds()).padStart(3, '0');
        return `${h}:${m}:${s}.${ms}`;
    }

    function parseTimestamp(str) {
        const parts = str.split(':');
        if (parts.length !== 3) return NaN;
        const h = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        const secMs = parts[2].split('.');
        const s = parseInt(secMs[0]);
        const ms = secMs[1] ? parseInt(secMs[1].padEnd(3, '0')) : 0;
        return h * 3600 + m * 60 + s + ms / 1000;
    }

    // ========== ПОИСК ПЕРВОЙ ТОЧКИ МАЯКА ==========
    
	function findFirstBeaconDataIndex(offsetBack = 10) {
		let firstBeaconIndex = -1;
		
		// Сначала находим первую точку маяка
		for (let i = 0; i < entries.length; i++) {
			const e = entries[i];
			
			if (e.type === 'header') continue;
			
			if (e.type === 'incoming' && e.port && e.port.includes('AZM') && e.data) {
				const parsed = AZMParser.parse(e.data);
				if (parsed && parsed.type === 'ndta' && parsed.status === 1) {
					firstBeaconIndex = i;
					console.log('[Logger] Найдена первая точка маяка (status=1) на индексе', firstBeaconIndex);
					break;
				}
			}
		}
		
		if (firstBeaconIndex === -1) {
			// Если нет точек маяка, стартуем с первой не-header записи
			for (let i = 0; i < entries.length; i++) {
				if (entries[i].type !== 'header') {
					console.log('[Logger] Точек маяка нет, старт с индекса', i);
					return i;
				}
			}
			return 0;
		}
		
		// Отступаем назад на 10 записей, но не меньше 0
		let startIndex = firstBeaconIndex - 10;
		if (startIndex < 0) startIndex = 0;
		
		// Дополнительно проверяем, чтобы не начать с header
		while (startIndex < entries.length && entries[startIndex].type === 'header') {
			startIndex++;
		}
		
		console.log('[Logger] Старт с индекса', startIndex, '(отступ от точки маяка:', firstBeaconIndex - startIndex, 'записей)');
		return startIndex;
	}

    // ========== ЗАПИСЬ ==========

    async function startRecording() {
        entries = [];
        startTime = new Date();
        isRecording = true;

        try { await LogStorage.clear(); } catch (e) {}

        const day = String(startTime.getDate()).padStart(2, '0');
        const month = String(startTime.getMonth() + 1).padStart(2, '0');
        const year = startTime.getFullYear();
        const time = formatTimestamp(startTime);

        const header = `<Log started at ${day}-${month}-${year}, ${time}>`;
        entries.push({
            type: 'header',
            text: header,
            timestamp: 0,
            formatted: header,
        });
        LogStorage.write(header);
    }

    function stopRecording() {
        isRecording = false;
    }

    function _addToMemory(entry) {
        entries.push(entry);
        if (entries.length > MAX_MEMORY_ENTRIES) {
            entries.shift();
        }
    }

    function _addEntry(type, level, port, direction, data) {
        if (!startTime) startTime = new Date();
        const ts = Date.now() - startTime.getTime();
        const timeStr = formatTimestamp(new Date(startTime.getTime() + ts));
        let formatted;

        if (port) {
            formatted = `${timeStr}: ${level}: ${port} ${direction} ${data}`;
        } else {
            formatted = `${timeStr}: ${level}: ${data}`;
        }

        const entry = { type, level, port, direction, data, timestamp: ts, formatted };
        _addToMemory(entry);

        if (isRecording) {
            LogStorage.write(formatted);
        }
    }

    function logIncoming(port, data) {
        _addEntry('incoming', 'INFO', port, '>>', data);
    }

    function logOutgoing(port, data) {
        _addEntry('outgoing', 'INFO', port, '<<', data);
    }

    function logMessage(level, message) {
        _addEntry('message', level, null, null, message);
    }

    function logInfo(msg) { logMessage('INFO', msg); }
    function logError(msg) { logMessage('ERROR', msg); }
    function logWarning(msg) { logMessage('WARNING', msg); }

    // ========== ЭКСПОРТ ==========

    async function exportLog() {
        try {
            const lines = await LogStorage.readAll();
            if (lines.length > 0) return lines.join('\n');
        } catch (e) {
            console.warn('[Logger] Ошибка чтения из IndexedDB:', e);
        }
        return entries.map(e => e.formatted || e.text || '').join('\n');
    }

    async function downloadLog(filename) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        filename = filename || `zima2_log_${ts}.log`;
        const text = await exportLog();
        if (!text || text.length < 50) {
            alert('Лог пуст или слишком короткий');
            return;
        }
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== ИМПОРТ ==========

    function parseLogLine(line) {
        const idx = line.indexOf(': ');
        if (idx < 0) return null;

        const timeStr = line.substring(0, idx);
        const rest = line.substring(idx + 2);
        const ts = parseTimestamp(timeStr);
        if (isNaN(ts)) return null;

        const levelMatch = rest.match(/^(\w+):\s*(.*)$/);
        if (!levelMatch) return null;

        const level = levelMatch[1];
        const content = levelMatch[2];

        const portMatch = content.match(/^(.+?)\s*(>>|<<)\s*(.+)$/);
        if (portMatch) {
            return {
                type: portMatch[2] === '>>' ? 'incoming' : 'outgoing',
                level,
                port: portMatch[1],
                direction: portMatch[2],
                data: portMatch[3],
                timestamp: ts,
                formatted: line,
            };
        }

        return {
            type: 'message',
            level,
            message: content,
            timestamp: ts,
            formatted: line,
        };
    }

    function importLog(text) {
        stopPlayback();
        entries = [];

        const lines = text.split('\n');
        let baseSeconds = 0;
        let prevSeconds = 0;
        let cumulativeTime = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('<Log started at')) {
                const dateMatch = trimmed.match(/<Log started at (\d{2})-(\d{2})-(\d{4}),/);
                if (dateMatch) {
                    const day = parseInt(dateMatch[1]);
                    const month = parseInt(dateMatch[2]) - 1;
                    const year = parseInt(dateMatch[3]);
                    baseSeconds = new Date(year, month, day).getTime() / 1000;
                }
                entries.push({
                    type: 'header', text: trimmed,
                    timestamp: 0, formatted: trimmed,
                });
                prevSeconds = 0;
                cumulativeTime = 0;
                continue;
            }

            const parsed = parseLogLine(trimmed);
            if (parsed) {
                if (entries.length <= 1) {
                    cumulativeTime = 0;
                    prevSeconds = parsed.timestamp;
                } else {
                    const diff = parsed.timestamp - prevSeconds;
                    if (diff >= 0) cumulativeTime += diff;
                    prevSeconds = parsed.timestamp;
                }
                parsed.timestamp = cumulativeTime * 1000;
                entries.push(parsed);
            }
        }

        return entries.length;
    }

    function loadLogFromFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.log,.txt';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) { reject('No file'); return; }
                const reader = new FileReader();
                reader.onload = () => {
                    const count = importLog(reader.result);
                    resolve(count);
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file);
            };
            input.click();
        });
    }

    // ========== ВОСПРОИЗВЕДЕНИЕ ==========

	function startPlayback(speed = 1.0, realtime = true, skipToFirstData = false) {
		if (entries.length === 0) return false;
		stopPlayback();

		playbackSpeed = speed;
		playbackRealtime = realtime;
		
		// Поиск индекса первой точки маяка
		if (skipToFirstData) {
			playbackIndex = findFirstBeaconDataIndex();
			console.log('[Logger] Старт с индекса (с пропуском):', playbackIndex);
		} else {
			playbackIndex = 0;
			while (playbackIndex < entries.length && entries[playbackIndex].type === 'header') {
				playbackIndex++;
			}
			console.log('[Logger] Старт с индекса (без пропуска):', playbackIndex);
		}
		
		isPlaying = true;
		playbackStartReal = Date.now();
		
		// Находим первую не-header запись для начала отсчёта
		let firstEntry = entries[playbackIndex];
		while (firstEntry && firstEntry.type === 'header') {
			playbackIndex++;
			firstEntry = entries[playbackIndex];
		}
		
		if (firstEntry) {
			playbackStartLog = firstEntry.timestamp;
			playbackLastProcessedTime = firstEntry.timestamp;
		} else {
			playbackStartLog = 0;
			playbackLastProcessedTime = 0;
		}

		if (onPlaybackStart) onPlaybackStart();
		if (onPlaybackProgress) onPlaybackProgress(playbackIndex, entries.length);

		_playNext();
		return true;
	}
    
    // Установка скорости воспроизведения
    function setPlaybackSpeed(speed) {
        if (!isPlaying) {
            playbackSpeed = Math.max(0.5, Math.min(16, speed));
            return;
        }
        
        // Пересчитываем базовое время при смене скорости
        const now = Date.now();
        const elapsedReal = (now - playbackStartReal);
        const virtualOffset = elapsedReal * playbackSpeed;
        
        playbackStartReal = now;
        playbackStartLog = playbackStartLog + virtualOffset;
        playbackSpeed = Math.max(0.5, Math.min(16, speed));
        
        if (onPlaybackSpeedChange) onPlaybackSpeedChange(playbackSpeed);
    }
    
    // Переключение на следующую предустановленную скорость
    function nextPlaybackSpeed() {
        currentSpeedIndex = (currentSpeedIndex + 1) % SPEEDS.length;
        const newSpeed = SPEEDS[currentSpeedIndex];
        setPlaybackSpeed(newSpeed);
        return newSpeed;
    }
    
    function getCurrentPlaybackSpeed() {
        return playbackSpeed;
    }
    
    function getPlaybackSpeedText() {
        return playbackSpeed.toFixed(0) + 'x';
    }

    function stopPlayback() {
        isPlaying = false;
        if (playbackTimer) {
            clearTimeout(playbackTimer);
            playbackTimer = null;
        }
        playbackIndex = 0;
        currentSpeedIndex = 0;
    }

	function _playNext() {
		if (!isPlaying || playbackIndex >= entries.length) {
			isPlaying = false;
			if (onPlaybackEnd) onPlaybackEnd();
			return;
		}

		while (playbackIndex < entries.length && entries[playbackIndex].type === 'header') {
			playbackIndex++;
		}

		if (playbackIndex >= entries.length) {
			isPlaying = false;
			if (onPlaybackEnd) onPlaybackEnd();
			return;
		}

		const current = entries[playbackIndex];
		playbackIndex++;

		if (onPlaybackProgress) {
			onPlaybackProgress(playbackIndex, entries.length);
		}

		// ВСЕГДА оригинальное время из лога
		const originalTime = new Date(playbackStartLog + current.timestamp);
		
		if (onEntry && current.type !== 'header') {
			onEntry(
				current.data || current.message || '', 
				current.timestamp, 
				originalTime,   // теперь это оригинальное время
				current
			);
		}
		
		if (playbackIndex < entries.length) {
			let next = entries[playbackIndex];
			while (next && next.type === 'header' && playbackIndex < entries.length) {
				playbackIndex++;
				next = entries[playbackIndex];
			}
			
			if (next) {
				const logDelay = (next.timestamp - current.timestamp) / playbackSpeed;
				const realDelay = Math.max(1, Math.min(logDelay, 1000));
				playbackTimer = setTimeout(_playNext, realDelay);
			} else {
				isPlaying = false;
				if (onPlaybackEnd) onPlaybackEnd();
			}
		} else {
			isPlaying = false;
			if (onPlaybackEnd) onPlaybackEnd();
		}
	}

    // ========== СТАТИСТИКА ==========

    function getEntryCount() { return entries.length; }
    function getEntries() { return entries; }

    function getRecordingStatus() {
        return {
            isRecording, isPlaying,
            entryCount: entries.length,
            playbackIndex, playbackSpeed,
            currentSpeedIndex,
        };
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    function debugEntries(n) {
        n = n || 10;
        const slice = entries.slice(0, n);
        console.log(`=== Logger entries (first ${n} of ${entries.length}) ===`);
        slice.forEach((e, i) => {
            console.log(`${i}: type="${e.type}" | ${e.formatted?.substring(0, 80) || '(no formatted)'}`);
        });
        const types = {};
        entries.forEach(e => { types[e.type] = (types[e.type] || 0) + 1; });
        console.log('Type counts:', types);
    }

    return {
        startRecording, stopRecording,
        logIncoming, logOutgoing,
        logInfo, logError, logWarning,

        exportLog, downloadLog,
        importLog, loadLogFromFile,

        startPlayback, stopPlayback,
        setPlaybackSpeed, nextPlaybackSpeed,
        getCurrentPlaybackSpeed, getPlaybackSpeedText,
        findFirstBeaconDataIndex,

        get onEntry() { return onEntry; },
        set onEntry(fn) { onEntry = fn; },
        get onPlaybackStart() { return onPlaybackStart; },
        set onPlaybackStart(fn) { onPlaybackStart = fn; },
        get onPlaybackEnd() { return onPlaybackEnd; },
        set onPlaybackEnd(fn) { onPlaybackEnd = fn; },
        get onPlaybackProgress() { return onPlaybackProgress; },
        set onPlaybackProgress(fn) { onPlaybackProgress = fn; },
        get onPlaybackSpeedChange() { return onPlaybackSpeedChange; },
        set onPlaybackSpeedChange(fn) { onPlaybackSpeedChange = fn; },

        getEntryCount, getEntries, getRecordingStatus,
        debugEntries,
        SPEEDS,
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
}