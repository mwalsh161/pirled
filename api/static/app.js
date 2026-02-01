const app = document.getElementById("app");

// ---------- Utilities ----------
async function fetchTxt(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url);
    return r.text();
}

async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url);
    return r.json();
}

async function postForm(url, data) {
    const resp = await fetch(url, {
        method: "POST",
        body: new URLSearchParams(data),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp;
}

function deviceURL(dev, path) {
    return `http://${dev.host}:${dev.port}${path}`;
}

function cmpBuff(a, b){
    return a.byteLength==b.byteLength && new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i])
}

async function fetchRaw(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url);
    return await r.arrayBuffer();
}

const littleEndian = true;
function processSchema(schema, buff, offset) {
    let dat = {};
    for (const field of schema) {
        let obj;
        if (field.arrayLen > 0) {
            obj = [];
            for (let i = 0; i < field.arrayLen; i ++ ){
                const subobj = processSchema(field.sub, buff, offset);
                offset = subobj.offset;
                obj.push(subobj.dat)
            }
        } else {
            switch (field.type + field.size * 8) {
                case "uint8": obj = buff.getUint8(offset); break;
                case "uint16": obj = buff.getUint16(offset, littleEndian); break;
                case "int16": obj = buff.getInt16(offset, littleEndian); break;
                case "int32": obj = buff.getInt32(offset, littleEndian); break;
                case "int64": obj = Number(buff.getBigInt64(offset, littleEndian)); break;
                default: obj = null; break;
            }
            offset += field.size;
        }
        dat[field.name] = obj;
    }
    return {dat, offset};
}

// ---------- Flash animation ----------
function flash(el, success = true) {
    const target = el.closest(".flash-wrapper") || el;
    const cls = success ? "flash-success" : "flash-failure";
    target.classList.remove(cls);
    void target.offsetWidth; // force reflow
    target.classList.add(cls);
    target.addEventListener("animationend", () => target.classList.remove(cls), { once: true });
}
// ---------- Render helpers ----------
const STATE_MAP = {
    0: "OFF",
    1: "WAITING_ON",
    2: "ON",
    3: "WAITING_OFF"
};

// Skeleton for LEDs
function renderLedSkeleton(ledCount, pirCount) {
    const leds = Array.from({ length: ledCount }).map((_, i) => {
        const onCheckboxes = Array(pirCount).fill(0).map((_, j) => `
            <label>
                <div class="flash-wrapper">
                    <input type="checkbox" data-led="${i}" data-bit="${j}" data-mask="on">
                    ${j < 4 ? `PIR ${j}` : `Virtual ${j-4}`}
                </div>
            </label>
        `).join("<br>");

        const offCheckboxes = Array(pirCount).fill(0).map((_, j) => `
            <label>
                <div class="flash-wrapper">
                    <input type="checkbox" data-led="${i}" data-bit="${j}" data-mask="off">
                    ${j < 4 ? `PIR ${j}` : `Virtual ${j-4}`}
                </div>
            </label>
        `).join("<br>");

        return `
            <fieldset data-led-index="${i}">
                <legend>LED ${i}</legend>

                <label>
                    <div class="flash-wrapper">
                        Brightness
                        <input type="range"
                               class="led-slider"
                               min="0" max="1023"
                               data-led="${i}" data-field="brightness"
                               style="--live:0;">
                        <small class="led-state">UNKNOWN</small>
                    </div>
                </label><br>

                <label>
                    <div class="flash-wrapper">
                        Ramp On Time (ms)
                        <input type="number" step="1000" min="0" data-led="${i}" data-field="rampOnMs">
                    </div>
                </label><br>

                <label>
                    <div class="flash-wrapper">
                        Stay On Time (ms)
                        <input type="number" step="1000" min="0" data-led="${i}" data-field="holdOnMs">
                    </div>
                </label><br>

                <label>
                    <div class="flash-wrapper">
                        Ramp Off Time (ms)
                        <input type="number" step="1000" min="0" data-led="${i}" data-field="rampOffMs">
                    </div>
                </label><br>

                <label>
                    <div class="flash-wrapper">
                        Wait On Time (ms)
                        <input type="number" step="1000" min="0" data-led="${i}" data-field="waitOnMs">
                    </div>
                </label><br>

                <fieldset class="pir-mask">
                    <legend>PIR Mask</legend>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div>
                            <strong>On</strong><br>
                            ${onCheckboxes}
                        </div>
                        <div>
                            <strong>Off</strong><br>
                            ${offCheckboxes}
                        </div>
                    </div>
                </fieldset>
            </fieldset>
        `;
    });

    return leds.join("");
}

// Skeleton for PIR override
function renderPirOverrideSkeleton(pirCount) {
    const checkboxes = Array(pirCount).fill(0).map((_, j) => `
        <label>
            <div class="flash-wrapper">
                <input type="checkbox" data-field="pir_override" data-bit="${j}">
                ${j < 4 ? `PIR ${j}` : `Virtual ${j-4}`}
            </div>
        </label>
    `).join("<br>");

    return `<fieldset class="pir-override"><legend>PIR Override</legend>${checkboxes}</fieldset>`;
}

