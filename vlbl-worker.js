// vlbl-worker.js — Web Worker для решения задачи VLBL
// Вынесение тяжёлых вычислений в отдельный поток

importScripts('vlbl-solver.js');

let currentRequestId = null;

self.onmessage = function(e) {
    const { action, data } = e.data;

    if (action === 'solve') {
        currentRequestId = data.requestId;
        
        try {
            const result = VLBLsolver.locate2D(
                data.bases,
                data.prevLat,
                data.prevLon,
                data.beaconDepth,
                data.options || {}
            );
            
            self.postMessage({
                action: 'solve_result',
                requestId: currentRequestId,
                result,
            });
        } catch (err) {
            self.postMessage({
                action: 'solve_error',
                requestId: currentRequestId,
                error: err.message,
            });
        }
    } else if (action === 'solve_all') {
        // Множественное решение: массив маяков
        const results = {};
        const errors = {};
        
        for (const task of data.tasks) {
            try {
                const result = VLBLsolver.locate2D(
                    task.bases,
                    task.prevLat,
                    task.prevLon,
                    task.beaconDepth,
                    task.options || {}
                );
                results[task.addr] = result;
            } catch (err) {
                errors[task.addr] = err.message;
            }
        }
        
        self.postMessage({
            action: 'solve_all_result',
            requestId: data.requestId,
            results,
            errors,
        });
    } else if (action === 'ping') {
        self.postMessage({ action: 'pong' });
    }
};