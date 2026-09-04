// app.js — Главный модуль приложения AzimuthLBLX
// VLBL Survey Tool: сбор измерений и определение положения маяков-ответчиков

const App = (() => {

    const APP_VERSION = '0.2.0';

    // ========== DOM-ЭЛЕМЕНТЫ ==========
    let canvas, ctx;
    let mapContainer, beaconsBar, scaleBarEl;
    let connectionIndicator, statusText, deviceLabel;
    let btnConnection, btnInterrogation, btnSettings, btnGnss;
    let btnAutoScale, btnClearData, btnSolve;
    let playbackProgress, playbackProgressFill;
    let activeDropdown = null;

    let lastMouseX = 0, lastMouseY = 0;

    // ========== СОСТОЯНИЕ ==========
    let serialBridge = null;
    let isConnected = false;
    let ageTimer = null;
    let gnssBridge = null;
    let isGnssConnected = false;
	
	let internalGNSSWatchId = null;
	let hasExternalHeading = false;
		
	let vlblWorker = null;
	let solveRequestCounter = 0;
	const pendingSolveRequests = new Map(); // { requestId: {addr} }
	let autoSolveCount = 10;          // решать каждые N новых измерений
	
	let autoSolveMinIntervalMs = 3000; // минимальный интервал между решениями
	let lastAutoSolveTime = {};
	let lastAutoSolveCount = {};
		
	const PLAYBACK_SPEEDS = [1, 2, 4, 8]; 

    // ========== ВСПОМОГАТЕЛЬНЫЕ ==========

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function setStatus(msg) {
        if (statusText) statusText.textContent = msg;
        console.log('[App]', msg);
    }

    function toggleDropdown(id) {
        const menu = document.getElementById(id);
        if (activeDropdown && activeDropdown !== menu) {
            activeDropdown.style.display = 'none';
        }
        if (menu.style.display === 'block') {
            menu.style.display = 'none';
            activeDropdown = null;
        } else {
            menu.style.display = 'block';
            activeDropdown = menu;
        }
    }

    function closeAllDropdowns() {
        if (activeDropdown) {
            activeDropdown.style.display = 'none';
            activeDropdown = null;
        }
    }

    function cycleTheme() {
        const themeName = Themes.cycleTheme();
        setStatus('Тема: ' + themeName);
    }

    // ========== ИНИЦИАЛИЗАЦИЯ ==========

    function init() {
        document.getElementById('app-version').textContent = APP_VERSION;
        LogStorage.open().catch(e => console.warn('IndexedDB:', e));
        console.log('[App] Инициализация...');

        canvas = document.getElementById('map-canvas');
        ctx = canvas.getContext('2d');
        mapContainer = document.getElementById('map-container');
        beaconsBar = document.getElementById('beacons-bar');
        scaleBarEl = document.getElementById('scale-bar');

        connectionIndicator = document.getElementById('connection-indicator');
        statusText = document.getElementById('status-text');
        deviceLabel = document.getElementById('device-label');

        btnConnection = document.getElementById('btn-connection');
        btnInterrogation = document.getElementById('btn-interrogation');
        btnGnss = document.getElementById('btn-gnss');
        btnSettings = document.getElementById('btn-settings');
        btnAutoScale = document.getElementById('btn-auto-scale');
        btnClearData = document.getElementById('btn-clear-data');
        btnSolve = document.getElementById('btn-solve');

        playbackProgress = document.getElementById('playback-progress');
        playbackProgressFill = document.getElementById('playback-progress-fill');

        if (!canvas || !ctx) {
            console.error('[App] Canvas не найден!');
            return;
        }

        // Логгер
        Logger.onEntry = onLogEntry;
        Logger.onPlaybackStart = onPlaybackStart;
        Logger.onPlaybackEnd = onPlaybackEnd;
        Logger.onPlaybackProgress = onPlaybackProgress;
		
		initVLBLWorker();

        window.addEventListener('resize', () => UICanvas.resizeCanvas());
		window.addEventListener('native-gnss-update', () => {
			if (window._nativeGNSS) {
				const g = window._nativeGNSS;
				VLBLManager.getState().currentLat = g.lat;
				VLBLManager.getState().currentLon = g.lon;
				VLBLManager.getState().speedMps = g.speed || 0;
				VLBLManager.getState().courseDeg = g.course || NaN;
				MeasurementsStore.addStationPoint(g.lat, g.lon, new Date());
				updateAntennaInfoUI();
			}
		});
		window.addEventListener('native-compass-update', () => {
			if (window._nativeCompass) {
				const heading = window._nativeCompass.heading;
				// Обновляем heading только если нет внешнего GNSS с компасом
				if (!isGnssConnected || !hasExternalHeading) {
					VLBLManager.getState().antennaHeadingDeg = heading;
					updateAntennaInfoUI();
				}
			}
		});
		
		
        initMouseHandlers();
		initTouchHandlers();
        loadSettings();

        document.addEventListener('click', function(e) {
            if (!e.target.closest('.dropdown')) {
                closeAllDropdowns();
            }
        });

        Themes.init();

        // Инициализация UICanvas
        UICanvas.init(canvas, mapContainer, {
            getThemes: () => Themes,
            setStatus: (msg) => setStatus(msg),
        });

        // Инициализация UIVLBL
        UIVLBL.init('beacons-bar', {
            setStatus: (msg) => setStatus(msg),
        });
		
		// Инициализация эмулятора
		Emulator.init({
			onUpdate: () => {
				updateAntennaInfoUI();
				UIVLBL.updateBeaconsBar();
			},
		});
		
		// Инициализация линейки
		UIRuler.init(canvas, ctx, {
			getOffsetX: () => UICanvas.getOffset().x,
			getOffsetY: () => UICanvas.getOffset().y,
			getScale: () => UICanvas.getScale(),
			getAnchor: () => {
				const track = MeasurementsStore.stationTrack;
				if (track.length > 0) {
					return { lat: track[0].lat, lon: track[0].lon };
				}
				return null;
			},
			drawCallback: () => UICanvas.drawAll(),
			setStatus: (msg) => setStatus(msg),
		});

        // Инициализация UISettings
        UISettings.init('settings-overlay', {
            getSettingsData: () => updateSettingsUI(),
            applySettingsData: () => applySettings(),
            loadSettingsData: () => loadSettings(),
        });
        UISettings.buildAddressCheckboxes();
		MeasurementsStore.loadSolutionsFromStorage();		
		
		if (typeof POIManager !== 'undefined') {
			POIManager.load();
		}
		document.getElementById('btn-speed-down').onclick = () => decreasePlaybackSpeed();
		document.getElementById('btn-speed-up').onclick = () => increasePlaybackSpeed();

        updateAllButtons();
		updateAutoScaleButton();
        updateSettingsUI();
        updateAntennaInfoUI();

        requestAnimationFrame(renderLoop);
        ageTimer = setInterval(tickAll, 1000);

        console.log('[App] Инициализация завершена');
    }

	function initVLBLWorker() {
		if (!window.Worker) {
			console.warn('[App] Web Worker не поддерживается, синхронный режим');
			vlblWorker = null;
			return;
		}

		try {
			vlblWorker = new Worker('vlbl-worker.js');
			vlblWorker.onmessage = onVLBLWorkerMessage;
			vlblWorker.onerror = (e) => {
				console.error('[VLBL Worker] Ошибка:', e.message);
				pendingSolveRequests.clear();
			};
			console.log('[App] VLBL Worker запущен');
		} catch (e) {
			console.warn('[App] Worker недоступен (file://?), синхронный режим:', e.message);
			vlblWorker = null;
		}
	}

	function onVLBLWorkerMessage(e) {
		const { action, requestId, result, error, results, errors } = e.data;

		if (action === 'solve_result') {
			const pending = pendingSolveRequests.get(requestId);
			if (pending) {
				const { addr } = pending;
				result.depthM = VLBLManager.getBeacons()[addr]?.depthM || 0;
				MeasurementsStore.setSolution(addr, result);
				pendingSolveRequests.delete(requestId);
				UIVLBL.updateBeaconsBar();
				UICanvas.drawAll();
			}
		} else if (action === 'solve_error') {
			console.error('[VLBL Worker] Ошибка решения:', error);
			pendingSolveRequests.delete(requestId);
		} else if (action === 'solve_all_result') {
			// Обработка множественного решения
			for (const addr in results) {
				const result = results[addr];
				result.depthM = VLBLManager.getBeacons()[addr]?.depthM || 0;
				MeasurementsStore.setSolution(addr, result);
			}
			MeasurementsStore.saveSolutionsToStorage();
			for (const addr in errors) {
				console.warn(`[VLBL Worker] Маяк #${parseInt(addr)+1}: ${errors[addr]}`);
			}
			pendingSolveRequests.delete(requestId);
			UIVLBL.updateBeaconsBar();
			UICanvas.autoScale();
			
			const solvedCount = Object.keys(results).length;
			if (solvedCount > 0) {
				setStatus(`Решено маяков: ${solvedCount}`);
			} else {
				setStatus('Недостаточно данных для решения');
			}
		} else if (action === 'pong') {
			console.log('[App] VLBL Worker отвечает');
		}
	}

    // ========== ТАЙМЕР ==========

    function tickAll() {
        VLBLManager.tickAge();
    }

    function renderLoop() {
        UICanvas.drawAll();
        requestAnimationFrame(renderLoop);
    }

    // ========== ПОДКЛЮЧЕНИЕ ZIMA ==========

    async function connectSerial() {
        if (serialBridge) {
            try {
                if (VLBLManager.getState().isInterrogationActive) {
                    await serialBridge.send(VLBLManager.getStopCommand());
                    await sleep(100);
                }
                await serialBridge.close();
            } catch (e) {}
            serialBridge = null;
        }

        try {
            setStatus('Подключение...');
            serialBridge = new SerialBridge();
            serialBridge.onMessage = onSerialMessage;
            serialBridge.onError = onSerialError;
            serialBridge.onClose = onSerialClose;

            await serialBridge.open(9600);
            await Logger.startRecording();
            Logger.logInfo('AZM Starting...');

            isConnected = true;
            updateAllButtons();
            connectionIndicator.className = 'connected';
            setStatus('Подключено. Запрос информации...');
            deviceLabel.textContent = 'Zima2 LBL';

            await sleep(500);

            if (serialBridge && serialBridge.isOpen) {
                const cmd = VLBLManager.getDINFOCommand();
                Logger.logOutgoing('AZM', cmd.trim());
                await serialBridge.send(cmd);
            }
        } catch (err) {
            console.error('[App] Ошибка подключения:', err);
            if (serialBridge) {
                try { await serialBridge.close(); } catch (e) {}
                serialBridge = null;
            }
            isConnected = false;
            updateAllButtons();
            connectionIndicator.className = '';
            setStatus('Ошибка: ' + err.message);
        }
    }

    async function disconnectSerial() {
        setStatus('Отключение...');
        Logger.stopRecording();

        if (serialBridge) {
            try {
                if (VLBLManager.getState().isInterrogationActive) {
                    const cmd = VLBLManager.getStopCommand();
                    Logger.logOutgoing('AZM', cmd.trim());
                    await serialBridge.send(cmd);
                    await sleep(200);
                }
                await serialBridge.close();
            } catch (e) {}
            serialBridge = null;
        }

        onSerialClose();
        updateAllButtons();

        const count = Logger.getEntryCount();
        if (count > 10) {
            if (confirm(`Сессия завершена. ${count} записей в логе.\nСохранить лог?`)) {
                await Logger.downloadLog();
            }
        }
    }

    function onSerialMessage(rawLine) {
        const line = rawLine.trim();
        Logger.logIncoming('AZM', line);
		
		if (lblSolverPending) {
			if (line.startsWith('$PAZMA,')) {
				// Устройство вернуло конфигурацию
				lblSolverPending = false;
				if (lblSolverTimeout) {
					clearTimeout(lblSolverTimeout);
					lblSolverTimeout = null;
				}
				setStatus('✓ Конфигурация LBL решателя применена');
				closeLBLSolver();
				return;
			}
			
			if (line.startsWith('$PAZM0,')) {
				// ACK с ошибкой
				const ack = AZMParser.parse(line);
				if (ack && ack.type === 'ack') {
					lblSolverPending = false;
					if (lblSolverTimeout) {
						clearTimeout(lblSolverTimeout);
						lblSolverTimeout = null;
					}
					
					if (ack.result === 0) {
						setStatus('✓ OK');
					} else {
						setStatus('✗ Ошибка: код ' + ack.result);
					}
					return;
				}
			}
		}
			

        const result = VLBLManager.processRawLine(line);
        if (!result) return;

        switch (result.type) {
            case 'dinfo':
                handleDINFO(result.data);
                break;
            case 'strstp':
                handleSTRSTP(result.data);
                break;
            case 'ndta_result':
                updateAntennaInfoUI();
                if (result.beacon) handleBeaconUpdate(result.beacon);
                break;
        }
    }

    function handleDINFO(info) {
        const typeNames = { 0: 'USBL', 1: 'Маяк-ответчик', 2: 'LBL' };
        let label = `Zima2 ${typeNames[info.deviceType] || ''}`.trim();
        if (info.serialNumber) label += ` [${info.serialNumber}]`;

        deviceLabel.textContent = label;
        setStatus('Устройство обнаружено. Запуск опроса...');
        loadSettings();

        if (serialBridge && isConnected) {
            const cmd = VLBLManager.getStartCommand();
            Logger.logOutgoing('AZM', cmd.trim());
            serialBridge.send(cmd);
        }
    }

    function handleSTRSTP(data) {
        const isActive = data.addrMask !== 0;
        if (isActive) {
            setStatus('Опрос активен');
            connectionIndicator.className = 'connected active';
        } else {
            setStatus('Опрос остановлен');
            connectionIndicator.className = 'connected';
        }
        updateAllButtons();
    }

    function handleBeaconUpdate(beacon) {
        if (!beacon) return;
        if (!isNaN(beacon.slantRangeM) && beacon.slantRangeM > 0) {
            // Получаем текущую позицию от GNSS
            const st = VLBLManager.getState();
            if (!isNaN(st.currentLat) && !isNaN(st.currentLon)) {
                MeasurementsStore.addMeasurement(
                    beacon.address,
                    st.currentLat,
                    st.currentLon,
                    st.antennaDepthM || 0,
                    beacon.depthM || 0,
                    beacon.slantRangeM,
                    new Date()
                );
				checkAutoSolve(beacon.address);
            }
        }
        UIVLBL.updateBeaconsBar();
    }

    function onSerialError(error) {
        console.error('[App] Ошибка порта:', error);
        Logger.logError(error.message);
        setStatus('Ошибка порта: ' + error.message);
    }

    function onSerialClose() {
        isConnected = false;
        serialBridge = null;
        connectionIndicator.className = '';
        setStatus('Не подключено');
        deviceLabel.textContent = 'Zima2 LBL';
        VLBLManager.reset();
        updateAllButtons();
    }

    // ========== ПОДКЛЮЧЕНИЕ GNSS ==========

    async function connectGNSS() {
        if (gnssBridge) {
            try { await gnssBridge.close(); } catch (e) {}
            gnssBridge = null;
        }

        try {
            setStatus('Подключение GNSS...');
            gnssBridge = new SerialBridge();
            gnssBridge.onMessage = onGnssMessage;
            gnssBridge.onError = (e) => {
                console.error('[GNSS] Ошибка:', e.message);
                Logger.logError('GNSS: ' + e.message);
            };
            gnssBridge.onClose = () => {
                isGnssConnected = false;
                updateAllButtons();
                Logger.logInfo('GNSS disconnected');
            };

            const saved = localStorage.getItem('lblx_settings');
            const gnssBaud = saved ? (JSON.parse(saved).gnssBaudrate || 38400) : 38400;
            await gnssBridge.open(gnssBaud);

            isGnssConnected = true;
            updateAllButtons();
			updateGNSSButton();
            Logger.logInfo('GNSS connected at ' + gnssBaud);
            setStatus('GNSS подключен (' + gnssBaud + ')');
        } catch (e) {
            Logger.logError('GNSS: ' + e.message);
            setStatus('Ошибка GNSS: ' + e.message);
            updateAllButtons();
        }
    }

    async function disconnectGNSS() {
        if (gnssBridge) {
            await gnssBridge.close();
            gnssBridge = null;
        }
        isGnssConnected = false;
		hasExternalHeading = false;
        updateAllButtons();
		updateGNSSButton();
    }

    function onGnssMessage(rawLine) {
        const line = rawLine.trim();
        Logger.logIncoming('GNSS', line);

        const data = GNSSParser.parse(line);
        if (!data) return;

        if (data.type === 'rmc' && !isNaN(data.latitude) && !isNaN(data.longitude)) {
            // Обновляем текущую позицию в VLBLManager
            VLBLManager.getState().currentLat = data.latitude;
            VLBLManager.getState().currentLon = data.longitude;
            VLBLManager.getState().speedMps = data.speedMps;
            VLBLManager.getState().courseDeg = data.course;

            // Добавляем в трек судна
            MeasurementsStore.addStationPoint(data.latitude, data.longitude, new Date());
            updateAntennaInfoUI();
        } else if (data.type === 'hdt' && !isNaN(data.heading)) {
			// Внешний компас (True Heading)
			VLBLManager.getState().antennaHeadingDeg = data.heading;
			hasExternalHeading = true;
			updateAntennaInfoUI();
		} else if (data.type === 'hdg' && !isNaN(data.heading)) {
			// Внешний компас (Heading with deviation)
			VLBLManager.getState().antennaHeadingDeg = data.heading;
			hasExternalHeading = true;
			updateAntennaInfoUI();
		} else if (data.type === 'hdm' && !isNaN(data.heading)) {
			// Внешний компас (Magnetic Heading)
			VLBLManager.getState().antennaHeadingDeg = data.heading;
			hasExternalHeading = true;
			updateAntennaInfoUI();
		}
    }


	function toggleGNSSMenu() {
		toggleDropdown('gnss-dropdown');
	}

	function connectExternalGNSS() {
		if (isGnssConnected) {
			disconnectGNSS();
		} else {
			connectGNSS();
		}
	}

	function startInternalGPS() {
		// Останавливаем внешний GNSS если был
		if (isGnssConnected) {
			disconnectGNSS();
		}
		
		// Останавливаем предыдущее слежение если было
		if (internalGNSSWatchId !== null) {
			navigator.geolocation.clearWatch(internalGNSSWatchId);
			internalGNSSWatchId = null;
		}
		
		setStatus('📱 Внутренний GNSS запущен');
		
		// Запускаем нативный GPS через WebView
		const iframe = document.createElement('iframe');
		iframe.style.display = 'none';
		iframe.src = 'app://start_gps';
		document.body.appendChild(iframe);
		setTimeout(() => document.body.removeChild(iframe), 100);
		
		updateGNSSButton();
	}

	function stopInternalGPS() {
		if (internalGNSSWatchId !== null) {
			navigator.geolocation.clearWatch(internalGNSSWatchId);
			internalGNSSWatchId = null;
		}
		
		// Отправляем команду остановки нативного GPS
		const iframe = document.createElement('iframe');
		iframe.style.display = 'none';
		iframe.src = 'app://stop_gps';
		document.body.appendChild(iframe);
		setTimeout(() => document.body.removeChild(iframe), 100);
		
		setStatus('📱 Внутренний GNSS остановлен');
		updateGNSSButton();
	}

	function disconnectAllGNSS() {
		if (isGnssConnected) {
			disconnectGNSS();
		}
		stopInternalGPS();
		
		// Отправляем команду остановки нативного GPS
		const iframe = document.createElement('iframe');
		iframe.style.display = 'none';
		iframe.src = 'app://stop_gps';
		document.body.appendChild(iframe);
		setTimeout(() => document.body.removeChild(iframe), 100);
		
		updateGNSSButton();
		closeAllDropdowns();
	}

	function updateGNSSButton() {
		if (isGnssConnected) {
			btnGnss.textContent = '⏏ GNSS (Serial)';
			btnGnss.className = 'top-btn btn-disconnect';
		} else if (internalGNSSWatchId !== null) {
			btnGnss.textContent = '⏏ GNSS (Internal)';
			btnGnss.className = 'top-btn btn-disconnect';
		} else {
			btnGnss.textContent = '📡 GNSS';
			btnGnss.className = 'top-btn btn-gnss';
		}
	}




    // ========== ОПРОС ==========

    async function startInterrogation() {
        if (!serialBridge || !isConnected) {
            setStatus('Нет подключения');
            return;
        }
        const cmd = VLBLManager.getStartCommand();
        Logger.logOutgoing('AZM', cmd.trim());
        await serialBridge.send(cmd);
    }

    async function stopInterrogation() {
        if (!serialBridge || !isConnected) {
            setStatus('Нет подключения');
            return;
        }
        const cmd = VLBLManager.getStopCommand();
        Logger.logOutgoing('AZM', cmd.trim());
        await serialBridge.send(cmd);
    }

    function toggleConnection() {
        if (isConnected) disconnectSerial(); else connectSerial();
    }

    function toggleGNSS() {
        if (isGnssConnected) disconnectGNSS(); else connectGNSS();
    }

    function toggleInterrogation() {
        if (VLBLManager.getState().isInterrogationActive) stopInterrogation(); else startInterrogation();
    }

    // ========== VLBL РЕШЕНИЕ ==========

	function solveBeacon(addr) {
		// Синхронное решение (fallback)
		const measurements = MeasurementsStore.getMeasurements(addr);
		if (!measurements || !measurements.isBaseExists) return null;

		const base = measurements.getBase();
		if (base.length < 3) return null;

		const beacon = VLBLManager.getBeacons()[addr];
		const beaconDepth = beacon && !isNaN(beacon.depthM) ? beacon.depthM : 0;

		const bases = base.map(m => ({ lat: m.lat, lon: m.lon, depth: m.depth, range: m.range }));
		const prevSolution = MeasurementsStore.getSolution(addr);

		const result = VLBLsolver.locate2D(
			bases,
			prevSolution ? prevSolution.latDeg : NaN,
			prevSolution ? prevSolution.lonDeg : NaN,
			beaconDepth,
			{}
		);

		result.depthM = beaconDepth;
		MeasurementsStore.setSolution(addr, result);
		MeasurementsStore.saveSolutionsToStorage();
		return result;
	}

	function solveBeaconAsync(addr) {
		if (vlblWorker) {
			const measurements = MeasurementsStore.getMeasurements(addr);
			if (!measurements || !measurements.isBaseExists) return;

			const base = measurements.getBase();
			if (base.length < 3) return;

			const beacon = VLBLManager.getBeacons()[addr];
			const beaconDepth = beacon && !isNaN(beacon.depthM) ? beacon.depthM : 0;
			const prevSolution = MeasurementsStore.getSolution(addr);

			const bases = base.map(m => ({ lat: m.lat, lon: m.lon, depth: m.depth, range: m.range }));
			const requestId = ++solveRequestCounter + '_' + addr;
			pendingSolveRequests.set(requestId, { addr });

			vlblWorker.postMessage({
				action: 'solve',
				data: {
					requestId,
					bases,
					prevLat: prevSolution ? prevSolution.latDeg : NaN,
					prevLon: prevSolution ? prevSolution.lonDeg : NaN,
					beaconDepth,
					options: {},
				}
			});
		} else {
			solveBeacon(addr);
		}
	}

	function checkAutoSolve(addr) {
		if (autoSolveCount === 0) return; // выключено
		
		const count = MeasurementsStore.getMeasurementCount(addr);
		const lastCount = lastAutoSolveCount[addr] || 0;
		const now = Date.now();
		const lastTime = lastAutoSolveTime[addr] || 0;
		
		if ((count - lastCount >= autoSolveCount) && 
			(now - lastTime >= autoSolveMinIntervalMs)) {
			lastAutoSolveCount[addr] = count;
			lastAutoSolveTime[addr] = now;
			solveBeaconAsync(addr);
		}
	}

	function solveAllBeacons() {
		const beacons = VLBLManager.getBeaconsArray();
		const tasks = [];

		for (const beacon of beacons) {
			const measurements = MeasurementsStore.getMeasurements(beacon.address);
			if (!measurements || !measurements.isBaseExists) continue;

			try {
				const base = measurements.getBase();
				if (base.length < 3) continue;

				const beaconDepth = !isNaN(beacon.depthM) ? beacon.depthM : 0;
				const prevSolution = MeasurementsStore.getSolution(beacon.address);

				tasks.push({
					addr: beacon.address,
					bases: base.map(m => ({ lat: m.lat, lon: m.lon, depth: m.depth, range: m.range })),
					prevLat: prevSolution ? prevSolution.latDeg : NaN,
					prevLon: prevSolution ? prevSolution.lonDeg : NaN,
					beaconDepth,
					options: {},
				});
			} catch (e) {
				console.warn(`[App] Маяк #${beacon.address + 1}: ${e.message}`);
			}
		}

		if (tasks.length === 0) {
			setStatus('Недостаточно данных для решения');
			return;
		}

		if (vlblWorker) {
			const requestId = 'solve_all_' + ++solveRequestCounter;
			pendingSolveRequests.set(requestId, { addr: 'all' });
			vlblWorker.postMessage({
				action: 'solve_all',
				data: { requestId, tasks },
			});
			setStatus(`Решение ${tasks.length} маяков...`);
		} else {
			let solved = 0;
			for (const beacon of beacons) {
				const result = solveBeacon(beacon.address);
				if (result) solved++;
			}
			if (solved > 0) {
				setStatus(`Решено маяков: ${solved}`);
				UICanvas.autoScale();
			} else {
				setStatus('Недостаточно данных');
			}
			UIVLBL.updateBeaconsBar();
		}
	}

    // ========== ОЧИСТКА ==========

    function clearAllData() {
		
		if (Emulator.isRunning()) Emulator.stop();
		
        if (confirm('Очистить все данные VLBL?')) {
            MeasurementsStore.clearAll();
			lastAutoSolveTime = {};
			lastAutoSolveCount = {};
			localStorage.removeItem('lblx_beacons');
            VLBLManager.reset();
            UIVLBL.updateBeaconsBar();
            setStatus('Данные очищены');
        }
    }


    // ========== POI ==========
	
	function loadPOI() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.csv,.txt';
		input.onchange = (e) => {
			const file = e.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (ev) => {
				const count = POIManager.loadFromCSV(ev.target.result);
				if (count > 0) {
					setStatus(`Загружено ${count} POI`);
				} else {
					alert('Не удалось загрузить POI. Проверьте формат.');
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}

	function clearPOI() {
		if (POIManager.getCount() === 0) {
			alert('Нет POI для очистки');
			return;
		}
		if (confirm(`Очистить все POI (${POIManager.getCount()} шт.)?`)) {
			POIManager.clear();
			setStatus('POI очищены');
		}
	}

	function exportPOI_CSV() {
		const points = POIManager.getAll();
		if (points.length === 0) {
			alert('Нет POI для экспорта');
			return;
		}
		
		const lines = ['Name,Latitude,Longitude,Depth'];
		for (const poi of points) {
			lines.push(`${poi.name},${poi.lat.toFixed(8)},${poi.lon.toFixed(8)},${poi.depth?.toFixed(1) || ''}`);
		}
		
		const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `poi_export_${new Date().toISOString().slice(0,10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}


    // ========== ЛОГГЕР ==========

    function saveLog() {
        if (Logger.getEntryCount() === 0) {
            alert('Нет данных для сохранения');
            return;
        }
        Logger.downloadLog();
        setStatus('Лог сохранён');
    }

    async function loadLog() {
        closeAllDropdowns();
        try {
            const count = await Logger.loadLogFromFile();
            if (count > 0) setStatus(`Загружено ${count} записей`);
        } catch (e) {
            console.error('[App] Ошибка загрузки:', e);
        }
    }

    function showLogAnalysis() {
        const entries = Logger.getEntries();
        if (entries.length === 0) {
            alert('Нет данных для анализа');
            return;
        }
        const report = LogAnalyzer.analyze(entries);
        alert(LogAnalyzer.formatReport(report));
    }

    function togglePlayback() {
        closeAllDropdowns();
        if (Logger.getRecordingStatus().isPlaying) {
            Logger.stopPlayback();
            onPlaybackEnd();
            return;
        }
        if (Logger.getEntries().length === 0) {
            alert('Нет загруженного лога');
            return;
        }
		
		Logger.setPlaybackSpeed(1.0);
		updateSpeedUI();
        Logger.startPlayback(1.0, true, true);
        playbackProgress.style.display = 'block';
        onPlaybackStart();
    }


	function updateSpeedUI() {
		const current = Logger.getCurrentPlaybackSpeed();
		const span = document.getElementById('playback-speed-current');
		if (span) span.textContent = current + 'x';
	}

	function increasePlaybackSpeed() {
		let idx = PLAYBACK_SPEEDS.indexOf(Logger.getCurrentPlaybackSpeed());
		if (idx === -1) idx = 0;
		idx = (idx + 1) % PLAYBACK_SPEEDS.length;
		Logger.setPlaybackSpeed(PLAYBACK_SPEEDS[idx]);
		updateSpeedUI();
		setStatus(`Скорость: ${PLAYBACK_SPEEDS[idx]}x`);
	}

	function decreasePlaybackSpeed() {
		let idx = PLAYBACK_SPEEDS.indexOf(Logger.getCurrentPlaybackSpeed());
		if (idx === -1) idx = 0;
		idx = (idx - 1 + PLAYBACK_SPEEDS.length) % PLAYBACK_SPEEDS.length;
		Logger.setPlaybackSpeed(PLAYBACK_SPEEDS[idx]);
		updateSpeedUI();
		setStatus(`Скорость: ${PLAYBACK_SPEEDS[idx]}x`);
	}


	function onLogEntry(data, timestampMs, virtualTime, logEntry) {
		if (logEntry && logEntry.type === 'outgoing') return;
		if (logEntry && logEntry.port) {
			const p = logEntry.port.toUpperCase();
			if (p.includes('OUT')) return;
		}

		VLBLManager.setTimeProvider(() => virtualTime);

		const gnssData = GNSSParser.parse(data);
		if (gnssData && gnssData.type === 'rmc' && !isNaN(gnssData.latitude)) {			
			VLBLManager.getState().currentLat = gnssData.latitude;
			VLBLManager.getState().currentLon = gnssData.longitude;
			VLBLManager.getState().speedMps = gnssData.speedMps;
			VLBLManager.getState().courseDeg = gnssData.course;
			MeasurementsStore.addStationPoint(gnssData.latitude, gnssData.longitude, virtualTime);
			updateAntennaInfoUI();
			return;
		}

		const result = VLBLManager.processRawLine(data);
		if (result) {
			switch (result.type) {
				case 'dinfo': handleDINFO(result.data); break;
				case 'strstp': handleSTRSTP(result.data); break;
				case 'ndta_result':
					updateAntennaInfoUI();
					if (result.beacon) handleBeaconUpdate(result.beacon);
					break;
			}
		}
	}

	function onPlaybackStart() {
		setStatus('▶ Воспроизведение...');
		const speedControl = document.getElementById('playback-speed-control');
		if (speedControl) speedControl.style.display = 'inline-flex';
		updateSpeedUI();
	}

	function onPlaybackEnd() {
		VLBLManager.setTimeProvider(() => new Date());
		playbackProgress.style.display = 'none';
		
		const speedControl = document.getElementById('playback-speed-control');
		if (speedControl) speedControl.style.display = 'none';
		
		Logger.setPlaybackSpeed(1.0);
		updateSpeedUI();
		setStatus('Воспроизведение завершено');
	}

    function onPlaybackProgress(current, total) {
        if (playbackProgressFill) {
            const pct = total > 0 ? (current / total * 100) : 0;
            playbackProgressFill.style.width = pct + '%';
        }
    }

    // ========== ЭКСПОРТ ==========

    function exportStationTrackCSV() { ExportManager.exportStationTrackCSV(); }
    function exportMeasurementsCSV() { ExportManager.exportMeasurementsCSV(); }
    function exportSolutionsCSV() { ExportManager.exportSolutionsCSV(); }
    function exportKML() { ExportManager.exportKML(); }

    // ========== НАСТРОЙКИ ==========

    function openSettings() { UISettings.open(); }
    function closeSettings() { UISettings.close(); }

    function updateSettingsUI() {
        const st = VLBLManager.getState();
        const ms = MeasurementsStore.getSettings();

        UISettings.setValue('cfg-mask', st.addressMask);
        UISettings.setValue('cfg-maxdist', st.maxDistM);
        UISettings.setValue('cfg-salinity', st.salinityPSU);

        const sosInput = document.getElementById('cfg-soundspeed');
        if (sosInput) {
            sosInput.value = (!isNaN(st.soundSpeedMps) && !st.soundSpeedAuto) ? st.soundSpeedMps.toFixed(1) : '';
        }

        UISettings.setValue('cfg-base-size', ms.baseSize);
        UISettings.setValue('cfg-max-meas', ms.maxMeasurementsPerBeacon);
        UISettings.setValue('cfg-min-dist', ms.minStationPointDistanceM);
		
		const autoSolveEl = document.getElementById('cfg-auto-solve');
		if (autoSolveEl) {
			autoSolveEl.value = autoSolveCount === 0 ? 'off' : autoSolveCount.toString();
		}

        const gnssBaudEl = document.getElementById('cfg-gnss-baud');
        if (gnssBaudEl) {
            const saved = localStorage.getItem('lblx_settings');
            if (saved) {
                const data = JSON.parse(saved);
                gnssBaudEl.value = data.gnssBaudrate || '38400';
            }
        }

        UISettings.syncCheckboxesFromMask(st.addressMask);
    }

    function applySettings() {
        const mask = UISettings.getInt('cfg-mask', 1);
        const maxDist = UISettings.getFloat('cfg-maxdist', 1000);
        const salinity = UISettings.getFloat('cfg-salinity', 0);
        const soundSpeedVal = UISettings.getValue('cfg-soundspeed', '');
        const soundSpeed = soundSpeedVal ? parseFloat(soundSpeedVal) : NaN;
        const baseSize = UISettings.getInt('cfg-base-size', 4);
        const maxMeas = UISettings.getInt('cfg-max-meas', 200);
        const minDist = UISettings.getFloat('cfg-min-dist', 1.0);

        VLBLManager.setAddressMask(mask);
        VLBLManager.setMaxDistance(maxDist);
        VLBLManager.setSalinity(salinity);
        VLBLManager.setSoundSpeedAuto(isNaN(soundSpeed));
        if (!isNaN(soundSpeed)) VLBLManager.setSoundSpeed(soundSpeed);
		
		const autoSolveVal = UISettings.getValue('cfg-auto-solve', '10');
		autoSolveCount = autoSolveVal === 'off' ? 0 : parseInt(autoSolveVal);

        MeasurementsStore.setBaseSize(baseSize);
        MeasurementsStore.setMaxMeasurementsPerBeacon(maxMeas);
        MeasurementsStore.setMinStationPointDistance(minDist);

        saveSettings();

        if (isConnected && VLBLManager.getState().isInterrogationActive) {
            const cmd = VLBLManager.getStartCommand();
            Logger.logOutgoing('AZM', cmd.trim());
            serialBridge.send(cmd);
        }

        setStatus('Настройки применены');
        UISettings.close();
    }

    function saveSettings() {
        const data = {
            mask: VLBLManager.getState().addressMask,
            maxDist: VLBLManager.getState().maxDistM,
            salinity: VLBLManager.getState().salinityPSU,
            soundSpeedAuto: VLBLManager.getState().soundSpeedAuto,
            soundSpeed: VLBLManager.getState().soundSpeedMps,
            baseSize: MeasurementsStore.getSettings().baseSize,
            maxMeas: MeasurementsStore.getSettings().maxMeasurementsPerBeacon,
            minDist: MeasurementsStore.getSettings().minStationPointDistanceM,
            gnssBaudrate: parseInt(document.getElementById('cfg-gnss-baud')?.value) || 38400,
			autoSolveCount: autoSolveCount,
        };
        try { localStorage.setItem('lblx_settings', JSON.stringify(data)); } catch (e) {}
    }

    function loadSettings() {
		
		const defaults = {
				mask: 1,           
				maxDist: 1000,
				salinity: 0,
				soundSpeedAuto: true,
				soundSpeed: 1480,
				baseSize: 6,
				maxMeas: 1000,
				minDist: 5.0,
				gnssBaudrate: 9600,
				autoSolveCount: 10,
			};

			try {
				const saved = localStorage.getItem('lblx_settings');
				const data = saved ? JSON.parse(saved) : {};
				
				// Применяем настройки с учётом defaults
				const settings = { ...defaults, ...data };
				
				VLBLManager.setAddressMask(settings.mask);
				VLBLManager.setMaxDistance(settings.maxDist);
				VLBLManager.setSalinity(settings.salinity);
				VLBLManager.setSoundSpeedAuto(settings.soundSpeedAuto);
				VLBLManager.setSoundSpeed(settings.soundSpeed);
				MeasurementsStore.setBaseSize(settings.baseSize);
				MeasurementsStore.setMaxMeasurementsPerBeacon(settings.maxMeas);
				MeasurementsStore.setMinStationPointDistance(settings.minDist);
				autoSolveCount = settings.autoSolveCount;
				
				if (document.getElementById('cfg-gnss-baud')) {
					document.getElementById('cfg-gnss-baud').value = settings.gnssBaudrate;
				}
			} catch (e) {}
    }

    function onMaskChanged() {
        const mask = UISettings.getInt('cfg-mask', 0);
        UISettings.syncCheckboxesFromMask(mask);
    }

    function onAddrCheckboxChanged() {
        const mask = UISettings.getMaskFromCheckboxes();
        UISettings.updateMaskInput(mask);
    }

    // ========== UI ОБНОВЛЕНИЯ ==========

	function updateAntennaInfoUI() {
		const st = VLBLManager.getState();		
		document.getElementById('ai-lat').textContent = !isNaN(st.currentLat) ? st.currentLat.toFixed(6) : '--';
		document.getElementById('ai-lon').textContent = !isNaN(st.currentLon) ? st.currentLon.toFixed(6) : '--';
		document.getElementById('ai-hdg').textContent = !isNaN(st.antennaHeadingDeg) ? st.antennaHeadingDeg.toFixed(1) : '--';
		document.getElementById('ai-spd').textContent = !isNaN(st.speedMps) ? st.speedMps.toFixed(2) : '--';
		document.getElementById('ai-crs').textContent = !isNaN(st.courseDeg) ? st.courseDeg.toFixed(1) : '--';
		document.getElementById('ai-dpt').textContent = !isNaN(st.antennaDepthM) ? st.antennaDepthM.toFixed(1) : '--';
		document.getElementById('ai-tmp').textContent = !isNaN(st.waterTempC) ? st.waterTempC.toFixed(1) : '--';
	}

    function updateAllButtons() {
        if (isConnected) {
            btnConnection.textContent = '⏏ AZM';
            btnConnection.className = 'top-btn btn-disconnect';
        } else {
            btnConnection.textContent = '🔌 AZM';
            btnConnection.className = 'top-btn btn-connect';
        }

        updateGNSSButton();

        const st = VLBLManager.getState();
        if (isConnected && st.isDeviceInfoValid) {
            btnInterrogation.disabled = false;
            if (st.isInterrogationActive) {
                btnInterrogation.textContent = '⏸ Стоп';
                btnInterrogation.className = 'top-btn btn-stop';
            } else {
                btnInterrogation.textContent = '▶ Опрос';
                btnInterrogation.className = 'top-btn btn-start';
            }
        } else {
            btnInterrogation.disabled = true;
            btnInterrogation.textContent = '▶ Опрос';
            btnInterrogation.className = 'top-btn btn-start';
        }
    }

	function toggleAutoScale() {
		if (UICanvas.isAutoScaleEnabled()) {
			UICanvas.setAutoScaleEnabled(false);
		} else {
			UICanvas.setAutoScaleEnabled(true);
		}
		updateAutoScaleButton();
	}
	
	function updateAutoScaleButton() {
		const enabled = UICanvas.isAutoScaleEnabled();
		btnAutoScale.textContent = enabled ? '📐 Авто: вкл' : '📐 Авто: выкл';
		btnAutoScale.classList.toggle('active', enabled);
	}

    function toggleRuler() {
		UIRuler.toggle();
	}


	// ========== LBL SOLVER CONFIG ==========

	function openLBLSolver() {
		if (!isConnected || !serialBridge) {
			alert('Подключитесь к Zima2 LBL');
			return;
		}
		document.getElementById('lblsolver-overlay').classList.add('visible');
		loadLBLSolverSettings();
	}

	function closeLBLSolver() {
		document.getElementById('lblsolver-overlay').classList.remove('visible');
	}

	function loadLBLSolverSettings() {
		// Загружаем сохранённые настройки LBL решателя
		try {
			const saved = localStorage.getItem('lblsolver_settings');
			if (saved) {
				const data = JSON.parse(saved);
				// Применяем к полям
				document.getElementById('lblsolver-auto-output').value = data.autoOutput || '0';
				document.getElementById('lblsolver-autostart').value = data.autostart || '0';
				document.getElementById('lblsolver-salinity').value = data.salinity || 0;
				document.getElementById('lblsolver-sos').value = data.sos || '';
				document.getElementById('lblsolver-smflt-size').value = data.smfltSize || 4;
				document.getElementById('lblsolver-smflt-thld').value = data.smfltThld || 100;
				document.getElementById('lblsolver-achod-size').value = data.achodSize || 8;
				document.getElementById('lblsolver-achod-mspd').value = data.achodMspd || 0.5;
				document.getElementById('lblsolver-achod-thld').value = data.achodThld || 5;
				document.getElementById('lblsolver-rerr').value = data.rerr || 25;
			}
		} catch (e) {}
	}

	function saveLBLSolverSettings() {
		const data = {
			autoOutput: document.getElementById('lblsolver-auto-output').value,
			autostart: document.getElementById('lblsolver-autostart').value,
			salinity: document.getElementById('lblsolver-salinity').value,
			sos: document.getElementById('lblsolver-sos').value,
			smfltSize: document.getElementById('lblsolver-smflt-size').value,
			smfltThld: document.getElementById('lblsolver-smflt-thld').value,
			achodSize: document.getElementById('lblsolver-achod-size').value,
			achodMspd: document.getElementById('lblsolver-achod-mspd').value,
			achodThld: document.getElementById('lblsolver-achod-thld').value,
			rerr: document.getElementById('lblsolver-rerr').value,
		};
		try {
			localStorage.setItem('lblsolver_settings', JSON.stringify(data));
		} catch (e) {}
	}

	function loadSolvedBeaconsToLBLSolver() {
		// Загружаем решения VLBL в поля маяков
		const solutions = MeasurementsStore.getSolutions();
		const solvedBeacons = Object.keys(solutions).filter(addr => solutions[addr] && solutions[addr].latDeg);
		
		if (solvedBeacons.length === 0) {
			alert('Нет решённых маяков. Сначала выполните VLBL решение.');
			return;
		}
		
		// Берём первые 4 решённых маяка
		const beaconInputs = [
			{ addr: 'lblsolver-a1', ln: 'lblsolver-ln1', lt: 'lblsolver-lt1' },
			{ addr: 'lblsolver-a2', ln: 'lblsolver-ln2', lt: 'lblsolver-lt2' },
			{ addr: 'lblsolver-a3', ln: 'lblsolver-ln3', lt: 'lblsolver-lt3' },
			{ addr: 'lblsolver-a4', ln: 'lblsolver-ln4', lt: 'lblsolver-lt4' },
		];
		
		for (let i = 0; i < Math.min(4, solvedBeacons.length); i++) {
			const addr = solvedBeacons[i];
			const solution = solutions[addr];
			const inputs = beaconInputs[i];
			
			document.getElementById(inputs.addr).value = parseInt(addr);
			document.getElementById(inputs.ln).value = solution.lonDeg.toFixed(6);
			document.getElementById(inputs.lt).value = solution.latDeg.toFixed(6);
		}
		
		setStatus('Координаты маяков загружены из решений');
	}

	function sendLBLSolverConfig() {
		if (!serialBridge || !isConnected) {
			alert('Нет подключения к Zima2');
			return;
		}
		
		// Собираем конфигурацию
		const config = {
			autoOutput: document.getElementById('lblsolver-auto-output').value,
			autostart: document.getElementById('lblsolver-autostart').value,
			salinity: document.getElementById('lblsolver-salinity').value,
			sos: document.getElementById('lblsolver-sos').value || '',
			sosAuto: '',  // Пусто = устройство само решит
			smfltSize: document.getElementById('lblsolver-smflt-size').value,
			smfltThld: document.getElementById('lblsolver-smflt-thld').value,
			achodSize: document.getElementById('lblsolver-achod-size').value,
			achodMspd: document.getElementById('lblsolver-achod-mspd').value,
			achodThld: document.getElementById('lblsolver-achod-thld').value,
			rerr: document.getElementById('lblsolver-rerr').value,
			a1: document.getElementById('lblsolver-a1').value,
			ln1: document.getElementById('lblsolver-ln1').value || '',
			lt1: document.getElementById('lblsolver-lt1').value || '',
			a2: document.getElementById('lblsolver-a2').value,
			ln2: document.getElementById('lblsolver-ln2').value || '',
			lt2: document.getElementById('lblsolver-lt2').value || '',
			a3: document.getElementById('lblsolver-a3').value,
			ln3: document.getElementById('lblsolver-ln3').value || '',
			lt3: document.getElementById('lblsolver-lt3').value || '',
		};
		
		// Маяк 4 — только если координаты заданы
		const a4 = document.getElementById('lblsolver-a4').value;
		const ln4 = document.getElementById('lblsolver-ln4').value || '';
		const lt4 = document.getElementById('lblsolver-lt4').value || '';
		
		if (ln4 && lt4) {
			config.a4 = a4;
			config.ln4 = ln4;
			config.lt4 = lt4;
		}
		
		const cmd = VLBLManager.getLBP_SETACommand(config);
		
		Logger.logOutgoing('AZM', cmd.trim());
		serialBridge.send(cmd);
		
		saveLBLSolverSettings();
		
		// Ожидаем ответ
		lblSolverPending = true;
		setStatus('Отправлено. Ожидание ответа...');
		
		if (lblSolverTimeout) clearTimeout(lblSolverTimeout);
		lblSolverTimeout = setTimeout(() => {
			if (lblSolverPending) {
				lblSolverPending = false;
				setStatus('⚠ Нет ответа от решателя');
			}
		}, 3000);
	}


    // ========== МЫШЬ ==========

    function initMouseHandlers() {
		
        canvas.addEventListener('wheel', (e) => {
			e.preventDefault();
			const rect = canvas.getBoundingClientRect();
			UICanvas.zoom(e.deltaY, e.clientX, e.clientY, rect);
			updateAutoScaleButton();
		});
		
		canvas.addEventListener('mousedown', (e) => {
			if (UIRuler.isActive()) {
				UIRuler.handleClick(e);
				return;
			}
			e.preventDefault();
			UICanvas.setDraggingEnabled(true);
			lastMouseX = e.clientX;
			lastMouseY = e.clientY;
			canvas.style.cursor = 'grabbing';
			updateAutoScaleButton();
		});

		canvas.addEventListener('mousemove', (e) => {
			if (UIRuler.isActive() && UIRuler.getPointsCount() === 1) {
				UIRuler.handleMouseMove(e);
			}
			if (UICanvas.isDraggingEnabled()) {
				const dx = e.clientX - lastMouseX;
				const dy = e.clientY - lastMouseY;
				UICanvas.updateFromInteraction(dx, dy);
				lastMouseX = e.clientX;
				lastMouseY = e.clientY;
			}
		});

        canvas.addEventListener('mouseup', () => {
            UICanvas.setDraggingEnabled(false);
            canvas.style.cursor = 'grab';
        });

        canvas.addEventListener('mouseleave', () => {
            UICanvas.setDraggingEnabled(false);
            canvas.style.cursor = 'grab';
        });

        canvas.addEventListener('dblclick', () => {
            UICanvas.resetView();
            setStatus('Вид сброшен');
        });
    }

	function initTouchHandlers() {
		let initDist = 0, initScale = 1;
		let lastTouchTime = 0;

		canvas.addEventListener('touchstart', (e) => {
			e.preventDefault();
			
			if (e.touches.length === 1) {
				UICanvas.setDraggingEnabled(true);
				lastMouseX = e.touches[0].clientX;
				lastMouseY = e.touches[0].clientY;
			} else if (e.touches.length === 2) {
				UICanvas.setDraggingEnabled(false);
				const dx = e.touches[0].clientX - e.touches[1].clientX;
				const dy = e.touches[0].clientY - e.touches[1].clientY;
				initDist = Math.sqrt(dx * dx + dy * dy);
				initScale = UICanvas.getScale();
			}
		});

		canvas.addEventListener('touchmove', (e) => {
			e.preventDefault();
			if (e.touches.length === 1 && UICanvas.isDraggingEnabled()) {
				const dx = e.touches[0].clientX - lastMouseX;
				const dy = e.touches[0].clientY - lastMouseY;
				UICanvas.updateFromInteraction(dx, dy);
				lastMouseX = e.touches[0].clientX;
				lastMouseY = e.touches[0].clientY;
				updateAutoScaleButton();
			} else if (e.touches.length === 2) {
				const dx = e.touches[0].clientX - e.touches[1].clientX;
				const dy = e.touches[0].clientY - e.touches[1].clientY;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (initDist > 0) {
					const newScale = initScale * (dist / initDist);
					UICanvas.setScale(newScale);
					UICanvas.setAutoScaleEnabled(false);
					updateAutoScaleButton();
				}
			}
		});

		canvas.addEventListener('touchend', (e) => {
			e.preventDefault();
			UICanvas.setDraggingEnabled(false);
		});
	}

    // ========== ПУБЛИЧНЫЙ API ==========

    return {
        init,
        toggleConnection,
        toggleGNSS,
        toggleInterrogation,
        openSettings,
        closeSettings,
        applySettings,
        onMaskChanged,
        onAddrCheckboxChanged,
        toggleDropdown,
        closeAllDropdowns,
        cycleTheme,
        saveLog,
        loadLog,
        showLogAnalysis,
        togglePlayback,
        clearAllData,
        solveAllBeacons,
        exportStationTrackCSV,
        exportMeasurementsCSV,
        exportSolutionsCSV,
        exportKML,
        toggleAutoScale,
		toggleRuler,
		toggleEmulation: () => {
			const running = Emulator.toggle();
			setStatus(running ? '🎭 Эмуляция запущена' : '🎭 Эмуляция остановлена');
			},
		loadPOI, clearPOI, exportPOI_CSV,
		increasePlaybackSpeed, decreasePlaybackSpeed,
		toggleGNSSMenu,
		connectExternalGNSS,
		startInternalGPS,
		stopInternalGPS,
		disconnectAllGNSS,
		openLBLSolver,
		closeLBLSolver,
		loadSolvedBeaconsToLBLSolver,
		sendLBLSolverConfig,
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});