// ---------- Value update pass ----------
function updateLedValues(fieldset, ledConf, ledState) {
    // Numeric inputs from config
    ['brightness', 'rampOnMs', 'holdOnMs', 'rampOffMs', 'waitOnMs'].forEach(field => {
        const el = fieldset.querySelector(`[data-field="${field}"]`);
        if (document.activeElement !== el) el.value = ledConf[field];
    });

    // CSS var for live brightness from status
    const brightnessInput = fieldset.querySelector('[data-field="brightness"]');
    if (brightnessInput) brightnessInput.style.setProperty('--live', ledState.brightness);

    // LED state label from status
    const stateText = STATE_MAP[ledState.state] ?? 'UNKNOWN';
    const stateLabel = fieldset.querySelector('.led-state');
    if (stateLabel) stateLabel.textContent = stateText;

    // Update PIR mask checkboxes (config)
    fieldset.querySelectorAll('.pir-mask input[data-mask="on"]').forEach(cb => {
        const bit = Number(cb.dataset.bit);
        cb.checked = !!(ledConf.pirMaskOn & (1 << bit));
    });
    fieldset.querySelectorAll('.pir-mask input[data-mask="off"]').forEach(cb => {
        const bit = Number(cb.dataset.bit);
        cb.checked = !!(ledConf.pirMaskOff & (1 << bit));
    });
}

function updatePirOverride(pirOverride, pirState) {
    const val = pirOverride ?? 0;
    const checkboxes = app.querySelectorAll('.pir-override input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const bit = Number(cb.dataset.bit);
        cb.checked = Boolean(val & (1 << bit));
        cb.classList.toggle('pir-active', Boolean(pirState & (1 << bit)));
    });
}

// ---------- URL helpers ----------
function getDeviceNameFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get("device");
}

function setDeviceInURL(name) {
    const params = new URLSearchParams(window.location.search);
    params.set("device", name);
    window.history.replaceState(null, "", "?" + params.toString());
}

