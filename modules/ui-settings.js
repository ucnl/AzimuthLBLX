// modules/ui-settings.js
// Управление настройками приложения

const UISettings = (() => {
    let settingsOverlay = null;
    let isVisible = false;
    let onApplyCallback = null;
    let onCloseCallback = null;
    
    // Колбэки для получения/сохранения данных
    let getSettingsData = null;
    let applySettingsData = null;
    let loadSettingsData = null;
    
    function init(overlayId, callbacks) {
        settingsOverlay = document.getElementById(overlayId);
        onApplyCallback = callbacks?.onApply || null;
        onCloseCallback = callbacks?.onClose || null;
        getSettingsData = callbacks?.getSettingsData || null;
        applySettingsData = callbacks?.applySettingsData || null;
        loadSettingsData = callbacks?.loadSettingsData || null;
    }
    
    function open() {
        if (!settingsOverlay) return;
        isVisible = true;
        settingsOverlay.classList.add('visible');
        if (getSettingsData) getSettingsData();  // обновить UI перед показом
    }
    
    function close() {
        if (!settingsOverlay) return;
        isVisible = false;
        settingsOverlay.classList.remove('visible');
        if (onCloseCallback) onCloseCallback();
    }
    
    function isOpen() {
        return isVisible;
    }
    
    function apply() {
        if (applySettingsData) applySettingsData();
        if (onApplyCallback) onApplyCallback();
        close();
    }
    
    function load() {
        if (loadSettingsData) loadSettingsData();
    }
    
    function getElement(id) {
        return document.getElementById(id);
    }
    
    function getValue(id, defaultValue = '') {
        const el = document.getElementById(id);
        return el ? el.value : defaultValue;
    }
    
    function setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }
    
    function getCheckbox(id) {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    }
    
    function setCheckbox(id, checked) {
        const el = document.getElementById(id);
        if (el) el.checked = checked;
    }
    
    function getInt(id, defaultValue = 0) {
        return parseInt(getValue(id, defaultValue)) || defaultValue;
    }
    
    function getFloat(id, defaultValue = 0) {
        return parseFloat(getValue(id, defaultValue)) || defaultValue;
    }
    
    // Функции для работы с маской адресов
    function buildAddressCheckboxes() {
        const container = document.getElementById('addr-checkboxes');
        if (!container) return;
        
        let html = '';
        for (let addr = 0; addr < 16; addr++) {
            html += `
                <label id="aclbl_${addr}">
                    <input type="checkbox" value="${addr}" onchange="App.onAddrCheckboxChanged()">
                    ${addr + 1}
                </label>`;
        }
        container.innerHTML = html;
    }
    
    function syncCheckboxesFromMask(mask) {
        for (let addr = 0; addr < 16; addr++) {
            const cb = document.querySelector(`#aclbl_${addr} input`);
            const lbl = document.getElementById(`aclbl_${addr}`);
            if (cb) {
                const bit = 1 << addr;
                cb.checked = (mask & bit) !== 0;
                if (lbl) lbl.classList.toggle('checked', cb.checked);
            }
        }
    }
    
    function getMaskFromCheckboxes() {
        let mask = 0;
        for (let addr = 0; addr < 16; addr++) {
            const cb = document.querySelector(`#aclbl_${addr} input`);
            if (cb && cb.checked) mask |= 1 << addr;
        }
        return mask;
    }
    
    function updateMaskInput(mask) {
        const maskInput = document.getElementById('cfg-mask');
        if (maskInput) maskInput.value = mask;
    }
    
    return {
        init,
        open,
        close,
        apply,
        load,
        isOpen,
        getElement,
        getValue,
        setValue,
        getCheckbox,
        setCheckbox,
        getInt,
        getFloat,
        buildAddressCheckboxes,
        syncCheckboxesFromMask,
        getMaskFromCheckboxes,
        updateMaskInput
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UISettings;
}