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

async function fetchRaw(schema, url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url);
    const raw = await r.arrayBuffer();
    const dat = processSchema(schema, new DataView(raw), 0).dat
    return {dat, raw};
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
    1: "ON",
    2: "WAITING_OFF"
};

// Skeleton for LEDs
function renderLedSkeleton(ledCount, pirCount) {
    const leds = Array.from({ length: ledCount }).map((_, i) => {
        const pirCheckboxes = Array(pirCount).fill(0).map((_, j) => `
            <label>
                <div class="flash-wrapper">
                    <input type="checkbox" data-led="${i}" data-bit="${j}">
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

                <fieldset class="pir-mask">
                    <legend>PIR Mask</legend>
                    ${pirCheckboxes}
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
    ['brightness', 'rampOnMs', 'holdOnMs', 'rampOffMs'].forEach(field => {
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
    fieldset.querySelectorAll('.pir-mask input[type="checkbox"]').forEach(cb => {
        const bit = Number(cb.dataset.bit);
        cb.checked = !!(ledConf.pirMask & (1 << bit));
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

// ---------- Main load ----------
async function load() {
    const devices = await fetchJSON("api/devices");
    if (!devices.length) {
        app.innerHTML = "<h3>No pirled-controller discovered</h3>";
        return;
    }

    const dev = devices[0];

    app.innerHTML = `
        <small>${dev.name} (${dev.host}:${dev.port})</small>        
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
    `;

    let sliderUpdateBusy = false;

    // ---------- POST helpers ----------
    async function updateLedField(el) {
        const data = { index: el.dataset.led };
        data[el.dataset.field] = el.type === 'number' ? Number(el.value) : el.value;
        try { await postForm(deviceURL(dev, "/config/led"), data); flash(el, true); }
        catch { flash(el, false); }
    }

    async function updatePirMask(el) {
        const ledIndex = el.dataset.led;
        const bits = Array.from(app.querySelectorAll(`input[data-led="${ledIndex}"][type="checkbox"]`))
            .filter(i => i.checked)
            .map(i => Number(i.dataset.bit));
        let mask = 0; bits.forEach(b => mask |= 1 << b);
        try { await postForm(deviceURL(dev, "/config/led"), { index: ledIndex, pirMask: mask }); flash(el, true); }
        catch { flash(el, false); }
    }

    async function updatePirOverrideField(el) {
        const bits = Array.from(app.querySelectorAll('input[data-field="pir_override"]'))
            .filter(i => i.checked)
            .map(i => Number(i.dataset.bit));
        let val = 0; bits.forEach(b => val |= 1 << b);
        try { await postForm(deviceURL(dev, "/pir_override"), { val }); flash(el, true); }
        catch { flash(el, false); }
    }

    // ---------- Refresh ----------
    const schema = await fetchJSON(deviceURL(dev, "/combined.schema"));
    const saveDebounce = await fetchJSON(deviceURL(dev, "/save_debounce"));
    document.getElementById("debounce").value = saveDebounce;

    let lastMsg = null; // Used to detect changes.

    async function refresh() {
        const currentMsg = await fetchRaw(schema, deviceURL(dev, "/combined.bin"));
        const combined = currentMsg.dat;
        const changed = lastMsg ? !cmpBuff(lastMsg.raw, currentMsg.raw) : true;
        lastMsg = currentMsg;

        // Update all dynamic values
        for (let i = 0; i < 4; i ++){
            const fieldset = app.querySelector(`fieldset[data-led-index="${i}"]`);
            updateLedValues(fieldset, combined.ledConfigs[i], combined.ledStates[i]);
        }
        updatePirOverride(combined.pirOverride, combined.pirState);

        document.getElementById("lastUpdate").textContent = `Last update: ${new Date().toLocaleTimeString()}`;
        document.getElementById("configSaved").textContent = `Config saved: ${new Date(combined.timestamp * 1000).toLocaleString()}`;

        setTimeout(refresh, changed ? 10 : 500)
    }

    // Logs refresh
    async function refreshLogs() {
        const logs = await fetchTxt(deviceURL(dev, "/logs"));
        app.querySelector('.logs').textContent = logs;
    }

    // ---------- Attach input handlers ----------
    document.querySelectorAll('#ledContainer input').forEach(inp => {
        if (['rampOnMs','holdOnMs','rampOffMs'].includes(inp.dataset.field)) {
            inp.addEventListener('change', () => updateLedField(inp));
        } else if (inp.dataset.field === 'brightness') {
            // Fast slider updates with lock
            inp.addEventListener('input', async () => {
                if (sliderUpdateBusy) return;
                sliderUpdateBusy = true;
                try { await updateLedField(inp); }
                finally { sliderUpdateBusy = false; }
            });
        } else if (inp.dataset.bit !== undefined) {
            inp.addEventListener('change', () => updatePirMask(inp));
        }
    });

    document.querySelectorAll('#pirOverrideContainer input[data-field="pir_override"]').forEach(inp => {
        inp.addEventListener('change', () => updatePirOverrideField(inp));
    });

    document.getElementById("refreshLogs").onclick = refreshLogs;

    refresh();
}

load();
