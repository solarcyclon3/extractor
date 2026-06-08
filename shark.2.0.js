// ==UserScript==
// @name         MediShark Extractor
// @namespace    http://tampermonkey.net/
// @version      9.1
// @description  Flawless Auto-Clicker with strict URL-matching to prevent any desync or flashing.
// @author       You
// @match        https://medisharkbd.com/*
// @match        https://iframe.mediadelivery.net/*
// @match        https://*.bn-cdn.net/*
// @match        https://*.b-cdn.net/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================
    // PART 1: NETWORK SPY (Catches the M3U8 silently)
    // =========================================================
    const processUrl = (url) => {
        if (!url || typeof url !== 'string') return;
        if (!url.includes('.m3u8')) return;

        let masterUrl = url;
        // Always force the master playlist instead of a specific resolution
        if (url.includes('video.m3u8')) {
            masterUrl = url.replace(/\/[0-9]+p\/video\.m3u8/, '/playlist.m3u8');
        }

        window.top.postMessage({ type: 'MS_FOUND_URL', url: masterUrl }, '*');
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === "string") processUrl(url);
        return originalOpen.apply(this, arguments);
    };

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = args[0] ? args[0].toString() : "";
        if (typeof url === "string") processUrl(url);
        return originalFetch.apply(this, args);
    };

    // =========================================================
    // PART 2: MAIN CONTROLLER (Runs ONLY on MediShark)
    // =========================================================
    if (!window.location.hostname.includes('medisharkbd.com')) return;

    let LATEST_FOUND_LINK = null;
    let CURRENT_PATH = window.location.pathname;

    const getStorage = () => JSON.parse(localStorage.getItem('MS_DATA_V9') || '{"isRunning": false, "currentIndex": 0, "results": []}');
    const setStorage = (data) => localStorage.setItem('MS_DATA_V9', JSON.stringify(data));

    // --- CATCH NETWORK MESSAGE ---
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'MS_FOUND_URL') {
            LATEST_FOUND_LINK = event.data.url;
        }
    });

    // --- STRICT IDLE SYNC ENGINE ---
    // Runs twice a second. Syncs the UI strictly based on the URL path.
    setInterval(() => {
        const store = getStorage();

        // 1. Detect if user navigated to a new video URL
        if (window.location.pathname !== CURRENT_PATH) {
            CURRENT_PATH = window.location.pathname;
            LATEST_FOUND_LINK = null; // Instantly flush old link so it never flashes!
        }

        // 2. Find the exact Title based strictly on the current URL
        let activeTitle = "Loading title...";
        const activePlaylistLink = document.querySelector(`a[href="${CURRENT_PATH}"]`);

        if (activePlaylistLink) {
            const h3 = activePlaylistLink.querySelector('h3');
            if (h3) activeTitle = h3.innerText.trim();
        } else {
            const h1 = document.querySelector('h1');
            if (h1) activeTitle = h1.innerText.trim();
        }

        // 3. Update the UI
        const uiTitle = document.getElementById('ms-current-title');
        const uiLink = document.getElementById('ms-current-link');

        if (uiTitle && uiTitle.innerText !== activeTitle) {
            uiTitle.innerText = activeTitle;
        }

        if (uiLink) {
            if (LATEST_FOUND_LINK) {
                if (uiLink.innerText !== LATEST_FOUND_LINK) {
                    uiLink.innerText = LATEST_FOUND_LINK;
                    uiLink.style.color = '#00ff00';
                }
            } else {
                if (uiLink.innerText !== "Scanning for link...") {
                    uiLink.innerText = "Scanning for link...";
                    uiLink.style.color = 'yellow';
                }
            }
        }
    }, 500);

    // --- UI CREATION ---
    function createUI() {
        if (document.getElementById('ms-ui-v9')) return;

        const div = document.createElement('div');
        div.id = 'ms-ui-v9';
        div.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            width: 320px;
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
            <h3 style="margin:0 0 10px 0; color:#00adef; font-weight:bold;">MediShark Extractor v9.1</h3>
            <div id="ms-status" style="margin-bottom:10px; color:yellow; font-weight:bold;">Status: IDLE</div>

            <div style="background:#222; padding:10px; margin-bottom:10px; border-radius:5px; border:1px solid #444;">
                <div style="color:#aaa; font-size:10px; margin-bottom:2px;">Currently Playing:</div>
                <div id="ms-current-title" style="color:#00adef; font-weight:bold; margin-bottom:6px; word-break: break-word;">Waiting...</div>
                <div style="color:#aaa; font-size:10px; margin-bottom:2px;">M3U8 Link:</div>
                <div id="ms-current-link" style="color:yellow; word-break: break-all; font-family:monospace; font-size:10px;">Scanning for link...</div>
            </div>

            <div style="display:flex; gap:5px; margin-bottom:5px;">
                <button id="ms-start" style="flex:1; background:#00adef; color:white; border:none; padding:8px; cursor:pointer; font-weight:bold; border-radius:4px;">START AUTO</button>
                <button id="ms-reset" style="flex:1; background:#d9534f; color:white; border:none; padding:8px; cursor:pointer; font-weight:bold; border-radius:4px;">RESET</button>
            </div>
            <button id="ms-dl" style="width:100%; background:#333; color:#777; border:none; padding:8px; cursor:not-allowed; border-radius:4px; font-weight:bold;" disabled>Download Results</button>
            <div id="ms-log" style="height:150px; overflow-y:auto; background:#000; border:1px solid #333; margin-top:10px; padding:5px; white-space:pre-wrap; font-family:monospace;"></div>
        `;
        document.body.appendChild(div);

        document.getElementById('ms-start').onclick = startExtraction;
        document.getElementById('ms-reset').onclick = resetExtraction;
        document.getElementById('ms-dl').onclick = downloadResults;

        const store = getStorage();
        if (store.results.length > 0) {
            updateDownloadButton(store.results.length);
        }
        if (store.isRunning) {
            document.getElementById('ms-start').innerText = "RUNNING...";
        }
    }

    function updateLog(msg, color="#ccc") {
        const log = document.getElementById('ms-log');
        if(log) {
            log.innerHTML += `<div style="color:${color}; margin-bottom:4px;">${msg}</div>`;
            log.scrollTop = log.scrollHeight;
        }
    }

    function updateDownloadButton(count) {
        const btn = document.getElementById('ms-dl');
        if (count > 0) {
            btn.disabled = false;
            btn.style.background = "#28a745";
            btn.style.color = "white";
            btn.style.cursor = "pointer";
            btn.innerText = `Download ${count} Links`;
        }
    }

    function startExtraction() {
        const store = getStorage();
        store.isRunning = true;
        store.currentIndex = 0;
        store.results = [];
        setStorage(store);

        LATEST_FOUND_LINK = null;

        document.getElementById('ms-start').innerText = "RUNNING...";
        updateLog("--- Auto-Clicker Started ---", "cyan");
        mainLoop();
    }

    function resetExtraction() {
        localStorage.removeItem('MS_DATA_V9');
        location.reload();
    }

    function downloadResults() {
        const store = getStorage();
        if (!store.results.length) return;
        const txt = store.results.map(r => `${r.title}\n${r.link}`).join('\n\n');
        const blob = new Blob([txt], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'MediShark_Full_Playlist_v9.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // --- BULLETPROOF AUTOMATION LOOP ---
    async function mainLoop() {
        const store = getStorage();
        if (!store.isRunning) return;

        const playlistContainer = document.getElementById('playlist-container') || document.querySelector('div[class*="playlist_container"]');
        if (!playlistContainer) {
            updateLog("Waiting for playlist to load...", "orange");
            setTimeout(mainLoop, 2000);
            return;
        }

        const items = playlistContainer.querySelectorAll('a[href^="/study/courses"]');

        if (store.currentIndex >= items.length) {
            store.isRunning = false;
            setStorage(store);
            updateLog("ALL VIDEOS COMPLETED!", "#00ff00");
            document.getElementById('ms-status').innerText = "COMPLETED";
            document.getElementById('ms-start').innerText = "FINISHED";
            return;
        }

        const currentItem = items[store.currentIndex];

        // Ensure we handle absolute and relative URLs properly
        const targetPath = new URL(currentItem.href, window.location.origin).pathname;
        const targetTitle = currentItem.querySelector('h3') ? currentItem.querySelector('h3').innerText.trim() : `Video ${store.currentIndex + 1}`;

        document.getElementById('ms-status').innerText = `Processing: ${store.currentIndex + 1} / ${items.length}`;

        // STEP 1: Verify we are on the exact URL of the target video
        if (window.location.pathname !== targetPath) {
            updateLog(`[${store.currentIndex + 1}] Clicking: ${targetTitle}`);

            LATEST_FOUND_LINK = null; // Flush immediately
            currentItem.scrollIntoView({block: "center", behavior: "smooth"});
            currentItem.click();

            // Give the website 3 seconds to update the URL and trigger player load
            setTimeout(mainLoop, 3000);
            return;
        }

        // STEP 2: We are on the right URL. Wait strictly for the network to catch the link.
        if (!LATEST_FOUND_LINK) {
            updateLog("Waiting for network link...", "#888");
            setTimeout(mainLoop, 1500);
            return;
        }

        // STEP 3: We have the link! Save it and move on.
        // Anti-duplicate protection just in case
        const lastSavedLink = store.results.length > 0 ? store.results[store.results.length - 1].link : null;

        if (LATEST_FOUND_LINK !== lastSavedLink) {
            store.results.push({ title: targetTitle, link: LATEST_FOUND_LINK });
            updateLog(`Saved successfully!`, "#00ff00");
        }

        store.currentIndex++;
        setStorage(store);

        updateDownloadButton(store.results.length);

        LATEST_FOUND_LINK = null; // Flush so we don't accidentally save it for the next video
        setTimeout(mainLoop, 1000); // Trigger next video
    }

    // Launch UI
    setTimeout(() => {
        createUI();
        const store = getStorage();
        if (store.isRunning) mainLoop();
    }, 2000);

})();
