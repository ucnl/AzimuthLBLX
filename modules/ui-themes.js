// modules/ui-themes.js
// Управление темами оформления

const Themes = (() => {
    const THEMES = ['theme-indoor', 'theme-light', 'theme-dark-contrast', 'theme-jack-black', 'theme-jack-white', 'theme-vax'];
    const THEME_NAMES = ['Indoor', 'Light', 'Dark', 'Jack Black', 'Jack White', 'VAX'];
    let currentTheme = 0;
    
    function init() {
        const savedTheme = parseInt(localStorage.getItem('theme') || '0');
        currentTheme = savedTheme;
        if (currentTheme > 0) {
            document.documentElement.classList.add(THEMES[currentTheme]);
        }
    }
    
    function cycleTheme() {
        document.documentElement.classList.remove(...THEMES);
        currentTheme = (currentTheme + 1) % THEMES.length;
        if (currentTheme > 0) {
            document.documentElement.classList.add(THEMES[currentTheme]);
        }
        localStorage.setItem('theme', currentTheme);
        return THEME_NAMES[currentTheme];
    }
    
    function getCurrentThemeName() {
        return THEME_NAMES[currentTheme];
    }
    
    function getCanvasColors() {
        const rootStyles = getComputedStyle(document.documentElement);
        
        let text = rootStyles.getPropertyValue('--map-text').trim();
        let grid = rootStyles.getPropertyValue('--map-grid').trim();
        let axis = rootStyles.getPropertyValue('--map-axis').trim();
        
        if (!text) {
            text = document.documentElement.classList.contains('theme-light') ? '#1a1a1a' : '#ffffff';
        }
        if (!grid) {
            grid = document.documentElement.classList.contains('theme-light') ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
        }
        if (!axis) {
            axis = document.documentElement.classList.contains('theme-light') ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)';
        }
        
        return {
            text: text,
            textSecondary: text,
            stroke: text,
            grid: grid,
            axis: axis
        };
    }
    
    function getAntennaFill() {
        const rootStyles = getComputedStyle(document.documentElement);
        return rootStyles.getPropertyValue('--antenna-fill').trim() || 'rgba(0, 255, 255, 0.5)';
    }
    
    return {
        init,
        cycleTheme,
        getCurrentThemeName,
        getCanvasColors,
        getAntennaFill,
        THEMES,
        THEME_NAMES
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Themes;
}