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

// Polyfill for `for await`, from https://bugs.chromium.org/p/chromium/issues/detail?id=929585#c10
ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader()
    try {
      while (true) {
        const {done, value} = await reader.read()
        if (done) return
        yield value
      }
    }
    finally {
      reader.releaseLock()
    }
  }

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

async function runTrace() {
    const output = document.getElementById("output");
    const status = document.getElementById("status");
    const target = document.getElementById("target_input").value;

    let action = document.querySelector('input[name="action"]:checked');
    if (!action) {
        status.classList = "status-error";
        status.innerText = `ERROR: No action specified`;
        return;
    }
    action = action.value;
    console.debug(`Starting ${action} to ${target}`);
    const mtrOutputContainer = document.getElementById('mtr_output');
    const response = await fetch(`${action}?target=${encodeURIComponent(target)}`);

    if (!response.ok) {
        traceFinished = true;
        status.classList = "status-error";
        status.innerText = `ERROR: ${response.status} ${response.statusText}`;
        await stopTrace(false);
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

    for await (const buf of response.body) {
        if (activeLoop != thisLoop) {
            console.debug(`Stopping old trace loop ${thisLoop} for ${target}`);
            return;
        }
        const str = String.fromCharCode(...buf);
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
    if (target) {
        const targetInput = document.getElementById("target_input");
        targetInput.value = target;
        await runTrace();
    }
}
