// poi-manager.js — Управление точками интереса (POI)

const POIManager = (() => {
    let points = []; // [{id, name, lat, lon, depth, type: 'loaded'|'marked', timestamp}]
    let nextId = 1;
    
    function loadFromCSV(text) {
        const lines = text.split(/\r?\n/);
        const newPoints = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) continue;
            
            const parts = trimmed.split(/[;,\t]/).map(s => s.trim()).filter(s => s !== '');
            if (parts.length < 2) continue;
            
            const name = parts[0];
            const lat = parseFloat(parts[1]);
            const lon = parseFloat(parts[2]);
            const depth = parts.length > 3 ? parseFloat(parts[3]) : NaN;
            
            if (isNaN(lat) || isNaN(lon)) continue;
            
            newPoints.push({
                id: nextId++,
                name: name || `POI ${nextId}`,
                lat, lon,
                depth: !isNaN(depth) ? depth : null,
                type: 'loaded',
                timestamp: Date.now()
            });
        }
        
        if (newPoints.length === 0) return 0;
        
        points = points.concat(newPoints);
        save();
        return newPoints.length;
    }
    
    function addMarkedPoint(name, lat, lon, depth) {
        points.push({
            id: nextId++,
            name: name,
            lat, lon,
            depth: !isNaN(depth) ? depth : null,
            type: 'marked',
            timestamp: Date.now()
        });
        save();
        return points[points.length - 1];
    }
    
    function removePoint(id) {
        points = points.filter(p => p.id !== id);
        save();
    }
    
    function clear() {
        points = [];
        save();
    }
    
    function getAll() { return points; }
    function getCount() { return points.length; }
    
    function save() {
        try {
            localStorage.setItem('poi_data', JSON.stringify(points));
        } catch (e) {
            console.warn('[POI] Не удалось сохранить:', e);
        }
    }
    
    function load() {
        try {
            const saved = localStorage.getItem('poi_data');
            if (saved) {
                points = JSON.parse(saved);
                if (points.length > 0) {
                    nextId = Math.max(...points.map(p => p.id)) + 1;
                }
                return points.length;
            }
        } catch (e) {
            console.warn('[POI] Ошибка загрузки:', e);
        }
        return 0;
    }
    
    // Инициализация
    load();
    
    return {
        loadFromCSV,
        addMarkedPoint,
        removePoint,
        clear,
        getAll,
        getCount,
        save,
        load
    };
})();