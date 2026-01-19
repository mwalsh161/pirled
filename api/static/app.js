const app = document.getElementById("app");

let refreshIntervalId = null; // holds the interval ID
const REFRESH_PERIOD_MS = 5000; // default: 5 seconds

// ---------- Utilities ----------
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

function renderStatus(status) {
    const rows = [];
    
    // Expand PIR masks
    for (let i = 0; i < 8; i++) {
        rows.push(`<tr><td>PIR ${i}</td><td>${!!(status.pir & (1 << i))}</td></tr>`);
    }
    let ledMapped = [];
    for (let i = 0; i < 4; i++) {
        ledMapped.push(STATE_MAP[status.leds[i]] ?? `UNKNOWN (${v})`)
    }
    rows.push(`<tr><td>leds</td><td>${ledMapped.join(", ")}</td></tr>`);
    
    return `<h3>Status</h3><table>${rows.join("")}</table>`;
}


function renderLedConfig(dev, config) {
    return config.ledConfig.map((led, i) => {
        const pirCheckboxes = Array(8).fill(0).map((_, j) => {
            const checked = (led.pirMask & (1 << j)) ? "checked" : "";
            return `
        <label>
          <span class="flash-wrapper">
            <input type="checkbox" data-led="${i}" data-bit="${j}" ${checked}>
            ${j < 4 ? `PIR ${j}` : `Virtual ${j-4}`}
          </span>
        </label>
      `;
        }).join("<br>");
        
        return `
      <fieldset>
        <legend>LED ${i}</legend>
        
        <label>
        <span class="flash-wrapper">
            Brightness
            <input type="range"
                min="0" max="1023"
                value="${led.brightness}"
                data-led="${i}" data-field="brightness">
            <span class="range-value">${led.brightness}</span>
        </span>
        </label><br>
        
        <label>
          <span class="flash-wrapper">
            On Time (ms)
            <input type="number" value="${led.onTimeMs}" min="0" data-led="${i}" data-field="onTimeMs">
          </span>
        </label><br>
        
        <label>
          <span class="flash-wrapper">
            Fade Freq
            <input type="number" step="0.1" value="${led.fadeFreq}" min="0" data-led="${i}" data-field="fadeFreq">
          </span>
        </label><br>
        
        <fieldset>
          <legend>PIR Mask</legend>
          ${pirCheckboxes}
        </fieldset>
      </fieldset>
    `;
    }).join("");
}

function renderPirOverride(dev, pirOverride) {
    const checkboxes = Array(8).fill(0).map((_, j) => {
        const checked = (pirOverride & (1 << j)) ? "checked" : "";
        return `
      <label>
        <span class="flash-wrapper">
          <input type="checkbox" data-field="pir_override" data-bit="${j}" ${checked}>
          ${j < 4 ? `PIR ${j}` : `Virtual ${j-4}`}
        </span>
      </label>
    `;
    }).join("<br>");
    
    return `<fieldset><legend>PIR Override</legend>${checkboxes}</fieldset>`;
}

// ---------- Main SPA ----------
async function load() {
    const devices = await fetchJSON("api/devices");
    if (!devices.length) {
        app.innerHTML = "<h3>No pirled_controller discovered</h3>";
        return;
    }
    
    const dev = devices[0];
    
    async function refresh() {
        // The ESP8266 is single-threaded and will only recycle connection if there isn't another
        // client waiting. We'll await each one to improve chance of recycling the connection.
        const config = await fetchJSON(deviceURL(dev, "/config"));
	const status = await fetchJSON(deviceURL(dev, "/status"));
        const pirOverride = await fetchJSON(deviceURL(dev, "/pir_override"));
	const saveDebounce = await fetchJSON(deviceURL(dev, "/save_debounce"));
        
        const now = new Date().toLocaleTimeString();
        
        app.innerHTML = `
            <p>${dev.name} (${dev.host}:${dev.port})</p>
            <button id="refreshBtn">Refresh</button>
            <label>
                <input type="checkbox" id="autoRefresh"> Auto-refresh every ${REFRESH_PERIOD_MS / 1000}s
            </label>
            <small id="lastUpdate">Last update: ${now}</small>
            ${renderStatus(status)}
            <h3>Save Debounce</h3>
            <button id="saveBtn">Save</button>
            <span class="flash-wrapper">
                Debounce
                <input id="debounce" type="number" value="${saveDebounce}" min="0">
            </span>
            <h3>LED Configuration</h3>
            ${renderLedConfig(dev, config)}
            <h3>PIR Override</h3>
            ${renderPirOverride(dev, pirOverride)}
        `;
        
        document.getElementById("refreshBtn").onclick = refresh;

        const autoRefreshCheckbox = document.getElementById("autoRefresh");
        autoRefreshCheckbox.checked = !!refreshIntervalId;

        autoRefreshCheckbox.addEventListener("change", e => {
            if (e.target.checked) {
                // start periodic refresh
                refreshIntervalId = setInterval(refresh, REFRESH_PERIOD_MS);
            } else {
                clearInterval(refreshIntervalId);
                refreshIntervalId = null;
            }
        });

        // Save button
        document.getElementById("saveBtn").onclick = async () => {
            try {
                await postForm(deviceURL(dev, "/save"), {});
                flash(document.getElementById("saveBtn"), true);
            } catch {
                flash(document.getElementById("saveBtn"), false);
            }
        };
        
        const inputs = app.querySelectorAll('input');
        
        inputs.forEach(inp => {
            // Update the numeric value next to the slider in real-time
            if (inp.type === "range" && inp.dataset.field === "brightness") {
                inp.addEventListener("input", e => {
                    const valueSpan = inp.nextElementSibling;
                    if (valueSpan && valueSpan.classList.contains("range-value")) {
                        valueSpan.textContent = inp.value;
                    }
                });
            }

            inp.addEventListener('change', async e => {
                const el = e.target;
                const valueBefore = el.type === "checkbox" ? el.checked : el.value;
                
                try {
                    if (el.dataset.field === "brightness" || el.dataset.field === "onTimeMs" || el.dataset.field === "fadeFreq") {
                        const data = { index: el.dataset.led };
                        data[el.dataset.field] = el.type === "number" ? Number(el.value) : el.value;
                        await postForm(deviceURL(dev, "/config/led"), data);
                    } else if (el.dataset.field === "pir_override") {
                        const bits = Array.from(app.querySelectorAll('input[data-field="pir_override"]'))
                        .filter(i => i.checked)
                        .map(i => i.dataset.bit);
                        let val = 0; bits.forEach(b => val |= 1 << b);
                        await postForm(deviceURL(dev, "/pir_override"), { val });
                    } else if (el.id === "debounce") {
                        await postForm(deviceURL(dev, "/save_debounce"), { val: el.value });
                    } else if (el.dataset.bit !== undefined) {
                        // LED PIR mask
                        const ledIndex = el.dataset.led;
                        const bits = Array.from(app.querySelectorAll(`input[data-led="${ledIndex}"][type="checkbox"]`))
                        .filter(i => i.checked)
                        .map(i => i.dataset.bit);
                        let mask = 0; bits.forEach(b => mask |= 1 << b);
                        await postForm(deviceURL(dev, "/config/led"), { index: ledIndex, pirMask: mask });
                    }
                    
                    flash(el, true); // success
                } catch (err) {
                    flash(el, false); // failure
                    if (el.type === "checkbox") el.checked = !el.checked;
                    else el.value = valueBefore;
                    console.error(err);
                }
            });
        });
    }
    
    refresh();
}

load();
