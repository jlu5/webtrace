const _SPINNER_VALUES = ['|', '/', '-', '\\'];
let spinnerCount = 0;
const updateWorkingStatus = () => {
    console.debug('updateWorkingStatus running...');
    spinnerCount++;
    spinnerCount %= _SPINNER_VALUES.length;
    const status = document.getElementById("status");
    status.innerText = `Working ${_SPINNER_VALUES[spinnerCount]}`;
}
let activeLoop = null;

async function stopTrace(keepOutput) {
    if (activeLoop) {
        console.debug(`Clearing old trace loop ${activeLoop}`);
        clearInterval(activeLoop);
        activeLoop = null;
        if (keepOutput) {
            const status = document.getElementById("status");
            status.classList = "status-error";
            status.innerText = "Aborted";
        }
    }
    if (!keepOutput) {
        const mtrOutputContainer = document.getElementById('mtr_output');
        mtrOutputContainer.textContent = '';
        const output = document.getElementById("output");
        output.textContent = '';
    }

}

const MTR_MAX_HOPS = 30;
let mtrContext = null;
class MtrContext {
    constructor() {
        this.seenHopsPerIndex = {};
        for (let i=0; i<MTR_MAX_HOPS; i++) {
            this.seenHopsPerIndex[i] = new Map();
        }
    }
}

function addMtrRow(parent, index, cells) {
    let currLength = parent.children.length;
    // mtr can skip hops - add lines for these if applicable
    while (currLength < index) {
        addMtrRow(parent, currLength, [currLength, '*']);
        currLength++;
    }
    let row = parent.children[index];
    if (!row) {
        row = document.createElement(index ? "tr" : "thead");
        parent.appendChild(row);
    }
    row.textContent = '';
    for (let cell of cells) {
        const td = document.createElement(index ? "td" : "th");
        if (cell instanceof Element) {
            td.appendChild(cell);
        } else {
            const tdTextNode = document.createTextNode(cell);
            td.appendChild(tdTextNode);
        }
        row.appendChild(td);
    }
}

function parseMtr(mtrSplitLine) {
    // This uses the mtr "split" format with IPs (mtr -p -b), as documented at
    // https://github.com/traviscross/mtr/blob/master/FORMATS
    if (mtrContext == null) {
        console.error(`mtrContext null, line: ${mtrSplitLine}`);
        return;
    }
    const parts = mtrSplitLine.split(' ');

    let i = 0;
    // mtr report format for reference:
    // HOST: xxxxxx Loss%   Snt   Last   Avg  Best  Wrst StDev
    const hopIndex = parts[i++];
    const hostname = parts[i++];
    const ip = parts[i++];
    const lossPct = (parts[i++] / 1000).toString() + '%';
    const rcvdPkts = parts[i++];
    const sentPkts = parts[i++];
    const bestRtt = parts[i++];
    const avgRtt = parts[i++];
    const worstRtt = parts[i++];

    mtrContext.seenHopsPerIndex[hopIndex].set(ip, hostname);

    // Render the line
    let mtrOutput = document.getElementById('mtr_output');
    const allHosts = document.createElement('div');

    let first = true;
    for (const [ip, host] of mtrContext.seenHopsPerIndex[hopIndex].entries()) {
        let displayedHost = host;
        if (ip != host) {
            displayedHost = `${host} [${ip}]`;
        }
        const textNode = document.createTextNode(displayedHost);
        if (!first) {
            allHosts.appendChild(document.createElement('br'));
        }
        first = false;
        allHosts.appendChild(textNode);
    }

    addMtrRow(mtrOutput, hopIndex, [hopIndex, allHosts, lossPct, rcvdPkts, sentPkts, bestRtt, avgRtt, worstRtt]);
}

const READ_TIMEOUT = 3 * 1000;
async function runTrace() {
    const output = document.getElementById("output");
    const status = document.getElementById("status");
    const target = document.getElementById("target_input").value;

    let action = document.querySelector('input[name="action"]:checked');
    if (!action) {
        status.classList = "status-error";
        status.innerText = `Error: No action specified`;
        return;
    }
    action = action.value;
    console.debug(`Starting ${action} to ${target}`);
    const mtrOutputContainer = document.getElementById('mtr_output');

    const abortController = new AbortController();
    const fetchTimeoutWatcher = setTimeout(() => abortController.abort(), READ_TIMEOUT);
    let response;
    try {
        response = await fetch(`${action}?target=${encodeURIComponent(target)}`,
            {signal: abortController.signal} );
    } catch (e) {
        console.log(`fetch error: ${e}`);
        status.classList = "status-error";
        if (e instanceof DOMException && e.name == "AbortError") {
            status.innerText = "Timeout";
            output.innerText += "TIMEOUT: fetch timed out. Please check that webtrace is running behind an unbuffered web server!";
        } else {
            status.innerText = "Error";
            output.innerText += `ERROR: ${e}`;
        }
        return;
    }
    clearTimeout(fetchTimeoutWatcher);

    if (!response.ok) {
        traceFinished = true;
        status.classList = "status-error";
        status.innerText = `Error: ${response.status} ${response.statusText}`;
        await stopTrace(false);
        output.innerText = await response.text();
        return;
    }

    status.classList = "status-working";
    status.innerText = "Working";
    await stopTrace(false);
    const thisLoop = activeLoop = setInterval(updateWorkingStatus, 200);

    if (action == "mtr") {
        mtrContext = new MtrContext();
        addMtrRow(mtrOutputContainer, 0, [
            "Hop#", "Hostname/IP", "Loss%", "Sent", "Last", "Avg", "Best", "Worst"
        ]);
    }

    const textDecoder = new TextDecoder();
    let reader = response.body.getReader();
    while (true) {
        let timeoutWatcher = setTimeout(() => reader.releaseLock(), READ_TIMEOUT);
        try {
            let {done: readerDone, value: buf} = await reader.read();
            clearTimeout(timeoutWatcher);
            if (activeLoop != thisLoop) {
                console.debug(`Stopping old trace loop ${thisLoop} for ${target}`);
                return;
            }
            if (readerDone) {
                break;
            }
            const str = textDecoder.decode(buf);
            if (action == "mtr") {
                for (let line of str.split('\n')) {
                    console.log("mtr line", line);
                    if (/^\d+? /.test(line)) {
                        parseMtr(line);
                    } else if (line.trim()) {
                        output.innerText += line;
                        output.innerText += '\n';
                    }
                }
            } else {
                output.innerText += str;
            }
        } catch (e) {
            console.log("Exiting read loop:", e);
            reader = response.body.getReader();
            continue;
        }
    }
    clearInterval(activeLoop);
    if (output.innerText.includes('ERROR:')) {
        status.classList = "status-error";
        status.innerText = "Error";
    } else if (output.innerText.includes('TIMEOUT:')) {
        status.classList = "status-error";
        status.innerText = "Timeout";
    } else {
        status.classList = "status-done";
        status.innerText = "Finished";
    }
    activeLoop = null;
}

async function onInputKeyPress(event) {
    if (event.keyCode == 13) {
        await runTrace();
    }
}

async function doInit() {
    const urlParams = new URLSearchParams(window.location.search);
    const target = urlParams.get('target');
    const action = urlParams.get('action');
    if (action) {
        for (const radioBtn of document.querySelectorAll('input[name="action"]')) {
            radioBtn.checked = radioBtn.value == action.toLowerCase();
        }
    }
    if (target) {
        const targetInput = document.getElementById("target_input");
        targetInput.value = target;
        await runTrace();
    }
}