// ---------- Main load ----------
async function load() {
    const devices = await fetchJSON("api/devices");
    if (!devices.length) {
        app.innerHTML = "<h3>No pirled-controller discovered</h3>";
        return;
    }

    // Get device from URL, or use first device
    const urlName = getDeviceNameFromURL();
    let dev = devices.find(d => d.name === urlName);
    if (!dev) {
        dev = devices[0];
        setDeviceInURL(dev.name);
    }

    // Device selector
    const deviceOptions = devices.map(d => 
        `<option value="${d.name}" ${d.name === dev.name ? "selected" : ""}>${d.name} (${d.host}:${d.port})</option>`
    ).join("");
    
    const deviceSelectorHTML = `
        <div id="deviceSelector" style="margin-bottom: 1rem;">
            <label for="deviceDropdown">Select Device:</label>
            <select id="deviceDropdown">${deviceOptions}</select>
        </div>
    `;

    app.innerHTML = `
        ${deviceSelectorHTML}
        <h3>LED Configuration</h3>
        <div id="ledContainer">${renderLedSkeleton(4, 8)}</div>
        
        <h3>PIR Override</h3>
        <div id="pirOverrideContainer">${renderPirOverrideSkeleton(8)}</div>
        
        <h3>Save Debounce</h3>
        <button id="saveBtn">Save</button>
        <div class="flash-wrapper">
        Debounce (ms)
        <input id="debounce" type="number" value="0" min="0">
        </div>
        
        <small id="lastUpdate">Last update:</small>
        <small id="configSaved">Config saved: </small>
        
        <details>
        <summary>Logs</summary>
        <button id="refreshLogs">Refresh Logs</button>
        <div class="logs"></div>
        </details>
        
        <div id="fineprint" style="font-size: 0.75rem; color: #999; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; text-align: center;"></div>
    `;

    let updateBusy = false;    // Prevents polling while a POST/DOM update is in flight
    let skipNextPoll = false;  // Skip immediate poll after POST to avoid redundant GET
    let lastChanged = false;   // Track if last state update was a change (for skip reschedule)
    let lastMsg = null; // Used to detect changes.

    // Parse state response and update DOM. Sets lastChanged based on state.
    function processState(rawBuf) {
        const {dat: combined, offset} = processSchema(schema, new DataView(rawBuf), 0);
        if (offset != rawBuf.byteLength) throw new Error(`Schema doesn't match payload`);

        const changed = lastMsg ? !cmpBuff(lastMsg, rawBuf) : true;
        lastChanged = changed;
        
        // Update DOM only if state changed
        if (changed) {
            for (let i = 0; i < 4; i ++){
                const fieldset = app.querySelector(`fieldset[data-led-index="${i}"]`);
                updateLedValues(fieldset, combined.ledConfigs[i], combined.ledStates[i]);
            }
            updatePirOverride(combined.pirOverride, combined.pirState);
            document.getElementById("lastUpdate").textContent = `Last update: ${new Date().toLocaleTimeString()}`;
        }

        document.getElementById("configSaved").textContent = `Config saved: ${new Date(combined.timestamp * 1000).toLocaleString()}`;
        
        lastMsg = rawBuf;
    }

    // ---------- POST helpers ----------
    async function updateLedField(el) {
        const data = { index: el.dataset.led };
        data[el.dataset.field] = el.type === 'number' ? Number(el.value) : el.value;
        updateBusy = true;
        try {
            const resp = await postForm(deviceURL(dev, "/config/led"), data);
            const buf = await resp.arrayBuffer();
            processState(buf);
            flash(el, true);
            skipNextPoll = true;  // We just got authoritative state, skip the next poll
        }
        catch { flash(el, false); }
        finally { updateBusy = false; }
    }

    async function updatePirMask(el) {
        const ledIndex = el.dataset.led;
        const maskType = el.dataset.mask;
        const bits = Array.from(app.querySelectorAll(`input[data-led="${ledIndex}"][data-mask="${maskType}"][type="checkbox"]`))
            .filter(i => i.checked)
            .map(i => Number(i.dataset.bit));
        let mask = 0; bits.forEach(b => mask |= 1 << b);
        const param = maskType === 'on' ? 'pirMaskOn' : 'pirMaskOff';
        updateBusy = true;
        try {
            const resp = await postForm(deviceURL(dev, "/config/led"), { index: ledIndex, [param]: mask });
            const buf = await resp.arrayBuffer();
            processState(buf);
            flash(el, true);
            skipNextPoll = true;
        }
        catch { flash(el, false); }
        finally { updateBusy = false; }
    }

    async function updatePirOverrideField(el) {
        const bits = Array.from(app.querySelectorAll('input[data-field="pir_override"]'))
            .filter(i => i.checked)
            .map(i => Number(i.dataset.bit));
        let val = 0; bits.forEach(b => val |= 1 << b);
        updateBusy = true;
        try {
            const resp = await postForm(deviceURL(dev, "/pir_override"), { val });
            const buf = await resp.arrayBuffer();
            processState(buf);
            flash(el, true);
            skipNextPoll = true;
        }
        catch { flash(el, false); }
        finally { updateBusy = false; }
    }

    // ---------- One-time Refresh ----------
    const schema = await fetchJSON(deviceURL(dev, "/combined.schema"));
    const saveDebounce = await fetchJSON(deviceURL(dev, "/save_debounce"));
    document.getElementById("debounce").value = saveDebounce;
    const firmwareVersion = await fetchJSON(deviceURL(dev, "/firmware_version"));
    document.getElementById("fineprint").textContent = `Firmware: ${firmwareVersion.version}`;

    // ---------- Refresh loop ----------
    async function refresh() {
        try {
            if (skipNextPoll) {
                skipNextPoll = false;
            } else if (!updateBusy) {
                const buf = await fetchRaw(deviceURL(dev, "/combined.bin"));
                processState(buf);
            }
            
            setTimeout(refresh, lastChanged ? 10 : 500);
        } catch (e) {
            console.error("Refresh error:", e);
            // Network error, try again soon
            setTimeout(refresh, 100);
        }
    }

    // Logs refresh
    async function refreshLogs() {
        const logs = await fetchTxt(deviceURL(dev, "/logs"));
        app.querySelector('.logs').textContent = logs;
    }

    // ---------- Attach input handlers ----------
    document.querySelectorAll('#ledContainer input').forEach(inp => {
        if (['rampOnMs','holdOnMs','rampOffMs', 'waitOnMs'].includes(inp.dataset.field)) {
            inp.addEventListener('change', () => updateLedField(inp));
        } else if (inp.dataset.field === 'brightness') {
            // Fast slider updates with lock
            inp.addEventListener('input', async () => {
                if (updateBusy) return;
                await updateLedField(inp);
            });
        } else if (inp.dataset.bit !== undefined && inp.dataset.mask !== undefined) {
            inp.addEventListener('change', () => updatePirMask(inp));
        }
    });

    document.querySelectorAll('#pirOverrideContainer input[data-field="pir_override"]').forEach(inp => {
        inp.addEventListener('change', () => updatePirOverrideField(inp));
    });

    document.getElementById("refreshLogs").onclick = refreshLogs;

    // Device selector handler
    const deviceDropdown = document.getElementById("deviceDropdown");
    if (deviceDropdown) {
        deviceDropdown.addEventListener("change", (e) => {
            const selectedName = e.target.value;
            const selectedDevice = devices.find(d => d.name === selectedName);
            if (selectedDevice) {
                setDeviceInURL(selectedName);
                load();
            }
        });
    }

    refresh();
}

load();
