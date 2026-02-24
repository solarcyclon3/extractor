// ==UserScript==
// @name         MediShark Data Extractor
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  Captures ANY m3u8 and converts video links to Master Playlists automatically.
// @author       You
// @match        https://medisharkbd.com/*
// @match        https://iframe.mediadelivery.net/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================
    // PART 1: IFRAME SPY (Inside the Player)
    // =========================================================
    if (window.location.hostname.includes('mediadelivery') || window.location.hostname.includes('bn-cdn')) {

        // --- THE CONVERTER LOGIC ---
        const processUrl = (url) => {
            if (!url.includes('.m3u8')) return;

            // Scenario A: We caught the Master Playlist directly
            if (url.includes('playlist.m3u8')) {
                window.top.postMessage({ type: 'MS_FOUND_URL', url: url }, '*');
                return;
            }

            // Scenario B: We caught a resolution file (e.g., .../480p/video.m3u8)
            // We force convert this to the Master Playlist
            if (url.includes('video.m3u8')) {
                // Regex to replace "/480p/video.m3u8" or "/720p/video.m3u8" with "/playlist.m3u8"
                // It preserves query parameters (?token=...) if they exist.
                const masterUrl = url.replace(/\/[0-9]+p\/video\.m3u8/, '/playlist.m3u8');
                window.top.postMessage({ type: 'MS_FOUND_URL', url: masterUrl }, '*');
            }
        };

        // Spy on XHR
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            if (typeof url === "string") processUrl(url);
            return originalOpen.apply(this, arguments);
        };

        // Spy on Fetch
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = args[0] ? args[0].toString() : "";
            if (typeof url === "string") processUrl(url);
            return originalFetch.apply(this, args);
        };
        return;
    }

    // =========================================================
    // PART 2: MAIN CONTROLLER (On MediShark)
    // =========================================================

    const STATE = {
        capturedLink: null,
        lastProcessedIndex: -1
    };

    // --- GLOBAL LISTENER ---
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'MS_FOUND_URL') {
            // Only capture if we haven't already for this video
            if (!STATE.capturedLink) {
                console.log(">> Generated Master Link:", event.data.url);
                STATE.capturedLink = event.data.url;
                updateLog(">> Link Captured!", "#00ff00");
            }
        }
    });

    // --- LOCAL STORAGE ---
    const getStorage = () => JSON.parse(localStorage.getItem('MS_DATA_V7') || '{"isRunning": false, "currentIndex": 0, "results": []}');
    const setStorage = (data) => localStorage.setItem('MS_DATA_V7', JSON.stringify(data));

    // --- UI CREATION ---
    function createUI() {
        if (document.getElementById('ms-ui-v7')) return;

        const div = document.createElement('div');
        div.id = 'ms-ui-v7';
        div.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            width: 300px;
            background: #111;
            color: #fff;
            border: 2px solid #00adef;
            z-index: 2147483647;
            padding: 15px;
            font-family: sans-serif;
            font-size: 12px;
            box-shadow: 0 0 20px rgba(0,0,0,0.8);
            border-radius: 8px;
        `;

        div.innerHTML = `
            <h3 style="margin:0 0 10px 0; color:#00adef; font-weight:bold;">MediShark Data Extractor</h3>
            <div id="ms-status" style="margin-bottom:10px; color:yellow;">Status: IDLE</div>
            <div style="display:flex; gap:5px; margin-bottom:5px;">
                <button id="ms-start" style="flex:1; background:#00adef; color:white; border:none; padding:8px; cursor:pointer; font-weight:bold;">START</button>
                <button id="ms-reset" style="flex:1; background:#d9534f; color:white; border:none; padding:8px; cursor:pointer; font-weight:bold;">RESET</button>
            </div>
            <button id="ms-dl" style="width:100%; background:#333; color:#777; border:none; padding:8px; cursor:not-allowed;" disabled>Download Results</button>
            <div id="ms-log" style="height:150px; overflow-y:auto; background:#000; border:1px solid #333; margin-top:10px; padding:5px; white-space:pre-wrap; font-family:monospace;"></div>
        `;
        document.body.appendChild(div);

        document.getElementById('ms-start').onclick = startExtraction;
        document.getElementById('ms-reset').onclick = resetExtraction;
        document.getElementById('ms-dl').onclick = downloadResults;

        // Restore UI State
        const store = getStorage();
        if (store.results.length > 0) {
            const btn = document.getElementById('ms-dl');
            btn.disabled = false;
            btn.style.background = "#28a745";
            btn.style.color = "white";
            btn.style.cursor = "pointer";
            btn.innerText = `Download ${store.results.length} Links`;
        }
        if (store.isRunning) {
            document.getElementById('ms-start').innerText = "RUNNING...";
        }
    }

    function updateLog(msg, color="#ccc") {
        const log = document.getElementById('ms-log');
        if(log) {
            log.innerHTML += `<div style="color:${color}; margin-bottom:2px;">${msg}</div>`;
            log.scrollTop = log.scrollHeight;
        }
    }

    function startExtraction() {
        const store = getStorage();
        store.isRunning = true;
        if (store.currentIndex === 0) store.results = [];
        setStorage(store);

        document.getElementById('ms-start').innerText = "RUNNING...";
        updateLog("--- Started ---", "cyan");
        mainLoop();
    }

    function resetExtraction() {
        localStorage.removeItem('MS_DATA_V7');
        location.reload();
    }

    function downloadResults() {
        const store = getStorage();
        if (!store.results.length) return;
        const txt = store.results.map(r => `${r.title}\n${r.link}`).join('\n\n');
        const blob = new Blob([txt], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'MediShark_Course_Links.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // --- HEARTBEAT LOOP ---
    async function mainLoop() {
        const store = getStorage();
        if (!store.isRunning) return;

        const playlistContainer = document.querySelector('div[class*="VideoPage_playlist_container"]');
        if (!playlistContainer) {
            updateLog("Waiting for playlist UI...", "orange");
            setTimeout(mainLoop, 2000);
            return;
        }

        const items = playlistContainer.querySelectorAll('a[href^="/study/courses"]');

        // DONE CHECK
        if (store.currentIndex >= items.length) {
            store.isRunning = false;
            setStorage(store);
            updateLog("ALL VIDEOS DONE!", "#00ff00");
            document.getElementById('ms-status').innerText = "COMPLETED";
            document.getElementById('ms-start').innerText = "FINISHED";
            return;
        }

        const currentItem = items[store.currentIndex];
        let title = currentItem.querySelector('h3') ? currentItem.querySelector('h3').innerText.trim() : `Video ${store.currentIndex + 1}`;

        document.getElementById('ms-status').innerText = `Processing: ${store.currentIndex + 1} / ${items.length}`;

        // CLICK IF NEW
        if (STATE.lastProcessedIndex !== store.currentIndex) {
            updateLog(`\n[${store.currentIndex + 1}] Clicking: ${title}`);
            STATE.lastProcessedIndex = store.currentIndex;
            STATE.capturedLink = null;

            currentItem.scrollIntoView({block: "center"});
            currentItem.click();

            // Wait 5 seconds for network activity to settle
            setTimeout(mainLoop, 5000);
            return;
        }

        // CHECK IF CAPTURED
        if (STATE.capturedLink) {
            store.results.push({ title: title, link: STATE.capturedLink });
            store.currentIndex++;
            setStorage(store);

            updateLog(`Saved! Moving to next...`, "#00ff00");

            const btn = document.getElementById('ms-dl');
            btn.disabled = false;
            btn.style.background = "#28a745";
            btn.style.color = "white";
            btn.style.cursor = "pointer";
            btn.innerText = `Download ${store.results.length} Links`;

            STATE.capturedLink = null;
            setTimeout(mainLoop, 1500); // Short delay before next click
        } else {
            // Still waiting
            updateLog("Scanning for link...", "#555");
            setTimeout(mainLoop, 2000);
        }
    }

    setTimeout(() => {
        createUI();
        const store = getStorage();
        if (store.isRunning) mainLoop();
    }, 2000);

})();
