// log-storage.js — Хранилище логов в IndexedDB
// Прозрачная запись без запросов к пользователю

const LogStorage = (() => {

    const DB_NAME = 'zima2_logs';
    const DB_VERSION = 1;
    const STORE_NAME = 'log_entries';

    let db = null;
    let isOpen = false;

    // ========== ОТКРЫТИЕ ==========

    async function open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME, {
                        keyPath: 'id',
                        autoIncrement: true,
                    });
                }
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                isOpen = true;
                resolve();
            };

            request.onerror = (event) => {
                console.error('[LogStorage] Ошибка открытия IndexedDB:', event.target.error);
                isOpen = false;
                reject(event.target.error);
            };
        });
    }

    // ========== ЗАПИСЬ ==========

    function write(formattedLine) {
        if (!isOpen || !db) return;

        try {
            const tx = db.transaction([STORE_NAME], 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.add({
                line: formattedLine,
                timestamp: Date.now(),
            });
            tx.onerror = (e) => {
                console.warn('[LogStorage] Ошибка записи:', e.target.error);
            };
        } catch (e) {
            console.warn('[LogStorage] Ошибка транзакции:', e);
        }
    }

    // ========== ЧТЕНИЕ ==========

    async function readAll() {
        return new Promise((resolve, reject) => {
            if (!isOpen || !db) {
                resolve([]);
                return;
            }

            try {
                const tx = db.transaction([STORE_NAME], 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const request = store.getAll();

                request.onsuccess = () => {
                    const entries = request.result || [];
                    resolve(entries.map(e => e.line));
                };

                request.onerror = (e) => {
                    console.error('[LogStorage] Ошибка чтения:', e.target.error);
                    resolve([]);
                };
            } catch (e) {
                console.warn('[LogStorage] Ошибка транзакции чтения:', e);
                resolve([]);
            }
        });
    }

    // ========== ОЧИСТКА ==========

    async function clear() {
        return new Promise((resolve, reject) => {
            if (!isOpen || !db) {
                resolve();
                return;
            }

            try {
                const tx = db.transaction([STORE_NAME], 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.clear();

                request.onsuccess = () => resolve();
                request.onerror = (e) => {
                    console.error('[LogStorage] Ошибка очистки:', e.target.error);
                    resolve();
                };
            } catch (e) {
                console.warn('[LogStorage] Ошибка транзакции очистки:', e);
                resolve();
            }
        });
    }

    // ========== РАЗМЕР ==========

    async function count() {
        return new Promise((resolve, reject) => {
            if (!isOpen || !db) {
                resolve(0);
                return;
            }

            try {
                const tx = db.transaction([STORE_NAME], 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const request = store.count();

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(0);
            } catch (e) {
                resolve(0);
            }
        });
    }

    // ========== ЗАКРЫТИЕ ==========

    function close() {
        if (db) {
            try { db.close(); } catch (e) {}
            db = null;
        }
        isOpen = false;
    }

    // ========== ПУБЛИЧНЫЙ API ==========

    return {
        open,
        write,
        readAll,
        clear,
        count,
        close,
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LogStorage;
}