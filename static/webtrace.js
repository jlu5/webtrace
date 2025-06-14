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

const _HIDDEN_HOP_TEXT = '???';
function addMtrRow(parent, index, cells) {
    let currLength = parent.children.length;
    // mtr can skip hops - add lines for these if applicable
    while (currLength < index) {
        addMtrRow(parent, currLength, [currLength, _HIDDEN_HOP_TEXT]);
        currLength++;
    }
    let row = parent.children[index];
    if (!row) {
        row = document.createElement(index ? "tr" : "thead");
        parent.appendChild(row);
    }
    row.textContent = '';
    row.classList.remove('mtr-stale-hop');
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

function renderMtrHost(host) {
    // Render the host in a span that supports copy-on-click
    const span = document.createElement('span');
    span.classList.add('copyable');
    span.title = 'Click to set new target';
    span.addEventListener('click', () => {
        // navigator.clipboard.writeText(span.textContent);
        document.getElementById("target_input").value = span.textContent;
    } );
    const textNode = document.createTextNode(host);
    span.appendChild(textNode);
    return span;
}

function parseMtr(mtrSplitLine) {
    // This uses the mtr "split" format with IPs (mtr -p -b), as documented at
    // https://github.com/traviscross/mtr/blob/master/FORMATS
    if (mtrContext == null) {
        console.error(`mtrContext null, line: ${mtrSplitLine}`);
        return;
    }
    const mtrOutput = document.getElementById('mtr_output');
    const parts = mtrSplitLine.split(' ');

    let i = 0;
    const hopIndex = parts[i++];
    if (hopIndex < 0) {
        // A negative hop index means to hide the corresponding line
        let row = mtrOutput.children[hopIndex * -1];
        if (row) {
            console.log(`Greying out row ${hopIndex * -1}`);
            row.classList.add('mtr-stale-hop');
        }
        return;
    }
    const hostname = parts[i++];

    if (hostname === _HIDDEN_HOP_TEXT) {
        addMtrRow(mtrOutput, hopIndex, [hopIndex, hostname]);
        return;
    }

    const ip = parts[i++];
    const lossPct = Math.round(parts[i++] / 100) / 10 + '%';
    const rcvdPkts = parts[i++];
    const sentPkts = parts[i++];
    const bestRtt = parts[i++];
    const avgRtt = parts[i++];
    const worstRtt = parts[i++];

    if (!mtrContext.seenHopsPerIndex[hopIndex]) {
        return;
    }
    mtrContext.seenHopsPerIndex[hopIndex].set(ip, hostname);
    const allHosts = document.createElement('div');

    // Render a line including all hosts seen for this hop so far (e.g. due to ECMP)
    let first = true;
    for (const [ip, host] of mtrContext.seenHopsPerIndex[hopIndex].entries()) {
        if (!first) {
            allHosts.appendChild(document.createElement('br'));
        }
        first = false;

        const hostSpan = renderMtrHost(host);
        allHosts.appendChild(hostSpan);
        if (host != ip) {
            const ipSpan = renderMtrHost(ip);
            allHosts.appendChild(document.createTextNode(' ['));
            allHosts.appendChild(ipSpan);
            allHosts.appendChild(document.createTextNode(']'));
        }
    }

    addMtrRow(mtrOutput, hopIndex, [hopIndex, allHosts, lossPct, rcvdPkts, sentPkts, bestRtt, avgRtt, worstRtt]);
}

function maybeUpdateHistory(newAction, newTarget, newAftype) {
    // Update the history with the current action & target if it's different
    const urlParams = new URLSearchParams(window.location.search);
    const currTarget = urlParams.get('target');
    const currAction = urlParams.get('action');
    const currAftype = urlParams.get('aftype');
    if (currTarget != newTarget || currAction != newAction || currAftype != newAftype) {
        const newState = {action: newAction, target: newTarget, aftype: newAftype};
        const newParams = new URLSearchParams(newState);
        history.pushState(newState, '', `?${newParams.toString()}`);
    }
}

const READ_TIMEOUT = 5 * 1000;
async function runTrace() {
    const output = document.getElementById("output");
    const status = document.getElementById("status");
    const target_input = document.getElementById("target_input");
    const target = target_input.value.trim();
    target_input.value = target;

    let action = document.querySelector('input[name="action"]:checked');
    if (!action) {
        status.classList = "status-error";
        status.innerText = `Error: No action specified`;
        return;
    }
    action = action.value;

    let aftype = document.querySelector('input[name="aftype"]:checked');
    aftype = aftype ? aftype.value : "";

    console.debug(`Starting ${action} to ${target} (aftype ${aftype})`);
    maybeUpdateHistory(action, target, aftype);

    status.classList = "status-working";
    status.innerText = "Working";
    await stopTrace(false);
    const thisLoop = activeLoop = setInterval(updateWorkingStatus, 200);

    const abortController = new AbortController();
    const fetchTimeoutWatcher = setTimeout(() => abortController.abort(), READ_TIMEOUT);
    let response;
    try {
        response = await fetch(
            `${action}?target=${encodeURIComponent(target)}&aftype=${encodeURIComponent(aftype)}`,
            {signal: abortController.signal} );
    } catch (e) {
        console.log(`fetch error: ${e}`);
        status.classList = "status-error";
        if (e instanceof DOMException && e.name == "AbortError") {
            status.innerText = "Timeout";
            output.innerText += "TIMEOUT: fetch timed out.";
        } else {
            status.innerText = "Error";
            output.innerText += `ERROR: ${e}`;
        }
        await stopTrace(true);
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

    if (action == "mtr") {
        const mtrOutputContainer = document.getElementById('mtr_output');
        mtrContext = new MtrContext();
        addMtrRow(mtrOutputContainer, 0, [
            "Hop#", "Hostname/IP", "Loss%", "Rcvd", "Sent", "Best", "Avg", "Worst"
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
                    console.log("mtr line:", JSON.stringify(line));
                    if (/^-?\d+( |$)/.test(line)) {
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
    const aftype = urlParams.get('aftype');
    console.log('doInit', urlParams);
    if (action) {
        for (const radioBtn of document.querySelectorAll('input[name="action"]')) {
            radioBtn.checked = radioBtn.value == action.toLowerCase();
        }
    }
    if (aftype) {
        for (const radioBtn of document.querySelectorAll('input[name="aftype"]')) {
            radioBtn.checked = radioBtn.value == aftype.toLowerCase();
        }
    }

    if (target) {
        const targetInput = document.getElementById("target_input");
        targetInput.value = target;
        await runTrace();
    }
}
