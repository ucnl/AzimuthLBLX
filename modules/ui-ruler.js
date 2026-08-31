// modules/ui-ruler.js
// Инструмент "Линейка" для измерения расстояний на карте

const UIRuler = (() => {
    let rulerActive = false;
    let rulerWorldPoints = [];
    let rulerDistanceM = 0;
    let rulerTempWorldPoint = null;
    let rulerTempDistance = 0;
    
    let canvas = null;
    let ctx = null;
    let getOffsetX = null;
    let getOffsetY = null;
    let getScale = null;
    let drawCallback = null;
    let setStatusCallback = null;
	
	let getAnchor = null;
    
    function init(canvasEl, ctxEl, callbacks) {
        canvas = canvasEl;
        ctx = ctxEl;
        getOffsetX = callbacks.getOffsetX;
        getOffsetY = callbacks.getOffsetY;
        getScale = callbacks.getScale;
        drawCallback = callbacks.drawCallback;
        setStatusCallback = callbacks.setStatus;
		getAnchor = callbacks.getAnchor || null;
    }
    
	function screenToWorld(screenX, screenY) {
		const offsetX = getOffsetX();
		const offsetY = getOffsetY();
		const scale = getScale();
		const worldX = (screenX - offsetX) / scale;
		const worldY = (offsetY - screenY) / scale;
		return { x: worldX, y: worldY };
	}

	function worldToScreen(worldX, worldY) {
		const offsetX = getOffsetX();
		const offsetY = getOffsetY();
		const scale = getScale();
		const screenX = offsetX + worldX * scale;
		const screenY = offsetY - worldY * scale;
		return { x: screenX, y: screenY };
	}
    
    function toggle() {
        rulerActive = !rulerActive;
        if (!rulerActive) {
            rulerWorldPoints = [];
            rulerTempWorldPoint = null;
            rulerDistanceM = 0;
            rulerTempDistance = 0;
            if (drawCallback) drawCallback();
        }
        updateButton();
        if (setStatusCallback) {
            setStatusCallback(rulerActive ? '📏 Линейка: кликните для первой точки' : '📏 Линейка выключена');
        }
    }
    
    function isActive() {
        return rulerActive;
    }
    
    function updateButton() {
        const btn = document.getElementById('btn-ruler');
        if (btn) {
            btn.classList.toggle('active', rulerActive);
            btn.textContent = rulerActive ? '📏 Отмена' : '📏 Линейка';
        }
    }
    
    function handleClick(e) {
        if (!rulerActive) return;
        
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPoint = screenToWorld(screenX, screenY);
			        
        rulerTempWorldPoint = null;
        rulerTempDistance = 0;
        
        if (rulerWorldPoints.length >= 2) {
            rulerWorldPoints = [worldPoint];
            rulerDistanceM = 0;
            if (setStatusCallback) setStatusCallback('📏 Линейка: выберите вторую точку');
            if (drawCallback) drawCallback();
            return;
        }
        
        rulerWorldPoints.push(worldPoint);
        
        if (rulerWorldPoints.length === 1) {
            if (setStatusCallback) setStatusCallback('📏 Линейка: кликните для второй точки');
            if (drawCallback) drawCallback();
        } else if (rulerWorldPoints.length === 2) {
            const p1 = rulerWorldPoints[0];
            const p2 = rulerWorldPoints[1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            rulerDistanceM = Math.sqrt(dx * dx + dy * dy);
            if (setStatusCallback) setStatusCallback(`📏 Линейка: расстояние ${rulerDistanceM.toFixed(1)} м. Кликните для новой линии`);
            if (drawCallback) drawCallback();
        }
    }
    
    function handleMouseMove(e) {
        if (!rulerActive || rulerWorldPoints.length !== 1) return;
        
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPoint = screenToWorld(screenX, screenY);
        
        rulerTempWorldPoint = worldPoint;
        
        const p1 = rulerWorldPoints[0];
        const dx = worldPoint.x - p1.x;
        const dy = worldPoint.y - p1.y;
        rulerTempDistance = Math.sqrt(dx * dx + dy * dy);
        
        if (drawCallback) drawCallback();
    }
    
	function draw() {
		if (!rulerActive || rulerWorldPoints.length === 0) return;
		
		const cc = Themes.getCanvasColors();
		const rootStyles = getComputedStyle(document.documentElement);
		const rulerLine = rootStyles.getPropertyValue('--ruler-line').trim() || '#ff4444';
		const rulerLineRubber = rootStyles.getPropertyValue('--ruler-line-rubber').trim() || '#ff8888';
		const rulerPointFill = rootStyles.getPropertyValue('--ruler-point-fill').trim() || '#ff4444';
		const rulerPointStroke = rootStyles.getPropertyValue('--ruler-point-stroke').trim() || '#ffffff';
		const rulerText = rootStyles.getPropertyValue('--ruler-text').trim() || '#ff4444';
		const rulerTextRubber = rootStyles.getPropertyValue('--ruler-text-rubber').trim() || '#ff8888';
		
		// Постоянные точки
		for (let i = 0; i < rulerWorldPoints.length; i++) {
			const world = rulerWorldPoints[i];
			const screen = worldToScreen(world.x, world.y);			
			
			ctx.beginPath();
			ctx.arc(screen.x, screen.y, 6, 0, 2 * Math.PI);
			ctx.fillStyle = rulerPointFill;
			ctx.fill();
			ctx.strokeStyle = rulerPointStroke;
			ctx.lineWidth = 2;
			ctx.stroke();
			
			ctx.fillStyle = cc.text;
			ctx.font = 'bold 11px Arial';
			ctx.textAlign = 'center';
			ctx.fillText(i === 0 ? 'A' : 'B', screen.x, screen.y - 10);
		}
		
		// Линия между двумя точками
		if (rulerWorldPoints.length === 2) {
			const p1 = rulerWorldPoints[0];
			const p2 = rulerWorldPoints[1];
			const screen1 = worldToScreen(p1.x, p1.y);
			const screen2 = worldToScreen(p2.x, p2.y);
			
			ctx.beginPath();
			ctx.moveTo(screen1.x, screen1.y);
			ctx.lineTo(screen2.x, screen2.y);
			ctx.strokeStyle = rulerLine;
			ctx.lineWidth = 3;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
			
			const midX = (screen1.x + screen2.x) / 2;
			const midY = (screen1.y + screen2.y) / 2;
			ctx.fillStyle = rulerText;
			ctx.font = 'bold 12px Arial';
			ctx.shadowBlur = 4;
			ctx.shadowColor = '#000';
			ctx.fillText(`${rulerDistanceM.toFixed(1)} м`, midX, midY - 10);
			ctx.shadowBlur = 0;
		}
		
		// Резиновая линия
		if (rulerWorldPoints.length === 1 && rulerTempWorldPoint) {
			const p1 = rulerWorldPoints[0];
			const screen1 = worldToScreen(p1.x, p1.y);
			const screenTemp = worldToScreen(rulerTempWorldPoint.x, rulerTempWorldPoint.y);
			
			ctx.beginPath();
			ctx.moveTo(screen1.x, screen1.y);
			ctx.lineTo(screenTemp.x, screenTemp.y);
			ctx.strokeStyle = rulerLineRubber;
			ctx.lineWidth = 2;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
			
			ctx.beginPath();
			ctx.arc(screenTemp.x, screenTemp.y, 5, 0, 2 * Math.PI);
			ctx.fillStyle = rulerPointFill + '80'; // 50% прозрачности
			ctx.fill();
			ctx.strokeStyle = rulerLineRubber;
			ctx.lineWidth = 1.5;
			ctx.stroke();
			
			const midX = (screen1.x + screenTemp.x) / 2;
			const midY = (screen1.y + screenTemp.y) / 2;
			ctx.fillStyle = rulerTextRubber;
			ctx.font = 'bold 11px Arial';
			ctx.shadowBlur = 4;
			ctx.shadowColor = '#000';
			ctx.fillText(`${rulerTempDistance.toFixed(1)} м`, midX, midY - 10);
			ctx.shadowBlur = 0;
		}
	}
    
    function getPointsCount() {
        return rulerWorldPoints.length;
    }
    
    function reset() {
        rulerWorldPoints = [];
        rulerTempWorldPoint = null;
        rulerDistanceM = 0;
        rulerTempDistance = 0;
		
        if (drawCallback) drawCallback();
    }
    
    return {
        init,
        toggle,
        isActive,
        handleClick,
        handleMouseMove,
        draw,
        getPointsCount,
        reset,
        screenToWorld,
        worldToScreen
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIRuler;
}